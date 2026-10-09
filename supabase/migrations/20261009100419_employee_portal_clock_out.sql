CREATE OR REPLACE FUNCTION public.portal_presence_action(p_user_id uuid, p_auth_session uuid, p_action text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare cfg public.company_settings%rowtype; s public.employee_activity_sessions%rowtype;
  v_id uuid; v_tab uuid; v_client uuid; v_started jsonb; v_hash text; v_name text; c admin_private.portal_clients%rowtype;
begin
  if not admin_private.portal_identity(p_user_id,p_auth_session) then raise exception 'Active portal authorization required' using errcode='42501'; end if;
  if p_action not in ('connect','clock-in','clock-out','heartbeat') then raise exception 'Invalid presence action' using errcode='22023'; end if;
  if p_action='clock-out' then
    if p_payload->>'sessionId' is null then raise exception 'Exact session required' using errcode='22023'; end if;
    return public.portal_employee_end_session(p_user_id,(p_payload->>'sessionId')::uuid);
  end if;
  v_tab:=(p_payload->>'tabId')::uuid; v_client:=(p_payload->>'clientId')::uuid;
  if v_tab is null or v_client is null then raise exception 'Client IDs required' using errcode='22023'; end if;
  select * into cfg from public.company_settings where id=true;
  -- Lock the same profile as session start/end to serialize races.
  perform 1 from public.employee_profiles where id=p_user_id for update;
  if p_action in ('connect','clock-in') then
    v_id:=(p_payload->>'sessionId')::uuid;
    v_hash:=p_payload->>'closeTokenHash';
    if v_id is null or v_hash is null or v_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid connection' using errcode='22023'; end if;
    if (select count(*) from admin_private.portal_clients c2 join public.employee_activity_sessions a on a.session_id=c2.session_id
      where a.employee_id=p_user_id and a.status='Logged In' and c2.close_requested_at is null and c2.last_seen_at>now()-interval '1 minute')>=20
      and not exists(select 1 from admin_private.portal_clients where tab_id=v_tab and client_id=v_client) then
      raise exception 'Too many portal tabs' using errcode='54000';
    end if;
    if p_action='clock-in' then
      v_started:=public.portal_employee_start_session(p_user_id,v_id);
    else
      perform admin_private.expire_portal_sessions(p_user_id);
      select a.session_id into v_id from public.employee_activity_sessions a
        where a.employee_id=p_user_id and a.status='Logged In' order by a.login_at desc limit 1;
      if v_id is null then
        select * into s from public.employee_activity_sessions where employee_id=p_user_id order by login_at desc limit 1;
        return jsonb_build_object('active',false,'sessionState',coalesce(s.session_state,'not_clocked_in'),'autoClosed',coalesce(s.auto_closed,false),'logoutAt',s.logout_at);
      end if;
      v_started:=jsonb_build_object('sessionId',v_id,'alreadyOpen',true);
    end if;
    v_id:=(v_started->>'sessionId')::uuid;
    select * into s from public.employee_activity_sessions where session_id=v_id and employee_id=p_user_id for update;
    if s.last_heartbeat_at is null then
      select full_name into v_name from public.employee_profiles where id=p_user_id;
      insert into public.portal_admin_audit_log(admin_id,admin_name,target_user_id,target_name,action,after_state)
      values(p_user_id,v_name,p_user_id,v_name,'attendance_tracking_started',jsonb_build_object('session_id',v_id));
    end if;
    insert into admin_private.portal_clients(session_id,tab_id,client_id,auth_session_id,close_token_hash,background)
      values(v_id,v_tab,v_client,p_auth_session,v_hash,coalesce((p_payload->>'background')::boolean,false))
    on conflict(session_id,tab_id) do update set client_id=excluded.client_id,auth_session_id=excluded.auth_session_id,
      close_token_hash=excluded.close_token_hash,last_seen_at=now(),close_requested_at=null,background=excluded.background;
  else
    v_id:=(p_payload->>'sessionId')::uuid;
    select * into s from public.employee_activity_sessions where session_id=v_id and employee_id=p_user_id for update;
    if not found then raise exception 'Session unavailable' using errcode='42501'; end if;
    if s.status<>'Logged In' then return jsonb_build_object('active',false,'sessionId',v_id,'sessionState',s.session_state,'logoutAt',s.logout_at,'estimatedLogout',s.estimated_logout); end if;
    perform admin_private.expire_portal_sessions(p_user_id);
    select * into s from public.employee_activity_sessions where session_id=v_id;
    if s.status<>'Logged In' then return jsonb_build_object('active',false,'sessionId',v_id,'sessionState',s.session_state,'logoutAt',s.logout_at,'estimatedLogout',s.estimated_logout); end if;
    select * into c from admin_private.portal_clients where session_id=v_id and tab_id=v_tab and client_id=v_client
      and auth_session_id=p_auth_session for update;
    if not found then raise exception 'Connect this portal tab first' using errcode='42501'; end if;
      update admin_private.portal_clients set last_seen_at=now(),close_requested_at=null,
        background=coalesce((p_payload->>'background')::boolean,false) where session_id=v_id and tab_id=v_tab;
  end if;
    update public.employee_activity_sessions set last_heartbeat_at=now(),session_state='active',disconnect_reason=null
      where session_id=v_id and status='Logged In';
  if s.session_state='connection_lost' then
    insert into public.portal_admin_audit_log(admin_id,admin_name,target_user_id,target_name,action,after_state)
    select p_user_id,p.full_name,p_user_id,p.full_name,'connection_recovered',jsonb_build_object('session_id',v_id)
      from public.employee_profiles p where p.id=p_user_id;
  end if;
  return jsonb_build_object('active',true,'loginAt',s.login_at,'autoClosed',false,'sessionId',v_id,'sessionState','active','lastHeartbeatAt',(select a.last_heartbeat_at from public.employee_activity_sessions a where a.session_id=v_id),
    'alreadyOpen',coalesce((v_started->>'alreadyOpen')::boolean,true),'heartbeatSeconds',cfg.attendance_heartbeat_seconds,
    'disconnectSeconds',cfg.attendance_disconnect_seconds,'backgroundSeconds',cfg.attendance_background_seconds,
    'closeGraceSeconds',cfg.attendance_close_grace_seconds);
end; $function$;
