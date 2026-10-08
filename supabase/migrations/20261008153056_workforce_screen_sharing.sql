-- Signaling metadata only. No video, audio, screenshots or recordings are stored.
create table admin_private.screen_shares (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employee_profiles(id) on delete restrict,
  attendance_session_id uuid not null references public.employee_activity_sessions(session_id) on delete restrict,
  auth_session_id uuid not null,
  tab_id uuid not null,
  state text not null default 'active' check(state in ('active','ended')),
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by uuid references public.employee_profiles(id) on delete restrict,
  ended_reason text
);
create unique index screen_share_one_employee on admin_private.screen_shares(employee_id) where state='active';
create index screen_share_active_lease on admin_private.screen_shares(last_seen_at) where state='active';
create table admin_private.screen_peers (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references admin_private.screen_shares(id) on delete restrict,
  viewer_id uuid not null references public.employee_profiles(id) on delete restrict,
  auth_session_id uuid not null,
  state text not null default 'active' check(state in ('active','ended')),
  generation integer not null default 1,
  ended_by uuid references public.employee_profiles(id) on delete restrict,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique(share_id,viewer_id)
);
create table admin_private.screen_signals (
  id bigint generated always as identity primary key,
  peer_id uuid not null references admin_private.screen_peers(id) on delete cascade,
  sender_id uuid not null references public.employee_profiles(id) on delete restrict,
  kind text not null check(kind in ('offer','answer','ice')),
  payload jsonb not null check(octet_length(payload::text)<=65536),
  created_at timestamptz not null default now()
);
create index screen_signal_poll on admin_private.screen_signals(peer_id,id);
create index screen_signal_retention on admin_private.screen_signals(created_at);
alter table admin_private.screen_shares enable row level security;
alter table admin_private.screen_peers enable row level security;
alter table admin_private.screen_signals enable row level security;
revoke all on admin_private.screen_shares,admin_private.screen_peers,admin_private.screen_signals from public,anon,authenticated;
grant select,insert,update,delete on admin_private.screen_shares,admin_private.screen_peers,admin_private.screen_signals to service_role;
grant usage,select on sequence admin_private.screen_signals_id_seq to service_role;

create function admin_private.screen_share_audit()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_name text; v_actor text;
begin
  select full_name into v_name from public.employee_profiles where id=new.employee_id;
  if tg_op='INSERT' then
    insert into public.portal_admin_audit_log(admin_id,admin_name,target_user_id,target_name,action,after_state,reason)
    values(new.employee_id,v_name,new.employee_id,v_name,'screen_share_started',
      jsonb_build_object('share_id',new.id,'session_id',new.attendance_session_id,'started_at',new.started_at),
      'Employee explicitly started browser-selected live screen sharing; video only, no recording');
  elsif old.state='active' and new.state='ended' then
    select full_name into v_actor from public.employee_profiles where id=new.ended_by;
    update admin_private.screen_peers set state='ended' where share_id=new.id;
    delete from admin_private.screen_signals where peer_id in(select id from admin_private.screen_peers where share_id=new.id);
    insert into public.portal_admin_audit_log(admin_id,admin_name,target_user_id,target_name,action,after_state,reason)
    values(new.ended_by,coalesce(v_actor,'System'),new.employee_id,v_name,'screen_share_stopped',
      jsonb_build_object('share_id',new.id,'session_id',new.attendance_session_id,'ended_at',new.ended_at),new.ended_reason);
  end if;
  return new;
end; $$;
revoke all on function admin_private.screen_share_audit() from public,anon,authenticated;
create trigger screen_share_audit after insert or update of state on admin_private.screen_shares
  for each row execute function admin_private.screen_share_audit();

create function admin_private.screen_peer_audit()
returns trigger language plpgsql security definer set search_path='' as $$
declare s admin_private.screen_shares%rowtype; v_actor text; v_target text;
begin
  if tg_op='UPDATE' and old.state=new.state and old.generation=new.generation then return new; end if;
  select * into s from admin_private.screen_shares where id=new.share_id;
  select full_name into v_actor from public.employee_profiles where id=case when new.state='active' then new.viewer_id else new.ended_by end;
  select full_name into v_target from public.employee_profiles where id=s.employee_id;
  insert into public.portal_admin_audit_log(admin_id,admin_name,target_user_id,target_name,action,after_state)
  values(case when new.state='active' then new.viewer_id else new.ended_by end,coalesce(v_actor,'System'),s.employee_id,v_target,case when new.state='active' then 'screen_viewer_joined' else 'screen_viewer_left' end,
    jsonb_build_object('share_id',new.share_id,'viewer_id',new.viewer_id,'peer_id',new.id));
  if new.state='ended' then delete from admin_private.screen_signals where peer_id=new.id; end if;
  return new;
