grant usage on schema admin_private to service_role;
-- Additive tracking only. Existing untracked history is not timed out or rewritten.
alter table public.company_settings
  add column attendance_heartbeat_seconds integer not null default 30 check (attendance_heartbeat_seconds between 20 and 60),
  add column attendance_disconnect_seconds integer not null default 180 check (attendance_disconnect_seconds between 120 and 600),
  add column attendance_background_seconds integer not null default 900 check (attendance_background_seconds between 300 and 3600),
  add column attendance_close_grace_seconds integer not null default 15 check (attendance_close_grace_seconds between 10 and 60);
alter table public.employee_activity_sessions
  add column last_heartbeat_at timestamptz,
  add column session_state text not null default 'legacy' check (session_state in ('legacy','active','connection_lost','completed','auto_closed','manually_closed')),
  add column disconnect_reason text,
  add column auto_closed boolean not null default false,
  add column estimated_logout boolean not null default false,
  add column closed_at timestamptz;
alter table public.employee_activity_sessions drop constraint employee_activity_sessions_logout_source_check;
alter table public.employee_activity_sessions add constraint employee_activity_sessions_logout_source_check
  check (logout_source in ('user','admin','system'));
create unique index portal_one_tracked_session on public.employee_activity_sessions(employee_id)
  where status='Logged In' and last_heartbeat_at is not null;
create index portal_expiry_sessions on public.employee_activity_sessions(last_heartbeat_at)
  where status='Logged In' and last_heartbeat_at is not null;

create table admin_private.portal_clients (
  session_id uuid not null references public.employee_activity_sessions(session_id) on delete restrict,
  tab_id uuid not null,
  client_id uuid not null,
  auth_session_id uuid not null,
  last_seen_at timestamptz not null default now(),
  background boolean not null default false,
  close_requested_at timestamptz,
  close_token_hash text not null check (close_token_hash ~ '^[0-9a-f]{64}$'),
  primary key(session_id,tab_id)
);
create index portal_clients_seen on admin_private.portal_clients(session_id,last_seen_at);
alter table admin_private.portal_clients enable row level security;
revoke all on admin_private.portal_clients from public, anon, authenticated;
grant select,insert,update,delete on admin_private.portal_clients to service_role;

-- Private lookup prevents exposing auth.sessions to service-role Data API callers.
create function admin_private.portal_identity(p_user uuid,p_auth_session uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from auth.sessions s join public.employee_profiles p on p.id=s.user_id
    where s.id=p_auth_session and s.user_id=p_user and p.is_active
      and (s.not_after is null or s.not_after>now()));
$$;
revoke all on function admin_private.portal_identity(uuid,uuid) from public,anon,authenticated;
grant execute on function admin_private.portal_identity(uuid,uuid) to service_role;

alter table public.portal_admin_audit_log drop constraint portal_admin_audit_log_action_check;
alter table public.portal_admin_audit_log add constraint portal_admin_audit_log_action_check check(action in (
  'user_created','user_edited','user_disabled','user_enabled','role_changed','attendance_signed_in',
  'attendance_signed_out','stale_session_flagged','attendance_settings_changed','attendance_corrected',
  'attendance_manually_added','leave_created','leave_changed','attendance_session_started',
  'attendance_session_normal_logout','attendance_session_portal_closed','attendance_session_auto_closed',
  'attendance_tracking_started','heartbeat_timeout','screen_share_started','screen_share_stopped',
  'screen_viewer_joined','screen_viewer_left'));

create function admin_private.portal_session_metadata()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and new.corrected_at is distinct from old.corrected_at then
    new.auto_closed:=false; new.estimated_logout:=false;
    new.disconnect_reason:='manual_correction';
    new.session_state:=case when new.logout_at is null then 'legacy' else 'manually_closed' end;
    new.last_heartbeat_at:=case when new.logout_at is null then null else new.last_heartbeat_at end;
  elsif tg_op='UPDATE' and old.status='Logged In' and new.status='Logged Out' then
    new.closed_at:=coalesce(new.closed_at,now());
    if new.auto_closed then new.session_state:='auto_closed';
    elsif new.logout_source='admin' then new.session_state:='manually_closed';
    else new.session_state:='completed'; end if;
  end if;
  return new;
