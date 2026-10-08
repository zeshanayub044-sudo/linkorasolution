-- Keep employee attendance immutable as history while recording administrative changes.
alter table public.employee_activity_sessions
  add column if not exists login_source text not null default 'user' check (login_source in ('user', 'admin')),
  add column if not exists logout_source text check (logout_source in ('user', 'admin')),
  add column if not exists login_actor_id uuid references public.employee_profiles(id) on delete restrict,
  add column if not exists logout_actor_id uuid references public.employee_profiles(id) on delete restrict,
  add column if not exists login_reason text,
  add column if not exists logout_reason text;

update public.employee_activity_sessions
set logout_source = 'user'
where logout_at is not null and logout_source is null;

create index if not exists employee_activity_sessions_employee_login_idx
  on public.employee_activity_sessions (employee_id, login_at desc);
create index if not exists employee_activity_sessions_open_idx
  on public.employee_activity_sessions (employee_id)
  where status = 'Logged In';
create unique index if not exists employee_profiles_employee_id_ci_idx
  on public.employee_profiles (lower(employee_id));

create table if not exists public.portal_admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.employee_profiles(id) on delete restrict,
  admin_name text not null,
  target_user_id uuid references public.employee_profiles(id) on delete restrict,
  target_name text not null,
  action text not null check (action in ('user_created', 'user_edited', 'user_disabled', 'user_enabled', 'role_changed', 'attendance_signed_in', 'attendance_signed_out')),
  before_state jsonb,
  after_state jsonb,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists portal_admin_audit_log_target_idx on public.portal_admin_audit_log (target_user_id, created_at desc);
create index if not exists portal_admin_audit_log_created_idx on public.portal_admin_audit_log (created_at desc);
alter table public.portal_admin_audit_log enable row level security;
revoke all on public.portal_admin_audit_log from anon, authenticated;

