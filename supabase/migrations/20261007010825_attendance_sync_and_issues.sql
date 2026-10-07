-- Persist spreadsheet mirror attempts in Supabase. The attendance write and
-- queue entry are committed together; a webhook outage cannot undo attendance.
create table public.attendance_sheet_sync_queue (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.employee_activity_sessions(session_id) on delete restrict,
  action text not null check (action in ('login','logout')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (session_id, action)
);
create index attendance_sheet_sync_pending_idx
  on public.attendance_sheet_sync_queue (next_attempt_at, id)
  where synced_at is null;
alter table public.attendance_sheet_sync_queue enable row level security;
revoke all on public.attendance_sheet_sync_queue from public, anon, authenticated;
grant select, insert, update on public.attendance_sheet_sync_queue to service_role;
grant usage, select on sequence public.attendance_sheet_sync_queue_id_seq to service_role;

create function admin_private.queue_employee_sheet_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='INSERT' and new.status='Logged In'
      and new.login_source='user' and new.login_at >= now()-interval '5 minutes' then
    insert into public.attendance_sheet_sync_queue(session_id,action)
    values (new.session_id,'login') on conflict do nothing;
  elsif tg_op='UPDATE' and old.status='Logged In' and new.status='Logged Out'
      and new.logout_source='user' and new.logout_at >= now()-interval '5 minutes' then
    insert into public.attendance_sheet_sync_queue(session_id,action)
    values (new.session_id,'logout') on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function admin_private.queue_employee_sheet_sync() from public, anon, authenticated;
create trigger employee_activity_sheet_queue
after insert or update of status on public.employee_activity_sessions
for each row execute function admin_private.queue_employee_sheet_sync();

-- Qualify the CTE column against the function's output parameter names.
create or replace function public.portal_attendance_issues(p_limit integer default 200)
returns table (
  session_id uuid, user_id uuid, employee_id text, full_name text,
  login_at timestamptz, logout_at timestamptz, status text, issue text,
  open_count bigint
) language plpgsql stable security definer set search_path = '' as $$
declare v_hours integer;
begin
  if not public.is_admin() then raise exception 'Co-CEO access required' using errcode = '42501'; end if;
  if p_limit not between 1 and 500 then raise exception 'Invalid limit' using errcode='22023'; end if;
  select max_session_hours into v_hours from public.company_settings where id=true;
  return query
  with opens as (
    select s.employee_id, count(*) n from public.employee_activity_sessions s
    where s.status='Logged In' group by s.employee_id
  )
  select a.session_id,a.employee_id,p.employee_id,p.full_name,
    a.login_at,a.logout_at,a.status,
    case when a.status='Needs Review' then 'Missing sign-out'
      when coalesce(o.n,0)>1 then 'Multiple open sessions'
      when a.login_at>now() then 'Future sign-in'
      when a.login_at<now()-make_interval(hours=>v_hours) then 'Long open session'
      when a.logout_at<a.login_at then 'Negative duration'
      else 'Manual review' end,
    coalesce(o.n,0)
  from public.employee_activity_sessions a
  join public.employee_profiles p on p.id=a.employee_id
  left join opens o on o.employee_id=a.employee_id
  where (a.status in ('Logged In','Needs Review')
    and (a.status='Needs Review' or coalesce(o.n,0)>1
      or a.login_at>now() or a.login_at<now()-make_interval(hours=>v_hours)))
    or a.logout_at<a.login_at
  order by a.login_at desc limit p_limit;
end;
$$;