end; $$;
revoke all on function admin_private.portal_session_metadata() from public,anon,authenticated;
create trigger portal_session_metadata before update on public.employee_activity_sessions
  for each row execute function admin_private.portal_session_metadata();

create function admin_private.portal_session_audit()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_name text;
begin
  select full_name into v_name from public.employee_profiles where id=new.employee_id;
  if tg_op='INSERT' and new.login_source='user' then
    insert into public.portal_admin_audit_log(admin_id,admin_name,target_user_id,target_name,action,after_state)
    values(new.employee_id,v_name,new.employee_id,v_name,'attendance_session_started',
      jsonb_build_object('session_id',new.session_id,'login_at',new.login_at));
  elsif tg_op='UPDATE' and old.status='Logged In' and new.status='Logged Out' and new.logout_source='user' then
    insert into public.portal_admin_audit_log(admin_id,admin_name,target_user_id,target_name,action,before_state,after_state,reason)
    values(new.employee_id,v_name,new.employee_id,v_name,
      case when new.disconnect_reason='portal_closed' then 'attendance_session_portal_closed' else 'attendance_session_normal_logout' end,
      jsonb_build_object('session_id',new.session_id,'status',old.status),
      jsonb_build_object('session_id',new.session_id,'logout_at',new.logout_at,'status',new.status),new.disconnect_reason);
  end if;
  if tg_op='UPDATE' and new.status<>'Logged In' then
    update admin_private.portal_clients set close_requested_at=coalesce(close_requested_at,now())
      where session_id=new.session_id;
  end if;
  return new;
end; $$;
revoke all on function admin_private.portal_session_audit() from public,anon,authenticated;
create trigger portal_session_audit after insert or update of status on public.employee_activity_sessions
  for each row execute function admin_private.portal_session_audit();

create function admin_private.expire_portal_sessions(p_employee uuid default null)
returns integer language plpgsql security definer set search_path='' as $$
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
        update public.employee_activity_sessions set status='Logged Out',logout_at=greatest(s.login_at,v_closed),
          logout_source='user',session_state='completed',disconnect_reason='portal_closed',
          auto_closed=false,estimated_logout=false,closed_at=now() where session_id=s.session_id;
        v_count:=v_count+1;
      elsif not v_all_closed and coalesce(v_deadline,s.last_heartbeat_at+make_interval(secs=>cfg.attendance_disconnect_seconds))<=now() then
        update public.employee_activity_sessions set status='Logged Out',logout_at=greatest(s.login_at,s.last_heartbeat_at),
          logout_source='system',session_state='auto_closed',disconnect_reason='heartbeat_timeout',
          auto_closed=true,estimated_logout=true,closed_at=now() where session_id=s.session_id;
        insert into public.portal_admin_audit_log(admin_name,target_user_id,target_name,action,before_state,after_state,reason)
        values('System',person.id,person.full_name,'attendance_session_auto_closed',
          jsonb_build_object('session_id',s.session_id,'last_heartbeat_at',s.last_heartbeat_at,'status',s.status),
          jsonb_build_object('session_id',s.session_id,'status','Logged Out','logout_at',greatest(s.login_at,s.last_heartbeat_at),'estimated_logout',true),
          'heartbeat_timeout: estimated logout is the last server-observed heartbeat');
        insert into public.portal_admin_audit_log(admin_name,target_user_id,target_name,action,after_state,reason)
        values('System',person.id,person.full_name,'heartbeat_timeout',jsonb_build_object('session_id',s.session_id),'No live portal client remained within its lease');
        v_count:=v_count+1;
      elsif coalesce(v_last,s.last_heartbeat_at)<now()-make_interval(secs=>cfg.attendance_heartbeat_seconds*3) then
        update public.employee_activity_sessions set session_state='connection_lost'
          where session_id=s.session_id and session_state<>'connection_lost';
      end if;
    end loop;
  end loop;
  return v_count;