-- The Edge Function authenticates the request; this RPC independently verifies
-- the actor and performs the attendance transition and audit in one transaction.
create or replace function public.portal_admin_set_attendance(
  p_actor_id uuid, p_target_id uuid, p_new_status text, p_reason text
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_actor public.employee_profiles%rowtype;
  v_target public.employee_profiles%rowtype;
  v_previous text;
  v_changed integer;
  v_session_id uuid;
  v_session_ids jsonb := '[]'::jsonb;
  v_at timestamptz := now();
begin
  select * into v_actor from public.employee_profiles where id = p_actor_id and is_active for share;
  if not found or lower(trim(v_actor.role)) <> 'co-ceo' then
    raise exception 'Co-CEO access required' using errcode = '42501';
  end if;
  select * into v_target from public.employee_profiles where id = p_target_id for update;
  if not found then raise exception 'User not found' using errcode = 'P0002'; end if;
  if not v_target.is_active then raise exception 'Disabled users cannot be marked signed in or out' using errcode = '22023'; end if;
  if p_new_status not in ('Signed In', 'Signed Out') then raise exception 'Invalid attendance status' using errcode = '22023'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'A reason is required' using errcode = '22023'; end if;

  select case when exists (
    select 1 from public.employee_activity_sessions
    where employee_id = p_target_id and status = 'Logged In'
  ) then 'Signed In' else 'Signed Out' end into v_previous;
  if v_previous = p_new_status then raise exception 'User is already %', p_new_status using errcode = '22023'; end if;

  if p_new_status = 'Signed In' then
    v_session_id := gen_random_uuid();
    insert into public.employee_activity_sessions
      (session_id, employee_id, login_at, status, login_source, login_actor_id, login_reason)
    values (v_session_id, p_target_id, v_at, 'Logged In', 'admin', p_actor_id, trim(p_reason));
    v_changed := 1;
    v_session_ids := jsonb_build_array(v_session_id);
  else
    select coalesce(jsonb_agg(session_id), '[]'::jsonb) into v_session_ids
    from public.employee_activity_sessions
    where employee_id = p_target_id and status = 'Logged In';
    update public.employee_activity_sessions
    set logout_at = greatest(v_at, login_at), status = 'Logged Out',
        logout_source = 'admin', logout_actor_id = p_actor_id, logout_reason = trim(p_reason)
    where employee_id = p_target_id and status = 'Logged In';
    get diagnostics v_changed = row_count;
  end if;

  insert into public.portal_admin_audit_log
    (admin_id, admin_name, target_user_id, target_name, action, before_state, after_state, reason)
  values (p_actor_id, v_actor.full_name, p_target_id, v_target.full_name,
    case when p_new_status = 'Signed In' then 'attendance_signed_in' else 'attendance_signed_out' end,
    jsonb_build_object('status', v_previous),
    jsonb_build_object('status', p_new_status, 'sessions_changed', v_changed, 'session_id', v_session_id),
    trim(p_reason));
  return jsonb_build_object('previous_status', v_previous, 'new_status', p_new_status,
    'changed_at', v_at, 'sessions_changed', v_changed, 'session_ids', v_session_ids);
end;
$$;
revoke all on function public.portal_admin_set_attendance(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.portal_admin_set_attendance(uuid, uuid, text, text) to service_role;

create or replace function public.portal_admin_create_profile(
  p_actor_id uuid, p_user_id uuid, p_employee_id text, p_full_name text,
  p_scheme text, p_role text, p_is_active boolean, p_email text
) returns void
language plpgsql security invoker set search_path = ''
as $$
declare v_actor public.employee_profiles%rowtype;
begin
  select * into v_actor from public.employee_profiles where id = p_actor_id and is_active for share;
  if not found or lower(trim(v_actor.role)) <> 'co-ceo' then
    raise exception 'Co-CEO access required' using errcode = '42501';
  end if;
  if p_role not in ('Employee', 'Co-CEO') or
     nullif(trim(p_employee_id), '') is null or
     nullif(trim(p_full_name), '') is null or
     nullif(trim(p_scheme), '') is null then
    raise exception 'Invalid user details' using errcode = '22023';
  end if;
  insert into public.employee_profiles (id, employee_id, full_name, scheme, role, is_active)
  values (p_user_id, trim(p_employee_id), trim(p_full_name), trim(p_scheme), p_role, p_is_active);
  insert into public.portal_admin_audit_log
    (admin_id, admin_name, target_user_id, target_name, action, after_state)
  values (p_actor_id, v_actor.full_name, p_user_id, trim(p_full_name), 'user_created',
    jsonb_build_object('employee_id', trim(p_employee_id), 'email', lower(trim(p_email)),
      'scheme', trim(p_scheme), 'role', p_role, 'is_active', p_is_active));
end;
$$;
revoke all on function public.portal_admin_create_profile(uuid, uuid, text, text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.portal_admin_create_profile(uuid, uuid, text, text, text, text, boolean, text) to service_role;

create or replace function public.portal_admin_update_profile(
  p_actor_id uuid, p_user_id uuid, p_employee_id text, p_full_name text,
  p_scheme text, p_role text, p_is_active boolean, p_old_email text, p_new_email text
) returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_actor public.employee_profiles%rowtype;
  v_before public.employee_profiles%rowtype;
  v_old jsonb;
  v_new jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(932466701);
  select * into v_actor from public.employee_profiles where id = p_actor_id and is_active for share;
  if not found or lower(trim(v_actor.role)) <> 'co-ceo' then
    raise exception 'Co-CEO access required' using errcode = '42501';
  end if;
  select * into v_before from public.employee_profiles where id = p_user_id for update;
  if not found then raise exception 'User not found' using errcode = 'P0002'; end if;
  if p_role not in ('Employee', 'Co-CEO') or
     nullif(trim(p_employee_id), '') is null or
     nullif(trim(p_full_name), '') is null or
     nullif(trim(p_scheme), '') is null then
    raise exception 'Invalid user details' using errcode = '22023';
  end if;
  if p_user_id = p_actor_id and (not p_is_active or p_role <> 'Co-CEO') then
    raise exception 'You cannot disable or remove your own admin access' using errcode = '22023';
  end if;
  if v_before.is_active and v_before.role = 'Co-CEO' and
     (not p_is_active or p_role <> 'Co-CEO') and
     (select count(*) from public.employee_profiles where is_active and role = 'Co-CEO') <= 1 then
    raise exception 'At least one active Co-CEO is required' using errcode = '22023';
  end if;
  v_old := jsonb_build_object('employee_id', v_before.employee_id, 'full_name', v_before.full_name,
    'scheme', v_before.scheme, 'role', v_before.role, 'is_active', v_before.is_active,
    'email', lower(trim(p_old_email)));
  v_new := jsonb_build_object('employee_id', trim(p_employee_id), 'full_name', trim(p_full_name),
    'scheme', trim(p_scheme), 'role', p_role, 'is_active', p_is_active,
    'email', lower(trim(p_new_email)));
  if v_old = v_new then return; end if;
  update public.employee_profiles
  set employee_id = trim(p_employee_id), full_name = trim(p_full_name), scheme = trim(p_scheme),
      role = p_role, is_active = p_is_active, updated_at = now()
  where id = p_user_id;
  if v_before.is_active and not p_is_active then
    update public.employee_activity_sessions
    set logout_at = greatest(now(), login_at), status = 'Logged Out',
        logout_source = 'admin', logout_actor_id = p_actor_id,
        logout_reason = 'Account disabled'
    where employee_id = p_user_id and status = 'Logged In';
    if found then
      insert into public.portal_admin_audit_log
        (admin_id, admin_name, target_user_id, target_name, action, before_state, after_state, reason)
      values (p_actor_id, v_actor.full_name, p_user_id, trim(p_full_name), 'attendance_signed_out',
        jsonb_build_object('status', 'Signed In'), jsonb_build_object('status', 'Signed Out'), 'Account disabled');
    end if;
  end if;
  insert into public.portal_admin_audit_log
    (admin_id, admin_name, target_user_id, target_name, action, before_state, after_state)
  values (p_actor_id, v_actor.full_name, p_user_id, trim(p_full_name),
    case when v_before.is_active and not p_is_active then 'user_disabled'
         when not v_before.is_active and p_is_active then 'user_enabled'
         else 'user_edited' end, v_old, v_new);
  if v_before.role <> p_role then
    insert into public.portal_admin_audit_log
      (admin_id, admin_name, target_user_id, target_name, action, before_state, after_state)
    values (p_actor_id, v_actor.full_name, p_user_id, trim(p_full_name), 'role_changed',
      jsonb_build_object('role', v_before.role), jsonb_build_object('role', p_role));
  end if;
end;
$$;
revoke all on function public.portal_admin_update_profile(uuid, uuid, text, text, text, text, boolean, text, text) from public, anon, authenticated;
grant execute on function public.portal_admin_update_profile(uuid, uuid, text, text, text, text, boolean, text, text) to service_role;

create or replace function public.portal_admin_user_summary(p_actor_id uuid)
returns table (user_id uuid, last_sign_in timestamptz, last_sign_out timestamptz, is_signed_in boolean)
language plpgsql security invoker set search_path = ''
as $$
begin
  if not exists (select 1 from public.employee_profiles
    where id = p_actor_id and is_active and lower(trim(role)) = 'co-ceo') then
    raise exception 'Co-CEO access required' using errcode = '42501';
  end if;
  return query
  select p.id, max(s.login_at), max(s.logout_at),
    coalesce(bool_or(s.status = 'Logged In'), false)
  from public.employee_profiles p
  left join public.employee_activity_sessions s on s.employee_id = p.id
  group by p.id;
end;
$$;
revoke all on function public.portal_admin_user_summary(uuid) from public, anon, authenticated;
grant execute on function public.portal_admin_user_summary(uuid) to service_role;
