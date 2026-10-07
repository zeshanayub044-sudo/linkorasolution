-- An employee sign-out with only an old open row must not use now() as a
-- fabricated historical logout. Flag it for Co-CEO review instead.
create or replace function public.portal_employee_end_session(p_user_id uuid, p_session_id uuid default null)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_session public.employee_activity_sessions%rowtype;
  v_profile public.employee_profiles%rowtype;
  v_timezone text;
  v_hours integer;
begin
  select * into v_profile from public.employee_profiles where id=p_user_id for update;
  if not found then raise exception 'Employee profile not found' using errcode='P0002'; end if;
  if p_session_id is not null then
    select * into v_session from public.employee_activity_sessions
      where employee_id=p_user_id and session_id=p_session_id and status='Logged In'
      for update;
  end if;
  if v_session.session_id is null then
    select * into v_session from public.employee_activity_sessions
      where employee_id=p_user_id and status='Logged In'
      order by login_at desc limit 1 for update;
  end if;
  if v_session.session_id is null then
    return jsonb_build_object('alreadyClosed',true,'sessionId',p_session_id);
  end if;
  select timezone,max_session_hours into v_timezone,v_hours
    from public.company_settings where id=true;
  if (v_session.login_at at time zone v_timezone)::date
       <>(now() at time zone v_timezone)::date
    or v_session.login_at<now()-make_interval(hours=>v_hours) then
    update public.employee_activity_sessions set status='Needs Review'
      where session_id=v_session.session_id;
    insert into public.portal_admin_audit_log
      (admin_name,target_user_id,target_name,action,before_state,after_state,reason)
    values ('System',p_user_id,v_profile.full_name,'stale_session_flagged',
      jsonb_build_object('session_id',v_session.session_id,'status','Logged In',
        'login_at',v_session.login_at),
      jsonb_build_object('session_id',v_session.session_id,'status','Needs Review'),
      'Employee sign-out found an old open session; no sign-out time was invented');
    return jsonb_build_object('alreadyClosed',true,'flaggedForReview',true,
      'sessionId',v_session.session_id);
  end if;
  update public.employee_activity_sessions
    set logout_at=greatest(now(),v_session.login_at),status='Logged Out',
        logout_source='user'
    where session_id=v_session.session_id;
  return jsonb_build_object('alreadyClosed',false,'sessionId',v_session.session_id);
end;
$$;