end; $$;
revoke all on function admin_private.expire_portal_sessions(uuid) from public,anon,authenticated;
grant execute on function admin_private.expire_portal_sessions(uuid) to service_role;

-- A tracked live overnight session resumes; old untracked rows retain the existing review behavior.
create or replace function public.portal_employee_start_session(p_user_id uuid,p_session_id uuid)
returns jsonb language plpgsql set search_path='' as $$
declare p public.employee_profiles%rowtype; v_zone text; v_existing uuid; v_stale record;
begin
  select * into p from public.employee_profiles where id=p_user_id for update;
  if not found or not p.is_active then raise exception 'Employee account is not active' using errcode='42501'; end if;
  perform admin_private.expire_portal_sessions(p_user_id);
  select timezone into v_zone from public.company_settings where id=true;
  for v_stale in select session_id,login_at from public.employee_activity_sessions
    where employee_id=p_user_id and status='Logged In' and last_heartbeat_at is null
      and (login_at at time zone v_zone)::date<>(now() at time zone v_zone)::date for update
  loop
    update public.employee_activity_sessions set status='Needs Review' where session_id=v_stale.session_id;
    insert into public.portal_admin_audit_log(admin_name,target_user_id,target_name,action,before_state,after_state,reason)
    values('System',p_user_id,p.full_name,'stale_session_flagged',
      jsonb_build_object('session_id',v_stale.session_id,'status','Logged In','login_at',v_stale.login_at),
      jsonb_build_object('session_id',v_stale.session_id,'status','Needs Review'),'Prior-day untracked session requires review; no time was invented');
  end loop;
  select session_id into v_existing from public.employee_activity_sessions
    where employee_id=p_user_id and status='Logged In' order by last_heartbeat_at desc nulls last,login_at desc limit 1;
  if v_existing is not null then return jsonb_build_object('sessionId',v_existing,'alreadyOpen',true); end if;
  insert into public.employee_activity_sessions(session_id,employee_id,login_at,status,login_source)
    values(p_session_id,p_user_id,now(),'Logged In','user');
  return jsonb_build_object('sessionId',p_session_id,'alreadyOpen',false);
end; $$;

