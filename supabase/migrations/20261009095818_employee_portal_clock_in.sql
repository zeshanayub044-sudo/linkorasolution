-- Explicit Clock In; connect restores only. Historical records are preserved.
alter table public.company_settings drop constraint company_settings_attendance_heartbeat_seconds_check,
 drop constraint company_settings_attendance_disconnect_seconds_check,
 drop constraint company_settings_attendance_background_seconds_check;
alter table public.company_settings alter column attendance_heartbeat_seconds set default 5,
 alter column attendance_disconnect_seconds set default 15,
 alter column attendance_background_seconds set default 15;
alter table public.company_settings add check(attendance_heartbeat_seconds between 5 and 60),
 add check(attendance_disconnect_seconds between 15 and 600),
 add check(attendance_background_seconds between 15 and 3600);
update public.company_settings set attendance_heartbeat_seconds=5,attendance_disconnect_seconds=15,
 attendance_background_seconds=15,attendance_close_grace_seconds=15 where id=true;
alter table public.employee_activity_sessions add column screen_share_state text not null default 'permission_required'
 check(screen_share_state in ('permission_required','requested','active','declined','stopped','unsupported'));
alter table public.portal_admin_audit_log drop constraint portal_admin_audit_log_action_check;
alter table public.portal_admin_audit_log add constraint portal_admin_audit_log_action_check check(action in (
'user_created','user_edited','user_disabled','user_enabled','role_changed','attendance_signed_in',
'attendance_signed_out','stale_session_flagged','attendance_settings_changed','attendance_corrected',
'attendance_manually_added','leave_created','leave_changed','attendance_session_started',
'attendance_session_normal_logout','attendance_session_portal_closed','attendance_session_auto_closed',
'attendance_tracking_started','heartbeat_timeout','screen_share_started','screen_share_stopped',
'screen_viewer_joined','screen_viewer_left','portal_login','screen_share_requested','screen_share_declined',
'screen_share_state_changed','connection_recovered'));
CREATE OR REPLACE FUNCTION public.portal_presence_action(p_user_id uuid, p_auth_session uuid, p_action text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare cfg public.company_settings%rowtype; s public.employee_activity_sessions%rowtype;
  v_id uuid; v_tab uuid; v_client uuid; v_started jsonb; v_hash text; v_name text; c admin_private.portal_clients%rowtype;
begin
  if not admin_private.portal_identity(p_user_id,p_auth_session) then raise exception 'Active portal authorization required' using errcode='42501'; end if;
  if p_action not in ('connect','clock-in','heartbeat') then raise exception 'Invalid presence action' using errcode='22023'; end if;
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

CREATE OR REPLACE FUNCTION admin_private.expire_portal_sessions(p_employee uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cfg public.company_settings%rowtype; person record; s record; v_closed timestamptz;
  v_last timestamptz; v_deadline timestamptz; v_all_closed boolean; v_count integer:=0;
begin
  select * into cfg from public.company_settings where id=true;
  -- The profile lock serializes connects and expiry without locking historical rows.
  for person in select p.id,p.full_name from public.employee_profiles p
    where (p_employee is null or p.id=p_employee) and exists(
      select 1 from public.employee_activity_sessions a where a.employee_id=p.id
        and a.status='Logged In' and a.last_heartbeat_at is not null)
    order by p.id for update of p skip locked
  loop
    for s in select a.* from public.employee_activity_sessions a
      where a.employee_id=person.id and a.status='Logged In' and a.last_heartbeat_at is not null for update
    loop
      select max(c.close_requested_at),max(c.last_seen_at),
        max(c.last_seen_at+make_interval(secs=>case when c.background then cfg.attendance_background_seconds else cfg.attendance_disconnect_seconds end))
          filter(where c.close_requested_at is null),
        coalesce(bool_and(c.close_requested_at is not null),false)
      into v_closed,v_last,v_deadline,v_all_closed
      from admin_private.portal_clients c where c.session_id=s.session_id;
      if v_all_closed and v_closed+make_interval(secs=>cfg.attendance_close_grace_seconds)<=now() then
        update public.employee_activity_sessions set status='Logged Out',logout_at=greatest(s.login_at,now()),
          logout_source='system',session_state='auto_closed',disconnect_reason='portal_closed',
          auto_closed=true,estimated_logout=false,closed_at=now() where session_id=s.session_id;
        insert into public.portal_admin_audit_log(admin_name,target_user_id,target_name,action,after_state,reason)
        values('System',person.id,person.full_name,'attendance_session_auto_closed',
          jsonb_build_object('session_id',s.session_id,'logout_at',now(),'last_heartbeat_at',s.last_heartbeat_at,'estimated_logout',false),
          'portal_closed: all registered clients closed; server closure time');
        v_count:=v_count+1;
      elsif not v_all_closed and coalesce(v_deadline,s.last_heartbeat_at+make_interval(secs=>cfg.attendance_disconnect_seconds))<=now() then
        update public.employee_activity_sessions set status='Logged Out',logout_at=greatest(s.login_at,now()),
          logout_source='system',session_state='auto_closed',disconnect_reason='heartbeat_timeout',
          auto_closed=true,estimated_logout=false,closed_at=now() where session_id=s.session_id;
        insert into public.portal_admin_audit_log(admin_name,target_user_id,target_name,action,before_state,after_state,reason)
        values('System',person.id,person.full_name,'attendance_session_auto_closed',
          jsonb_build_object('session_id',s.session_id,'last_heartbeat_at',s.last_heartbeat_at,'status',s.status),
          jsonb_build_object('session_id',s.session_id,'status','Logged Out','logout_at',greatest(s.login_at,now()),'estimated_logout',false),
          'heartbeat_timeout: server closure time; last heartbeat retained');
        insert into public.portal_admin_audit_log(admin_name,target_user_id,target_name,action,after_state,reason)
        values('System',person.id,person.full_name,'heartbeat_timeout',jsonb_build_object('session_id',s.session_id),'No live portal client remained within its lease');
        v_count:=v_count+1;
      elsif coalesce(v_last,s.last_heartbeat_at)<now()-make_interval(secs=>cfg.attendance_heartbeat_seconds*2) then
        update public.employee_activity_sessions set session_state='connection_lost'
          where session_id=s.session_id and session_state<>'connection_lost';
      end if;
    end loop;
  end loop;
  return v_count;
end; $function$;

CREATE OR REPLACE FUNCTION public.portal_workforce_action(p_user_id uuid, p_auth_session uuid, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare actor public.employee_profiles%rowtype; s admin_private.screen_shares%rowtype;
  peer admin_private.screen_peers%rowtype; v_share uuid; v_peer uuid; v_result jsonb;
  v_kind text; v_cursor bigint; v_tab uuid;
begin
  if not admin_private.portal_identity(p_user_id,p_auth_session) then raise exception 'Active portal authorization required' using errcode='42501'; end if;
  select * into actor from public.employee_profiles where id=p_user_id;
  if p_action='portal-login' then
    if not exists(select 1 from public.portal_admin_audit_log where target_user_id=p_user_id and action='portal_login'
      and after_state->>'auth_session_id'=p_auth_session::text) then
      insert into public.portal_admin_audit_log(admin_id,admin_name,target_user_id,target_name,action,after_state)
      values(p_user_id,actor.full_name,p_user_id,actor.full_name,'portal_login',jsonb_build_object('auth_session_id',p_auth_session));
    end if;
    return jsonb_build_object('ok',true);
  elsif p_action='screen-state' then
    if p_payload->>'state' not in ('requested','declined','permission_required','unsupported','stopped') then
      raise exception 'Invalid screen state' using errcode='22023';
    end if;
    perform 1 from public.employee_profiles where id=p_user_id for update;
    if exists(select 1 from admin_private.screen_shares where employee_id=p_user_id and state='active') then
      return jsonb_build_object('ok',true,'state','active');
    end if;
    update public.employee_activity_sessions set screen_share_state=p_payload->>'state'
      where session_id=(p_payload->>'sessionId')::uuid and employee_id=p_user_id and status='Logged In'
        and screen_share_state is distinct from p_payload->>'state';
    if found then
      insert into public.portal_admin_audit_log(admin_id,admin_name,target_user_id,target_name,action,after_state)
      values(p_user_id,actor.full_name,p_user_id,actor.full_name,
        case p_payload->>'state' when 'requested' then 'screen_share_requested' when 'declined' then 'screen_share_declined' else 'screen_share_state_changed' end,
        jsonb_build_object('session_id',p_payload->>'sessionId','state',p_payload->>'state'));
    end if;
    return jsonb_build_object('ok',true);
  end if;
  if p_action='workforce' then
    if actor.role<>'Co-CEO' then raise exception 'Co-CEO authorization required' using errcode='42501'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('userId',p.id,'employeeId',p.employee_id,'fullName',p.full_name,
      'role',p.role,'scheme',p.scheme,'attendanceStatus',a.status,'sessionId',a.session_id,'loginAt',a.login_at,
      'logoutAt',a.logout_at,'lastHeartbeatAt',a.last_heartbeat_at,'sessionState',
      case when a.status='Logged In' and a.last_heartbeat_at<now()-interval '10 seconds' then 'connection_lost' else a.session_state end,
      'autoClosed',a.auto_closed,'estimatedLogout',a.estimated_logout,'disconnectReason',a.disconnect_reason,
      'screenState',a.screen_share_state,'shareId',sh.id,'sharingStarted',sh.started_at) order by p.full_name),'[]')
    into v_result from public.employee_profiles p
    left join lateral (select * from public.employee_activity_sessions a2 where a2.employee_id=p.id order by a2.login_at desc limit 1)a on true
    left join admin_private.screen_shares sh on sh.employee_id=p.id and sh.state='active'
      and sh.last_seen_at>now()-interval '120 seconds' and admin_private.portal_identity(sh.employee_id,sh.auth_session_id)
      and exists(select 1 from public.employee_activity_sessions x where x.session_id=sh.attendance_session_id and x.status='Logged In')
    where p.is_active;
    return jsonb_build_object('rows',v_result,'serverTime',now());
  elsif p_action='ice' then
    if actor.role<>'Co-CEO' and not exists(select 1 from admin_private.screen_shares where employee_id=p_user_id and state='active') then
      raise exception 'Start a share before requesting ICE credentials' using errcode='42501';
    end if;
    return jsonb_build_object('authorized',true);
  elsif p_action='share-start' then
    v_tab:=(p_payload->>'tabId')::uuid;
    if not exists(select 1 from public.employee_activity_sessions a join admin_private.portal_clients c on c.session_id=a.session_id
      where a.session_id=(p_payload->>'sessionId')::uuid and a.employee_id=p_user_id and a.status='Logged In'
        and c.tab_id=v_tab and c.auth_session_id=p_auth_session and c.close_requested_at is null
        and c.last_seen_at>now()-interval '90 seconds') then raise exception 'Active employee portal required' using errcode='42501'; end if;
    perform 1 from public.employee_profiles where id=p_user_id for update;
    perform admin_private.expire_screen_shares();
    if exists(select 1 from admin_private.screen_shares where employee_id=p_user_id and state='active') then
      raise exception 'Another portal tab is already sharing. Stop it first.' using errcode='23505';
    end if;
    if (select count(*) from admin_private.screen_shares where employee_id=p_user_id and started_at>now()-interval '1 minute')>=10 then
      raise exception 'Please wait before starting another share' using errcode='54000';
    end if;
    insert into admin_private.screen_shares(employee_id,attendance_session_id,auth_session_id,tab_id)
      values(p_user_id,(p_payload->>'sessionId')::uuid,p_auth_session,v_tab) returning * into s;
    return jsonb_build_object('shareId',s.id,'startedAt',s.started_at);
  elsif p_action='share-stop' then
    update admin_private.screen_shares set state='ended',ended_at=now(),ended_by=p_user_id,ended_reason='Screen sharing ended by employee'
      where id=(p_payload->>'shareId')::uuid and employee_id=p_user_id and state='active';
    return jsonb_build_object('ok',true);
  elsif p_action='viewer-join' then
    if actor.role<>'Co-CEO' then raise exception 'Co-CEO authorization required' using errcode='42501'; end if;
    select * into s from admin_private.screen_shares where id=(p_payload->>'shareId')::uuid for update;
    if not found or s.employee_id=p_user_id or s.state<>'active' or s.last_seen_at<now()-interval '120 seconds'
      or not admin_private.portal_identity(s.employee_id,s.auth_session_id)
      or not exists(select 1 from public.employee_activity_sessions where session_id=s.attendance_session_id and status='Logged In') then
      raise exception 'Employee is not sharing' using errcode='P0002';
    end if;
    if (select count(*) from admin_private.screen_peers where share_id=s.id and state='active' and viewer_id<>p_user_id)>=3 then
      raise exception 'Viewer limit reached' using errcode='54000';
    end if;
    select * into peer from admin_private.screen_peers where share_id=s.id and viewer_id=p_user_id;
    if peer.id is not null then delete from admin_private.screen_signals where peer_id=peer.id; end if;
    insert into admin_private.screen_peers(share_id,viewer_id,auth_session_id)
      values(s.id,p_user_id,p_auth_session)
    on conflict(share_id,viewer_id) do update set state='active',ended_by=null,generation=admin_private.screen_peers.generation+1,
      auth_session_id=excluded.auth_session_id,last_seen_at=now(),joined_at=now()
    returning * into peer;
    return jsonb_build_object('peerId',peer.id,'shareId',s.id,'generation',peer.generation,'startedAt',s.started_at);
  elsif p_action='poll-owner' then
    select * into s from admin_private.screen_shares where id=(p_payload->>'shareId')::uuid and employee_id=p_user_id;
    if not found then raise exception 'Share unavailable' using errcode='42501'; end if;
    if s.state<>'active' then return jsonb_build_object('active',false,'reason',s.ended_reason); end if;
    if not admin_private.portal_identity(s.employee_id,s.auth_session_id) or not exists(select 1 from public.employee_activity_sessions where session_id=s.attendance_session_id and status='Logged In') then
      update admin_private.screen_shares set state='ended',ended_at=now(),ended_reason='Portal session ended' where id=s.id;
      return jsonb_build_object('active',false,'reason','Portal session ended'); end if;
    update admin_private.screen_shares set last_seen_at=now() where id=s.id;
    update admin_private.screen_peers p set state='ended' where p.share_id=s.id and p.state='active'
      and (p.last_seen_at<now()-interval '30 seconds' or not admin_private.portal_identity(p.viewer_id,p.auth_session_id)
        or not exists(select 1 from public.employee_profiles v where v.id=p.viewer_id and v.role='Co-CEO' and v.is_active));
    v_cursor:=greatest(0,coalesce((p_payload->>'afterId')::bigint,0));
    return jsonb_build_object('active',true,
      'peers',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'generation',p.generation,'viewerName',v.full_name)),'[]')
        from admin_private.screen_peers p join public.employee_profiles v on v.id=p.viewer_id where p.share_id=s.id and p.state='active'),
      'signals',(select coalesce(jsonb_agg(to_jsonb(m)),'[]') from (select sig.id,sig.peer_id,sig.kind,sig.payload
        from admin_private.screen_signals sig join admin_private.screen_peers p on p.id=sig.peer_id
        where p.share_id=s.id and p.state='active' and sig.sender_id<>p_user_id and sig.id>v_cursor order by sig.id limit 100)m));
  elsif p_action in ('poll-viewer','peer-leave','signal') then
    v_peer:=(p_payload->>'peerId')::uuid;
    select * into peer from admin_private.screen_peers where id=v_peer;
    select * into s from admin_private.screen_shares where id=peer.share_id;
    if s.id is null or p_user_id not in(s.employee_id,peer.viewer_id) then raise exception 'Viewer access denied' using errcode='42501'; end if;
    if p_user_id=peer.viewer_id and (actor.role<>'Co-CEO' or peer.auth_session_id<>p_auth_session) then
      raise exception 'Co-CEO authorization required' using errcode='42501';
    end if;
    if peer.generation is distinct from (p_payload->>'generation')::integer then return jsonb_build_object('active',false,'reason','Viewer connection replaced'); end if;
    if p_action='peer-leave' then
      update admin_private.screen_peers set state='ended',ended_by=p_user_id where id=v_peer and state='active';
      return jsonb_build_object('ok',true);
    end if;
    if not admin_private.portal_identity(peer.viewer_id,peer.auth_session_id) or not exists(select 1 from public.employee_profiles where id=peer.viewer_id and role='Co-CEO' and is_active) then
      update admin_private.screen_peers set state='ended' where id=peer.id;
      return jsonb_build_object('active',false,'reason','Viewer authorization ended'); end if;
    if s.state<>'active' or peer.state<>'active' or not admin_private.portal_identity(s.employee_id,s.auth_session_id)
      or s.last_seen_at<now()-interval '120 seconds'
      or not exists(select 1 from public.employee_activity_sessions where session_id=s.attendance_session_id and status='Logged In') then
      return jsonb_build_object('active',false,'reason',coalesce(s.ended_reason,'Screen sharing ended by employee'));
    end if;
    if p_action='poll-viewer' then
      if p_user_id<>peer.viewer_id then raise exception 'Viewer access denied' using errcode='42501'; end if;
      update admin_private.screen_peers set last_seen_at=now() where id=v_peer;
      v_cursor:=greatest(0,coalesce((p_payload->>'afterId')::bigint,0));
      return jsonb_build_object('active',true,'signals',(select coalesce(jsonb_agg(to_jsonb(m)),'[]') from (
        select id,peer_id,kind,payload from admin_private.screen_signals
        where peer_id=v_peer and sender_id<>p_user_id and id>v_cursor order by id limit 100)m));
    end if;
    v_kind:=p_payload->>'kind';
    if v_kind not in ('offer','answer','ice') or p_payload->'payload' is null
      or octet_length((p_payload->'payload')::text)>65536
      or (v_kind='offer' and p_user_id<>s.employee_id)
      or (v_kind='answer' and p_user_id<>peer.viewer_id) then raise exception 'Invalid signaling message' using errcode='22023'; end if;
    if (select count(*) from admin_private.screen_signals where peer_id=v_peer and sender_id=p_user_id and created_at>now()-interval '1 minute')>=180 then
      raise exception 'Signaling rate limit' using errcode='54000';
    end if;
    insert into admin_private.screen_signals(peer_id,sender_id,kind,payload) values(v_peer,p_user_id,v_kind,p_payload->'payload');
    return jsonb_build_object('ok',true,'active',true);
  end if;
  raise exception 'Invalid workforce action' using errcode='22023';
end; $function$;

create function admin_private.portal_screen_state_metadata()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.employee_activity_sessions set screen_share_state=case when new.state='active' then 'active' else 'stopped' end
 where session_id=new.attendance_session_id;
 return new;
end; $$;
revoke all on function admin_private.portal_screen_state_metadata() from public,anon,authenticated,service_role;
create trigger portal_screen_state_metadata after insert or update of state on admin_private.screen_shares
 for each row execute function admin_private.portal_screen_state_metadata();
select cron.schedule('linkora-portal-session-leases','1 second','select admin_private.portal_lease_tick()');
create or replace function public.portal_sheet_auto_closed(p_day date)
returns table(user_id uuid,auto_closed boolean) language sql stable set search_path='' as $$
 select a.employee_id,bool_or(a.auto_closed) from public.employee_activity_sessions a
 where (a.login_at at time zone (select timezone from public.company_settings where id=true))::date=p_day
 and a.auto_closed group by a.employee_id;
$$;