end; $$;
revoke all on function admin_private.screen_peer_audit() from public,anon,authenticated;
create trigger screen_peer_audit after insert or update of state,generation on admin_private.screen_peers
  for each row execute function admin_private.screen_peer_audit();

create function admin_private.expire_screen_shares()
returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
  update admin_private.screen_shares s set state='ended',ended_at=now(),ended_reason='Portal or sharing connection ended'
    where s.state='active' and (s.last_seen_at<now()-interval '120 seconds'
      or not admin_private.portal_identity(s.employee_id,s.auth_session_id)
      or not exists(select 1 from public.employee_activity_sessions a where a.session_id=s.attendance_session_id and a.status='Logged In'));
  get diagnostics v_count=row_count;
  update admin_private.screen_peers p set state='ended' where p.state='active'
    and (p.last_seen_at<now()-interval '30 seconds' or not admin_private.portal_identity(p.viewer_id,p.auth_session_id)
      or not exists(select 1 from public.employee_profiles v where v.id=p.viewer_id and v.is_active and v.role='Co-CEO'));
  -- ICE/SDP addresses are transient, not an audit record.
  delete from admin_private.screen_signals where created_at<now()-interval '2 minutes';
  return v_count;
end; $$;
revoke all on function admin_private.expire_screen_shares() from public,anon,authenticated;
grant execute on function admin_private.expire_screen_shares() to service_role;

create function public.portal_workforce_action(p_user_id uuid,p_auth_session uuid,p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql set search_path='' as $$
declare actor public.employee_profiles%rowtype; s admin_private.screen_shares%rowtype;
  peer admin_private.screen_peers%rowtype; v_share uuid; v_peer uuid; v_result jsonb;
  v_kind text; v_cursor bigint; v_tab uuid;
begin
  if not admin_private.portal_identity(p_user_id,p_auth_session) then raise exception 'Active portal authorization required' using errcode='42501'; end if;
  select * into actor from public.employee_profiles where id=p_user_id;
  if p_action='workforce' then
    if actor.role<>'Co-CEO' then raise exception 'Co-CEO authorization required' using errcode='42501'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('userId',p.id,'employeeId',p.employee_id,'fullName',p.full_name,
      'role',p.role,'scheme',p.scheme,'attendanceStatus',a.status,'sessionId',a.session_id,'loginAt',a.login_at,
      'logoutAt',a.logout_at,'lastHeartbeatAt',a.last_heartbeat_at,'sessionState',
      case when a.status='Logged In' and a.last_heartbeat_at<now()-interval '90 seconds' then 'connection_lost' else a.session_state end,
      'autoClosed',a.auto_closed,'estimatedLogout',a.estimated_logout,'disconnectReason',a.disconnect_reason,
      'shareId',sh.id,'sharingStarted',sh.started_at) order by p.full_name),'[]')
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
end; $$;
revoke all on function public.portal_workforce_action(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.portal_workforce_action(uuid,uuid,text,jsonb) to service_role;

-- One batched lookup enriches existing admin history without changing its RPC signature.
create function public.portal_attendance_presence_metadata(p_sessions uuid[])
returns table(session_id uuid,last_heartbeat_at timestamptz,session_state text,disconnect_reason text,
  auto_closed boolean,estimated_logout boolean,closed_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_admin() or not admin_private.portal_identity(auth.uid(),(auth.jwt()->>'session_id')::uuid) then
    raise exception 'Co-CEO authorization required' using errcode='42501';
  end if;
  if cardinality(p_sessions)>500 then raise exception 'Invalid session batch' using errcode='22023'; end if;
  return query select a.session_id,a.last_heartbeat_at,a.session_state,a.disconnect_reason,a.auto_closed,a.estimated_logout,a.closed_at
    from public.employee_activity_sessions a where a.session_id=any(p_sessions);
end; $$;
revoke all on function public.portal_attendance_presence_metadata(uuid[]) from public,anon,authenticated;
grant execute on function public.portal_attendance_presence_metadata(uuid[]) to authenticated;

-- Closing the sharing tab ends only its stream, even if another portal tab keeps attendance alive.
create or replace function public.portal_presence_close(p_session uuid,p_tab uuid,p_hash text)
returns boolean language plpgsql set search_path='' as $$
declare accepted boolean;
begin
  update admin_private.portal_clients set close_requested_at=coalesce(close_requested_at,now())
    where session_id=p_session and tab_id=p_tab and close_token_hash=p_hash and close_requested_at is null;
  accepted:=found;
  if accepted then
    update admin_private.screen_shares set state='ended',ended_at=now(),ended_by=employee_id,ended_reason='Sharing portal tab closed'
      where attendance_session_id=p_session and tab_id=p_tab and state='active';
  end if;
  return accepted;
end; $$;