create function public.portal_presence_action(p_user_id uuid,p_auth_session uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare cfg public.company_settings%rowtype; s public.employee_activity_sessions%rowtype;
  v_id uuid; v_tab uuid; v_client uuid; v_started jsonb; v_hash text; v_name text; c admin_private.portal_clients%rowtype;
begin
  if not admin_private.portal_identity(p_user_id,p_auth_session) then raise exception 'Active portal authorization required' using errcode='42501'; end if;
  if p_action not in ('connect','heartbeat') then raise exception 'Invalid presence action' using errcode='22023'; end if;
  v_tab:=(p_payload->>'tabId')::uuid; v_client:=(p_payload->>'clientId')::uuid;
  if v_tab is null or v_client is null then raise exception 'Client IDs required' using errcode='22023'; end if;
  select * into cfg from public.company_settings where id=true;
  -- Lock the same profile as session start/end to serialize races.
  perform 1 from public.employee_profiles where id=p_user_id for update;
  if p_action='connect' then
    v_id:=(p_payload->>'sessionId')::uuid;
    v_hash:=p_payload->>'closeTokenHash';
    if v_id is null or v_hash is null or v_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid connection' using errcode='22023'; end if;
    if (select count(*) from admin_private.portal_clients c2 join public.employee_activity_sessions a on a.session_id=c2.session_id
      where a.employee_id=p_user_id and a.status='Logged In' and c2.close_requested_at is null and c2.last_seen_at>now()-interval '1 minute')>=20
      and not exists(select 1 from admin_private.portal_clients where tab_id=v_tab and client_id=v_client) then
      raise exception 'Too many portal tabs' using errcode='54000';
    end if;
    v_started:=public.portal_employee_start_session(p_user_id,v_id);
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
    if c.last_seen_at<now()-interval '10 seconds' or c.background is distinct from coalesce((p_payload->>'background')::boolean,false) then
      update admin_private.portal_clients set last_seen_at=now(),close_requested_at=null,
        background=coalesce((p_payload->>'background')::boolean,false) where session_id=v_id and tab_id=v_tab;
    end if;
  end if;
  if s.last_heartbeat_at is null or s.last_heartbeat_at<now()-interval '10 seconds' or p_action='connect' or s.session_state<>'active' then
    update public.employee_activity_sessions set last_heartbeat_at=now(),session_state='active',disconnect_reason=null
      where session_id=v_id and status='Logged In';
  end if;
  return jsonb_build_object('active',true,'sessionId',v_id,'sessionState','active','lastHeartbeatAt',(select a.last_heartbeat_at from public.employee_activity_sessions a where a.session_id=v_id),
    'alreadyOpen',coalesce((v_started->>'alreadyOpen')::boolean,true),'heartbeatSeconds',cfg.attendance_heartbeat_seconds,
    'disconnectSeconds',cfg.attendance_disconnect_seconds,'backgroundSeconds',cfg.attendance_background_seconds,
    'closeGraceSeconds',cfg.attendance_close_grace_seconds);
end; $$;
revoke all on function public.portal_presence_action(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.portal_presence_action(uuid,uuid,text,jsonb) to service_role;

-- A close token is a capability for this one tab only: cannot read data, capture media or send heartbeats.
create function public.portal_presence_close(p_session uuid,p_tab uuid,p_hash text)
returns boolean language plpgsql set search_path='' as $$
begin
  update admin_private.portal_clients set close_requested_at=coalesce(close_requested_at,now())
    where session_id=p_session and tab_id=p_tab and close_token_hash=p_hash and close_requested_at is null;
  return found;
end; $$;
revoke all on function public.portal_presence_close(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.portal_presence_close(uuid,uuid,text) to service_role;

-- Strict session identity avoids an old tab closing a newer completed/restarted session.
create or replace function public.portal_employee_end_session(p_user_id uuid,p_session_id uuid default null)
returns jsonb language plpgsql set search_path='' as $$
declare s public.employee_activity_sessions%rowtype; p public.employee_profiles%rowtype; cfg public.company_settings%rowtype;
begin
  select * into p from public.employee_profiles where id=p_user_id for update;
  if not found then raise exception 'Employee profile not found' using errcode='P0002'; end if;
  select * into s from public.employee_activity_sessions where employee_id=p_user_id and status='Logged In'
    and (p_session_id is null or session_id=p_session_id) order by login_at desc limit 1 for update;
  if not found then return jsonb_build_object('alreadyClosed',true,'sessionId',p_session_id); end if;
  select * into cfg from public.company_settings where id=true;
  if s.last_heartbeat_at is null and ((s.login_at at time zone cfg.timezone)::date<>(now() at time zone cfg.timezone)::date
    or s.login_at<now()-make_interval(hours=>cfg.max_session_hours)) then
    update public.employee_activity_sessions set status='Needs Review' where session_id=s.session_id;
    insert into public.portal_admin_audit_log(admin_name,target_user_id,target_name,action,before_state,after_state,reason)
    values('System',p_user_id,p.full_name,'stale_session_flagged',jsonb_build_object('session_id',s.session_id,'status','Logged In'),
      jsonb_build_object('session_id',s.session_id,'status','Needs Review'),'Old untracked session requires Co-CEO review; no sign-out time invented');
    return jsonb_build_object('alreadyClosed',true,'flaggedForReview',true,'sessionId',s.session_id);
  end if;
  update public.employee_activity_sessions set logout_at=greatest(now(),s.login_at),status='Logged Out',
    logout_source='user',auto_closed=false,estimated_logout=false,disconnect_reason='manual_logout',closed_at=now()
    where session_id=s.session_id;
  return jsonb_build_object('alreadyClosed',false,'sessionId',s.session_id);
end; $$;
