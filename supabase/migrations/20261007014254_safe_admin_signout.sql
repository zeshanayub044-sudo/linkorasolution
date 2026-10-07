-- Existing admin status actions could close every old open row at now(),
-- fabricating weeks of work. Only one valid live session may be signed out.
create or replace function public.portal_admin_set_attendance(
  p_actor_id uuid, p_target_id uuid, p_new_status text, p_reason text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_actor public.employee_profiles%rowtype;
  v_target public.employee_profiles%rowtype;
  v_session public.employee_activity_sessions%rowtype;
  v_count integer;
  v_at timestamptz := now();
  v_timezone text;
  v_hours integer;
  v_session_id uuid;
  v_previous text;
  v_before jsonb;
  v_after jsonb;
begin
  select * into v_actor from public.employee_profiles
    where id=p_actor_id and is_active for share;
  if not found or lower(trim(v_actor.role))<>'co-ceo' then
    raise exception 'Co-CEO access required' using errcode='42501';
  end if;
  select * into v_target from public.employee_profiles
    where id=p_target_id for update;
  if not found then raise exception 'User not found' using errcode='P0002'; end if;
  if not v_target.is_active then
    raise exception 'Disabled users cannot be marked signed in or out' using errcode='22023';
  end if;
  if p_new_status not in ('Signed In','Signed Out') or
      length(btrim(coalesce(p_reason,'')))<5 then
    raise exception 'Valid attendance status and a reason of at least five characters are required'
      using errcode='22023';
  end if;
  select timezone,max_session_hours into v_timezone,v_hours
    from public.company_settings where id=true;
  select count(*) into v_count from public.employee_activity_sessions
    where employee_id=p_target_id and status='Logged In';
  v_previous := case when v_count>0 then 'Signed In' else 'Signed Out' end;
  if v_previous=p_new_status then
    raise exception 'User is already %',p_new_status using errcode='22023';
  end if;

  if p_new_status='Signed In' then
    v_session_id := gen_random_uuid();
    insert into public.employee_activity_sessions
      (session_id,employee_id,login_at,status,login_source,login_actor_id,login_reason)
    values (v_session_id,p_target_id,v_at,'Logged In','admin',p_actor_id,btrim(p_reason));
    v_before := jsonb_build_object('status','Signed Out');
    v_after := jsonb_build_object('status','Signed In','session_id',v_session_id,
      'login_at',v_at);
  else
    if v_count<>1 then
      raise exception 'Multiple open sessions require individual review before sign-out'
        using errcode='22023';
    end if;
    select * into v_session from public.employee_activity_sessions
      where employee_id=p_target_id and status='Logged In' for update;
    if (v_session.login_at at time zone v_timezone)::date
          <> (v_at at time zone v_timezone)::date
      or v_session.login_at<v_at-make_interval(hours=>v_hours) then
      raise exception 'Old open session requires a reasoned attendance correction'
        using errcode='22023';
    end if;
    v_session_id := v_session.session_id;
    v_before := jsonb_build_object('status','Signed In','session_id',v_session_id,
      'login_at',v_session.login_at,'logout_at',v_session.logout_at);
    update public.employee_activity_sessions
    set logout_at=greatest(v_at,login_at),status='Logged Out',
      logout_source='admin',logout_actor_id=p_actor_id,logout_reason=btrim(p_reason)
    where session_id=v_session_id;
    v_after := jsonb_build_object('status','Signed Out','session_id',v_session_id,
      'login_at',v_session.login_at,'logout_at',greatest(v_at,v_session.login_at));
  end if;
  insert into public.portal_admin_audit_log
    (admin_id,admin_name,target_user_id,target_name,action,before_state,after_state,reason)
  values (p_actor_id,v_actor.full_name,p_target_id,v_target.full_name,
    case when p_new_status='Signed In' then 'attendance_signed_in'
      else 'attendance_signed_out' end,v_before,v_after,btrim(p_reason));
  return jsonb_build_object('previous_status',v_previous,'new_status',p_new_status,
    'changed_at',v_at,'sessions_changed',1,'session_ids',jsonb_build_array(v_session_id));
end;
$$;

-- On deactivation, flag old/duplicate open rows before the existing profile
-- update function closes any single valid current session. No history is lost.
create function admin_private.prepare_sessions_for_deactivation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_timezone text; v_hours integer; v_keep uuid; v_old record;
begin
  if old.is_active and not new.is_active then
    select timezone,max_session_hours into v_timezone,v_hours
      from public.company_settings where id=true;
    select session_id into v_keep from public.employee_activity_sessions
    where employee_id=old.id and status='Logged In'
      and (login_at at time zone v_timezone)::date
        =(now() at time zone v_timezone)::date
      and login_at>now()-make_interval(hours=>v_hours)
    order by login_at desc limit 1;
    for v_old in select session_id,login_at from public.employee_activity_sessions
      where employee_id=old.id and status='Logged In'
        and (v_keep is null or session_id<>v_keep)
      for update
    loop
      update public.employee_activity_sessions set status='Needs Review'
        where session_id=v_old.session_id;
      insert into public.portal_admin_audit_log
        (admin_name,target_user_id,target_name,action,before_state,after_state,reason)
      values ('System',old.id,old.full_name,'stale_session_flagged',
        jsonb_build_object('session_id',v_old.session_id,'status','Logged In',
          'login_at',v_old.login_at),
        jsonb_build_object('session_id',v_old.session_id,'status','Needs Review'),
        'Account deactivated; historical open session requires review');
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function admin_private.prepare_sessions_for_deactivation()
  from public,anon,authenticated;
create trigger employee_deactivation_review
before update of is_active on public.employee_profiles
for each row execute function admin_private.prepare_sessions_for_deactivation();
