-- Screen video only. Private metadata; privileged RPCs reuse current portal identity.
create table admin_private.screen_recording_settings (
 id boolean primary key default true check(id), enabled boolean not null default false,
 required boolean not null default true check(required), retention_days integer not null default 90 check(retention_days=90),
 segment_seconds integer not null default 60 check(segment_seconds between 15 and 120),
 target_fps integer not null default 10 check(target_fps between 5 and 15),
 target_bitrate integer not null default 500000 check(target_bitrate between 200000 and 1500000),
 max_segment_bytes bigint not null default 8388608 check(max_segment_bytes between 1048576 and 8388608),
 max_queue_bytes bigint not null default 25165824 check(max_queue_bytes between 8388608 and 33554432),
 storage_budget_bytes bigint not null default 0 check(storage_budget_bytes>=0),
 notice_version integer not null default 1,
 notice text not null default 'During an active Clock-In session, the entire screen you share will be visible to authorized management and recorded for attendance and work-review purposes. Screen video only is captured. Microphone, webcam and audio are not recorded. Recordings may be retained for up to 90 days. Recording stops when your work session ends.',
 policy_ready boolean not null default false,
 updated_at timestamptz not null default now(), updated_by uuid references public.employee_profiles(id) on delete restrict,
 check(not enabled or (policy_ready and storage_budget_bytes>0))
);
insert into admin_private.screen_recording_settings(id) values(true);
create table admin_private.screen_recordings (
 id uuid primary key default gen_random_uuid(),
 employee_id uuid not null references public.employee_profiles(id) on delete restrict,
 attendance_session_id uuid not null unique references public.employee_activity_sessions(session_id) on delete restrict,
 auth_session_id uuid not null, tab_id uuid not null, generation integer not null default 1,
 started_at timestamptz not null default now(), ended_at timestamptz, finalized_at timestamptz,
 status text not null default 'initializing' check(status in ('initializing','recording','upload_issue','finalizing','completed','incomplete','interrupted','deleting','deleted','expired')),
 mime_type text not null check(mime_type in ('video/webm','video/mp4')),
 codec text not null, display_surface text not null check(display_surface in ('monitor','unknown')),
 notice_version integer not null, owner_seen_at timestamptz not null default now(),
 retention_until timestamptz not null default now()+interval '90 days',
 total_segments integer not null default 0, total_duration_seconds numeric not null default 0,
 total_size_bytes bigint not null default 0, expected_segments integer,
 had_issue boolean not null default false, termination_reason text,
 created_at timestamptz not null default now()
);
create index screen_recordings_employee_date on admin_private.screen_recordings(employee_id,started_at desc,id);
create index screen_recordings_date on admin_private.screen_recordings(started_at desc,id);
create index screen_recordings_retention on admin_private.screen_recordings(retention_until,id) where status not in ('expired','deleted');
create index screen_recordings_running on admin_private.screen_recordings(owner_seen_at) where status in ('initializing','recording','upload_issue');
create table admin_private.screen_recording_segments (
 id uuid primary key default gen_random_uuid(), recording_id uuid not null references admin_private.screen_recordings(id) on delete restrict,
 sequence_number integer not null check(sequence_number between 1 and 10000), generation integer not null,
 storage_path text not null unique, started_at timestamptz not null, ended_at timestamptz not null,
 duration_seconds numeric not null check(duration_seconds>0 and duration_seconds<=180),
 size_bytes bigint not null check(size_bytes>0 and size_bytes<=8388608),
 mime_type text not null check(mime_type in ('video/webm','video/mp4')),
 upload_status text not null default 'pending' check(upload_status in ('pending','stored','missing','deleted')),
 created_at timestamptz not null default now(), stored_at timestamptz,
 unique(recording_id,sequence_number),check(ended_at>=started_at)
);
create index screen_recording_pending on admin_private.screen_recording_segments(created_at) where upload_status='pending';
create table admin_private.screen_recording_events (
 id bigint generated always as identity primary key,recording_id uuid references admin_private.screen_recordings(id) on delete restrict,
 actor_id uuid references public.employee_profiles(id) on delete restrict,
 event text not null check(event in ('started','segment_uploaded','upload_failed','resumed','completed','interrupted','viewed','expired','deleted','settings_changed','connection_lost','connection_restored')),
 details jsonb not null default '{}',created_at timestamptz not null default now()
);
create index screen_recording_events_actor on admin_private.screen_recording_events(actor_id);
create index screen_recording_settings_actor on admin_private.screen_recording_settings(updated_by);
create index screen_recording_events_recording on admin_private.screen_recording_events(recording_id,created_at desc);
-- No client reads of metadata or storage: access runs through fresh server-side Co-CEO checks.
do $$ declare t text; begin
 foreach t in array array['screen_recording_settings','screen_recordings','screen_recording_segments','screen_recording_events'] loop
 execute format('alter table admin_private.%I enable row level security',t);
 execute format('revoke all on admin_private.%I from public,anon,authenticated',t);
 execute format('grant select,insert,update,delete on admin_private.%I to service_role',t);
 end loop;
end $$;
grant usage,select on sequence admin_private.screen_recording_events_id_seq to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('employee-screen-recordings','employee-screen-recordings',false,8388608,array['video/webm','video/mp4']);

create function admin_private.recording_event(p_recording uuid,p_actor uuid,p_event text,p_details jsonb default '{}')
returns void language sql set search_path='' as $$
 insert into admin_private.screen_recording_events(recording_id,actor_id,event,details)
 values(p_recording,p_actor,p_event,p_details);
$$;
revoke all on function admin_private.recording_event(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function admin_private.recording_event(uuid,uuid,text,jsonb) to service_role;

create function admin_private.recording_totals(p_recording uuid)
returns void language sql set search_path='' as $$
 update admin_private.screen_recordings r set
 total_segments=(select count(*) from admin_private.screen_recording_segments where recording_id=r.id and upload_status='stored'),
 total_duration_seconds=(select coalesce(sum(duration_seconds),0) from admin_private.screen_recording_segments where recording_id=r.id and upload_status='stored'),
 total_size_bytes=(select coalesce(sum(size_bytes),0) from admin_private.screen_recording_segments where recording_id=r.id and upload_status='stored')
 where r.id=p_recording;
$$;
revoke all on function admin_private.recording_totals(uuid) from public,anon,authenticated;
grant execute on function admin_private.recording_totals(uuid) to service_role;

create function admin_private.recording_attendance_ended()
returns trigger language plpgsql security definer set search_path='' as $$
declare r admin_private.screen_recordings%rowtype;
begin
 if old.status='Logged In' and new.status<>'Logged In' then
  update admin_private.screen_recordings set status=case when status='finalizing' and not new.auto_closed and new.logout_source='user' then 'completed' when status in ('completed','incomplete','deleting','deleted','expired') then status else 'interrupted' end,
   ended_at=coalesce(ended_at,new.logout_at,now()),termination_reason=coalesce(termination_reason,new.disconnect_reason,'attendance_ended'),
   had_issue=had_issue or (status<>'finalizing' and status not in ('completed','deleting','deleted','expired')) or new.auto_closed
   where attendance_session_id=new.session_id and status not in ('deleted','expired') returning * into r;
  if found and r.status='completed' then perform admin_private.recording_event(r.id,null,'completed',jsonb_build_object('segments',r.total_segments)); end if;
  if found and r.status='interrupted' then perform admin_private.recording_event(r.id,null,'interrupted',jsonb_build_object('reason',r.termination_reason)); end if;
 end if;
 return new;
end $$;
revoke all on function admin_private.recording_attendance_ended() from public,anon,authenticated,service_role;
create trigger recording_attendance_ended after update of status on public.employee_activity_sessions
 for each row execute function admin_private.recording_attendance_ended();

-- Only exact reserved immutable objects for the live recording owner may be inserted.
create function admin_private.recording_upload_allowed(p_path text,p_metadata jsonb)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from admin_private.screen_recording_segments s
 join admin_private.screen_recordings r on r.id=s.recording_id
 join public.employee_activity_sessions a on a.session_id=r.attendance_session_id
 join admin_private.portal_clients c on c.session_id=a.session_id and c.tab_id=r.tab_id
 where s.storage_path=p_path and (p_metadata->>'size')::bigint=s.size_bytes and s.upload_status='pending' and s.generation=r.generation
 and r.employee_id=(select auth.uid()) and r.auth_session_id=((select auth.jwt())->>'session_id')::uuid
 and admin_private.portal_identity(r.employee_id,r.auth_session_id)
 and r.status in ('recording','upload_issue') and r.retention_until>now()
 and a.status='Logged In' and c.auth_session_id=r.auth_session_id and c.close_requested_at is null
 and c.last_seen_at>now()-interval '15 seconds' and r.owner_seen_at>now()-interval '20 seconds');
$$;
revoke all on function admin_private.recording_upload_allowed(text,jsonb) from public,anon;
grant execute on function admin_private.recording_upload_allowed(text,jsonb) to authenticated,service_role;
create policy screen_recording_reserved_insert on storage.objects for insert to authenticated
 with check(bucket_id='employee-screen-recordings' and admin_private.recording_upload_allowed(name,metadata));
-- No SELECT/UPDATE/DELETE policy is granted for this bucket.

alter function public.portal_presence_action(uuid,uuid,text,jsonb) rename to portal_presence_unrecorded_action;
create function public.portal_presence_action(p_user_id uuid,p_auth_session uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql set search_path='' as $$
begin
 if p_action='clock-in' and (select enabled from admin_private.screen_recording_settings where id=true) then
  raise exception 'Recording consent and permission must precede Clock In' using errcode='42501';
 end if;
 return public.portal_presence_unrecorded_action(p_user_id,p_auth_session,p_action,p_payload);
end $$;
revoke all on function public.portal_presence_action(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.portal_presence_action(uuid,uuid,text,jsonb) to service_role;

create function public.portal_recording_action(p_user_id uuid,p_auth_session uuid,p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg admin_private.screen_recording_settings%rowtype; r admin_private.screen_recordings%rowtype;
 seg admin_private.screen_recording_segments%rowtype; actor public.employee_profiles%rowtype; a public.employee_activity_sessions%rowtype;
 v_presence jsonb; v_seq integer; v_start timestamptz; v_end timestamptz; v_size bigint; v_duration numeric;
 v_offset integer; v_limit integer; v_from date; v_to date; v_timezone text; v_id uuid; v_result jsonb; v_total bigint;
begin
 if not admin_private.portal_identity(p_user_id,p_auth_session) then raise exception 'Active portal authorization required' using errcode='42501'; end if;
 select * into actor from public.employee_profiles where id=p_user_id;
 select * into cfg from admin_private.screen_recording_settings where id=true;
 select timezone into v_timezone from public.company_settings where id=true;
 if p_action='config' then return to_jsonb(cfg)-'updated_by'; end if;
 if p_action in ('settings','list','detail','playback','delete','statuses') and actor.role<>'Co-CEO' then raise exception 'Co-CEO required' using errcode='42501'; end if;
 if p_action='settings' then
  if p_payload->>'notice' is null or length(p_payload->>'notice') not between 50 and 4000 then raise exception 'Monitoring notice required' using errcode='22023'; end if;
  update admin_private.screen_recording_settings set enabled=(p_payload->>'enabled')::boolean,
   notice=p_payload->>'notice',notice_version=notice_version+case when notice is distinct from p_payload->>'notice' then 1 else 0 end,
   policy_ready=coalesce((p_payload->>'policyReady')::boolean,false),storage_budget_bytes=(p_payload->>'storageBudgetBytes')::bigint,
   target_bitrate=(p_payload->>'bitrate')::integer,target_fps=(p_payload->>'fps')::integer,
   updated_at=now(),updated_by=p_user_id where id=true returning * into cfg;
  perform admin_private.recording_event(null,p_user_id,'settings_changed',jsonb_build_object('enabled',cfg.enabled,'notice_version',cfg.notice_version,'budget_bytes',cfg.storage_budget_bytes,'bitrate',cfg.target_bitrate));
  return to_jsonb(cfg)-'updated_by';
 end if;
 if p_action='begin' then
  if not cfg.enabled or not cfg.policy_ready then raise exception 'Recording is not enabled' using errcode='42501'; end if;
  if (p_payload->>'acknowledged')::boolean is distinct from true or (p_payload->>'noticeVersion')::integer is distinct from cfg.notice_version then raise exception 'Acknowledge the current monitoring notice' using errcode='22023'; end if;
  if coalesce(p_payload->>'displaySurface','') not in ('monitor','unknown') or coalesce(p_payload->>'mimeType','') not in ('video/webm','video/mp4')
   or length(coalesce(p_payload->>'codec','')) not between 1 and 100 then raise exception 'Approved entire-screen video required' using errcode='22023'; end if;
  perform 1 from public.employee_profiles where id=p_user_id for update;
  -- The recording row and attendance start commit atomically; only the backend supplies identity.
  perform set_config('linkora.recording_clock_in',p_user_id::text,true);
  v_presence:=public.portal_presence_unrecorded_action(p_user_id,p_auth_session,'clock-in',p_payload);
  perform set_config('linkora.recording_clock_in','',true);
  select * into a from public.employee_activity_sessions where session_id=(v_presence->>'sessionId')::uuid and employee_id=p_user_id for update;
  select * into r from admin_private.screen_recordings where attendance_session_id=a.session_id for update;
  if found then
   if r.status in ('completed','finalizing','incomplete','deleting','deleted','expired') then raise exception 'Recording cannot be reopened' using errcode='42501'; end if;
   if r.status='initializing' and r.tab_id=(p_payload->>'tabId')::uuid and r.auth_session_id=p_auth_session then
    if r.mime_type is distinct from p_payload->>'mimeType' or r.codec is distinct from p_payload->>'codec' then raise exception 'Initializing codec changed' using errcode='22023'; end if;
    return jsonb_build_object('recording',to_jsonb(r),'presence',v_presence,'serverTime',now(),'nextSequence',(select coalesce(max(sequence_number),0)+1 from admin_private.screen_recording_segments where recording_id=r.id),'config',to_jsonb(cfg)-'updated_by');
   end if;
   if r.status in ('recording','initializing','upload_issue') and r.owner_seen_at>now()-interval '20 seconds'
      and (r.tab_id<>(p_payload->>'tabId')::uuid or r.auth_session_id<>p_auth_session) then raise exception 'Another tab owns this recording' using errcode='23505'; end if;
   -- Resume never changes earlier segment objects, start time or retention.
   update admin_private.screen_recordings set status='initializing',generation=generation+1,
    tab_id=(p_payload->>'tabId')::uuid,auth_session_id=p_auth_session,owner_seen_at=now(),
    ended_at=null,finalized_at=null,mime_type=p_payload->>'mimeType',codec=p_payload->>'codec',
    display_surface=p_payload->>'displaySurface',notice_version=cfg.notice_version,had_issue=true,
    termination_reason=null where id=r.id returning * into r;
   perform admin_private.recording_event(r.id,p_user_id,'resumed',jsonb_build_object('notice_version',cfg.notice_version,'generation',r.generation));
  else
   if (select coalesce(sum(size_bytes),0) from admin_private.screen_recording_segments where upload_status in ('pending','stored'))>=cfg.storage_budget_bytes then
    raise exception 'Recording storage budget reached' using errcode='54000';
   end if;
   insert into admin_private.screen_recordings(employee_id,attendance_session_id,auth_session_id,tab_id,mime_type,codec,display_surface,notice_version)
    values(p_user_id,a.session_id,p_auth_session,(p_payload->>'tabId')::uuid,p_payload->>'mimeType',p_payload->>'codec',p_payload->>'displaySurface',cfg.notice_version) returning * into r;
   perform admin_private.recording_event(r.id,p_user_id,'started',jsonb_build_object('notice_version',cfg.notice_version,'display_surface',r.display_surface));
  end if;
  return jsonb_build_object('recording',to_jsonb(r),'presence',v_presence,'serverTime',now(),'nextSequence',
    (select coalesce(max(sequence_number),0)+1 from admin_private.screen_recording_segments where recording_id=r.id),'config',to_jsonb(cfg)-'updated_by');
 end if;
 if p_action='statuses' then
  return jsonb_build_object('rows',(select coalesce(jsonb_agg(t),'[]') from (
    select distinct on(rr.employee_id) rr.employee_id,rr.id,rr.status,rr.started_at,rr.total_segments
    from admin_private.screen_recordings rr
    where rr.started_at>=((now() at time zone v_timezone)::date::timestamp at time zone v_timezone)
    order by rr.employee_id,rr.started_at desc limit 500)t));
 end if;
 if p_action='list' then
  v_offset:=greatest(0,least(100000,coalesce((p_payload->>'offset')::integer,0))); v_limit:=greatest(1,least(50,coalesce((p_payload->>'limit')::integer,25)));
  v_from:=coalesce((p_payload->>'from')::date,(now() at time zone v_timezone)::date-89); v_to:=coalesce((p_payload->>'to')::date,(now() at time zone v_timezone)::date);
  if v_to<v_from or v_to-v_from>90 then raise exception 'Maximum date range is 90 days' using errcode='22023'; end if;
  select jsonb_agg(t) into v_result from (
   select rr.*,p.full_name,p.employee_id as employee_code,u.email,aa.login_at,aa.logout_at,aa.auto_closed,count(*) over() as filtered_total
   from admin_private.screen_recordings rr join public.employee_profiles p on p.id=rr.employee_id
   join auth.users u on u.id=p.id join public.employee_activity_sessions aa on aa.session_id=rr.attendance_session_id
   where rr.started_at>=(v_from::timestamp at time zone v_timezone) and rr.started_at<((v_to+1)::timestamp at time zone v_timezone)
    and (nullif(p_payload->>'employeeId','') is null or rr.employee_id=(p_payload->>'employeeId')::uuid)
    and (nullif(p_payload->>'status','') is null or rr.status=p_payload->>'status')
    and (nullif(p_payload->>'search','') is null or concat_ws(' ',p.full_name,p.employee_id,u.email) ilike '%'||left(p_payload->>'search',120)||'%')
   order by rr.started_at desc,rr.id limit v_limit offset v_offset
  )t;
  return jsonb_build_object('rows',coalesce(v_result,'[]'),'offset',v_offset,'limit',v_limit,'timezone',v_timezone,'serverTime',now(),
   'summary',(select jsonb_build_object(
    'today',count(*) filter(where started_at>=(now() at time zone v_timezone)::date::timestamp at time zone v_timezone),
    'recording',count(*) filter(where status='recording'),'completedToday',count(*) filter(where status='completed' and started_at>=(now() at time zone v_timezone)::date::timestamp at time zone v_timezone),
    'interrupted',count(*) filter(where status in ('interrupted','incomplete','upload_issue')),
    'storageBytes',coalesce(sum(total_size_bytes) filter(where status not in ('expired','deleted')),0),
    'last30Bytes',coalesce(sum(total_size_bytes) filter(where started_at>now()-interval '30 days' and status not in ('expired','deleted')),0),
    'oldest',min(started_at) filter(where status not in ('expired','deleted')),
    'expiringSoon',count(*) filter(where retention_until between now() and now()+interval '7 days' and status not in ('expired','deleted')),
    'overdueCleanup',count(*) filter(where retention_until<=now() and status not in ('expired','deleted')),
    'budgetBytes',cfg.storage_budget_bytes,'enabled',cfg.enabled,
    'estimated90Bytes',(select count(*) from public.employee_profiles where is_active)*cfg.target_bitrate::bigint/8*28800*78)
    from admin_private.screen_recordings));
 end if;
 v_id:=(p_payload->>'recordingId')::uuid;
 select * into r from admin_private.screen_recordings where id=v_id for update;
 if not found then raise exception 'Recording unavailable' using errcode='P0002'; end if;
 if p_action in ('detail','playback','delete') then
  if p_action='delete' then
   if r.status in ('initializing','recording','upload_issue','finalizing') or exists(select 1 from public.employee_activity_sessions where session_id=r.attendance_session_id and status='Logged In') then raise exception 'End the work session before deleting its recording' using errcode='22023'; end if;
   if (p_payload->>'confirmed')::boolean is distinct from true then raise exception 'Deletion confirmation required' using errcode='22023'; end if;
   update admin_private.screen_recordings set status='deleting',termination_reason='admin_delete' where id=r.id;
   perform admin_private.recording_event(r.id,p_user_id,'deleted',jsonb_build_object('phase','requested'));
   return jsonb_build_object('ok',true);
  end if;
  if p_action='playback' then
   if r.retention_until<=now() or r.status in ('deleting','deleted','expired') then raise exception 'Recording expired or unavailable' using errcode='42501'; end if;
   select * into seg from admin_private.screen_recording_segments where recording_id=r.id and sequence_number=(p_payload->>'sequence')::integer and upload_status='stored';
   if not found then raise exception 'Segment unavailable' using errcode='P0002'; end if;
   perform admin_private.recording_event(r.id,p_user_id,'viewed',jsonb_build_object('sequence',seg.sequence_number));
   return jsonb_build_object('path',seg.storage_path,'ttl',least(300,greatest(1,floor(extract(epoch from r.retention_until-now()))::integer)));
  end if;
  return jsonb_build_object('recording',(select to_jsonb(t) from(select r.*,p.full_name,p.employee_id as employee_code,aa.login_at,aa.logout_at from public.employee_profiles p join public.employee_activity_sessions aa on aa.employee_id=p.id where p.id=r.employee_id and aa.session_id=r.attendance_session_id)t),
   'segments',(select coalesce(jsonb_agg(to_jsonb(s)-'storage_path' order by sequence_number),'[]') from admin_private.screen_recording_segments s where recording_id=r.id),
   'events',(select coalesce(jsonb_agg(t order by t.created_at),'[]') from (select e.event,e.actor_id,p.full_name as actor_name,e.details,e.created_at from admin_private.screen_recording_events e left join public.employee_profiles p on p.id=e.actor_id where e.recording_id=r.id and e.event<>'segment_uploaded' order by e.created_at desc limit 100)t));
 end if;
 if r.employee_id is distinct from p_user_id or r.auth_session_id is distinct from p_auth_session or r.tab_id is distinct from (p_payload->>'tabId')::uuid or r.generation is distinct from (p_payload->>'generation')::integer then
  raise exception 'Recording owner required' using errcode='42501';
 end if;
 select * into a from public.employee_activity_sessions where session_id=r.attendance_session_id;
 if r.retention_until<=now() or r.status in ('deleting','deleted','expired','completed','incomplete') then raise exception 'Recording ended' using errcode='42501'; end if;
 if p_action in ('activate','pulse','reserve') and (a.status<>'Logged In' or not exists(select 1 from admin_private.portal_clients c where c.session_id=a.session_id and c.tab_id=r.tab_id and c.auth_session_id=p_auth_session and c.close_requested_at is null and c.last_seen_at>now()-interval '15 seconds')) then
  raise exception 'Active work session required' using errcode='42501';
 end if;
 if p_action='activate' then
  if r.status<>'initializing' then raise exception 'Recording already activated' using errcode='22023'; end if;
  update admin_private.screen_recordings set status='recording',owner_seen_at=now() where id=r.id;
  return jsonb_build_object('ok',true);
 elsif p_action='pulse' then
  if r.status not in ('recording','upload_issue') then return jsonb_build_object('active',false,'status',r.status); end if;
  update admin_private.screen_recordings set owner_seen_at=now() where id=r.id;
  return jsonb_build_object('active',true,'serverTime',now());
 elsif p_action='reserve' then
  if r.status not in ('recording','upload_issue') then raise exception 'Recording inactive' using errcode='42501'; end if;
  v_seq:=(p_payload->>'sequence')::integer; v_size:=(p_payload->>'sizeBytes')::bigint; v_duration:=(p_payload->>'durationSeconds')::numeric;
  if v_seq is null or v_size is null or v_duration is null or v_size not between 1 and cfg.max_segment_bytes or v_duration<=0 or v_duration>cfg.segment_seconds+60 then raise exception 'Invalid segment' using errcode='22023'; end if;
  select * into seg from admin_private.screen_recording_segments where recording_id=r.id and sequence_number=v_seq;
  if found then
   if seg.generation<>r.generation or seg.size_bytes<>v_size or seg.duration_seconds<>v_duration then raise exception 'Immutable segment mismatch' using errcode='22023'; end if;
   return jsonb_build_object('path',seg.storage_path,'stored',seg.upload_status='stored');
  end if;
  if v_seq<>(select coalesce(max(sequence_number),0)+1 from admin_private.screen_recording_segments where recording_id=r.id) then raise exception 'Invalid sequence' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(823107091);
  if (select coalesce(sum(size_bytes),0) from admin_private.screen_recording_segments where upload_status in ('pending','stored'))+v_size>cfg.storage_budget_bytes then raise exception 'Recording storage budget reached' using errcode='54000'; end if;
  v_end:=least(now(),(p_payload->>'endedAt')::timestamptz);v_start:=greatest(r.started_at,v_end-make_interval(secs=>v_duration::double precision));
  if v_end is null or v_end<r.started_at or v_end<now()-interval '10 minutes' then raise exception 'Invalid capture time' using errcode='22023'; end if;
  insert into admin_private.screen_recording_segments(recording_id,sequence_number,generation,storage_path,started_at,ended_at,duration_seconds,size_bytes,mime_type)
   values(r.id,v_seq,r.generation,r.employee_id::text||'/'||to_char(r.started_at at time zone 'UTC','YYYY/MM/DD')||'/'||r.attendance_session_id::text||'/'||r.id::text||'/segment-'||lpad(v_seq::text,6,'0')||case when r.mime_type='video/webm' then '.webm' else '.mp4' end,
    v_start,v_end,v_duration,v_size,r.mime_type) returning * into seg;
  return jsonb_build_object('path',seg.storage_path,'stored',false);
 elsif p_action='commit' then
  select * into seg from admin_private.screen_recording_segments where recording_id=r.id and sequence_number=(p_payload->>'sequence')::integer;
  if not found then raise exception 'Segment unavailable' using errcode='P0002'; end if;
  if not exists(select 1 from storage.objects o where o.bucket_id='employee-screen-recordings' and o.name=seg.storage_path and (o.metadata->>'size')::bigint=seg.size_bytes) then raise exception 'Uploaded object not verified' using errcode='22023'; end if;
  if seg.upload_status<>'stored' then
   update admin_private.screen_recording_segments set upload_status='stored',stored_at=now() where id=seg.id;
   perform admin_private.recording_totals(r.id);
   perform admin_private.recording_event(r.id,p_user_id,'segment_uploaded',jsonb_build_object('sequence',seg.sequence_number,'bytes',seg.size_bytes));
  end if;
  return jsonb_build_object('ok',true);
 elsif p_action='issue' then
  update admin_private.screen_recordings set status=case when status='recording' then 'upload_issue' else status end,had_issue=true where id=r.id;
  perform admin_private.recording_event(r.id,p_user_id,'upload_failed',jsonb_build_object('reason',left(coalesce(p_payload->>'reason','upload_issue'),100),'sequence',p_payload->>'sequence'));
  return jsonb_build_object('ok',true);
 elsif p_action='interrupt' then
  v_end:=greatest(r.started_at,least(now(),coalesce((p_payload->>'endedAt')::timestamptz,now())));
  update admin_private.screen_recordings set status='interrupted',had_issue=true,expected_segments=greatest(coalesce(expected_segments,0),least(10000,greatest(0,coalesce((p_payload->>'expectedSegments')::integer,0)))),ended_at=coalesce(ended_at,v_end),termination_reason=left(coalesce(p_payload->>'reason','screen_share_stopped'),100) where id=r.id;
  perform admin_private.recording_event(r.id,p_user_id,'interrupted',jsonb_build_object('reason',p_payload->>'reason'));
  return jsonb_build_object('ok',true);
 elsif p_action='finalize' then
  v_end:=greatest(r.started_at,least(now(),coalesce((p_payload->>'endedAt')::timestamptz,now())));
  v_seq:=(p_payload->>'expectedSegments')::integer;
  if v_seq is null or v_seq not between 0 and 10000 then raise exception 'Expected segment count required' using errcode='22023'; end if;
  perform admin_private.recording_totals(r.id);
  select * into r from admin_private.screen_recordings where id=r.id;
  update admin_private.screen_recordings set expected_segments=v_seq,ended_at=coalesce(ended_at,v_end),finalized_at=now(),
   status=case when a.status='Logged In' and v_seq>0 and v_seq=total_segments and not had_issue and (select coalesce(max(sequence_number),0)=v_seq from admin_private.screen_recording_segments where recording_id=r.id) then 'finalizing' else 'incomplete' end,
   termination_reason=coalesce(termination_reason,'clock_out') where id=r.id returning * into r;
  if r.status='incomplete' then perform admin_private.recording_event(r.id,p_user_id,'interrupted',jsonb_build_object('expected',v_seq,'stored',r.total_segments)); end if;
  return jsonb_build_object('ok',true,'status',r.status);
 end if;
 raise exception 'Invalid recording action' using errcode='22023';
end $$;
revoke all on function public.portal_recording_action(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.portal_recording_action(uuid,uuid,text,jsonb) to service_role;

create function public.portal_recording_maintenance(p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql set search_path='' as $$
declare r record;s record;v_result jsonb;v_rows integer;
begin
 if p_action='sweep' then
  -- Reconcile objects whose upload succeeded but the client commit was lost in a crash.
  -- Match client commit lock order: recording first, then segment. Skip busy recordings.
  for r in select rr.id from admin_private.screen_recordings rr where exists(
    select 1 from admin_private.screen_recording_segments x join storage.objects o
    on o.bucket_id='employee-screen-recordings' and o.name=x.storage_path and (o.metadata->>'size')::bigint=x.size_bytes
    where x.recording_id=rr.id and x.upload_status='pending') order by rr.id limit 50 for update of rr skip locked loop
   for s in select x.* from admin_private.screen_recording_segments x join storage.objects o
    on o.bucket_id='employee-screen-recordings' and o.name=x.storage_path and (o.metadata->>'size')::bigint=x.size_bytes
    where x.recording_id=r.id and x.upload_status='pending' order by x.created_at limit 200 for update of x skip locked loop
   update admin_private.screen_recording_segments set upload_status='stored',stored_at=now() where id=s.id;
   perform admin_private.recording_totals(s.recording_id);
   perform admin_private.recording_event(s.recording_id,null,'segment_uploaded',jsonb_build_object('sequence',s.sequence_number,'reconciled',true));
   end loop;
  end loop;
  for r in select x.* from admin_private.screen_recordings x join public.employee_activity_sessions a on a.session_id=x.attendance_session_id
   where x.status in ('initializing','recording','upload_issue') and (a.status<>'Logged In' or x.owner_seen_at<now()-interval '20 seconds') for update of x skip locked loop
   update admin_private.screen_recordings set status='interrupted',ended_at=coalesce(ended_at,now()),had_issue=true,termination_reason=coalesce(termination_reason,'recording_owner_disconnected') where id=r.id;
   perform admin_private.recording_event(r.id,null,'interrupted',jsonb_build_object('reason','recording_owner_disconnected'));
  end loop;
  update admin_private.screen_recording_segments set upload_status='missing' where upload_status='pending' and created_at<now()-interval '10 minutes';
  return jsonb_build_object('ok',true);
 elsif p_action='candidates' then
  select coalesce(jsonb_agg(t),'[]') into v_result from (
   select rr.id,rr.termination_reason,(select coalesce(jsonb_agg(o.name),'[]') from storage.objects o where o.bucket_id='employee-screen-recordings'
     and starts_with(o.name,rr.employee_id::text||'/'||to_char(rr.started_at at time zone 'UTC','YYYY/MM/DD')||'/'||rr.attendance_session_id::text||'/'||rr.id::text||'/')) as paths
   from admin_private.screen_recordings rr where rr.status='deleting' or (rr.retention_until<=now() and rr.status not in ('deleted','expired')) order by rr.retention_until limit 20
  )t;
  return jsonb_build_object('rows',v_result);
 elsif p_action='deleted' then
  select * into r from admin_private.screen_recordings where id=(p_payload->>'recordingId')::uuid for update;
  if not found or not(r.status='deleting' or(r.retention_until<=now() and r.status not in ('deleted','expired'))) then raise exception 'Not a deletion candidate' using errcode='22023'; end if;
  if exists(select 1 from storage.objects o where o.bucket_id='employee-screen-recordings'
   and starts_with(o.name,r.employee_id::text||'/'||to_char(r.started_at at time zone 'UTC','YYYY/MM/DD')||'/'||r.attendance_session_id::text||'/'||r.id::text||'/')) then raise exception 'Storage deletion not verified' using errcode='22023'; end if;
  update admin_private.screen_recording_segments set upload_status='deleted' where recording_id=r.id;
  update admin_private.screen_recordings set status=case when r.termination_reason='admin_delete' then 'deleted' else 'expired' end,finalized_at=coalesce(finalized_at,now()) where id=r.id;
  perform admin_private.recording_event(r.id,null,case when r.termination_reason='admin_delete' then 'deleted' else 'expired' end,jsonb_build_object('phase','verified'));
  return jsonb_build_object('ok',true);
 end if;
 raise exception 'Invalid maintenance action' using errcode='22023';
end $$;
revoke all on function public.portal_recording_maintenance(text,jsonb) from public,anon,authenticated;
grant execute on function public.portal_recording_maintenance(text,jsonb) to service_role;
-- The one-second lease job already closes attendance; its trigger closes recording metadata.
-- This worker reconciles crash uploads and removes expired objects via the Storage API, never SQL deletes.
do $$ declare v_token text:=encode(extensions.gen_random_bytes(32),'hex'); begin
 perform vault.create_secret(v_token,'linkora_recording_maintenance','Scoped screen recording retention worker capability');
 insert into admin_private.portal_job_auth(token_hash) values(encode(extensions.digest(v_token,'sha256'),'hex'));
end $$;
select cron.schedule('linkora-screen-recording-retention','* * * * *',$job$
 select net.http_post(url:='https://nbvylffxmjmovyfhbytu.supabase.co/functions/v1/workforce-recordings',
 headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||
  (select decrypted_secret from vault.decrypted_secrets where name='linkora_recording_maintenance')),
 body:='{"action":"maintenance"}'::jsonb,timeout_milliseconds:=15000);
$job$);

-- Guard the older manage-employee start-session route too; no frontend/API bypass.
alter function public.portal_employee_start_session(uuid,uuid) rename to portal_employee_unrecorded_start_session;
create function public.portal_employee_start_session(p_user_id uuid,p_session_id uuid)
returns jsonb language plpgsql set search_path='' as $$
begin
 if (select enabled from admin_private.screen_recording_settings where id=true)
  and coalesce(current_setting('linkora.recording_clock_in',true),'')<>p_user_id::text then
  raise exception 'Use the consented recording Clock In workflow' using errcode='42501';
 end if;
 return public.portal_employee_unrecorded_start_session(p_user_id,p_session_id);
end $$;
revoke all on function public.portal_employee_start_session(uuid,uuid) from public,anon,authenticated;
grant execute on function public.portal_employee_start_session(uuid,uuid) to service_role;

-- A recording-owner lease is separate from attendance (another portal tab may remain open).
create or replace function admin_private.portal_lease_tick()
returns void language plpgsql security definer set search_path='' as $$
declare r record;
begin
 perform admin_private.expire_portal_sessions();
 perform admin_private.expire_screen_shares();
 for r in select * from admin_private.screen_recordings where status in ('initializing','recording','upload_issue') and owner_seen_at<now()-interval '20 seconds' for update skip locked loop
  update admin_private.screen_recordings set status='interrupted',had_issue=true,ended_at=coalesce(ended_at,now()),termination_reason='recording_owner_disconnected' where id=r.id;
  perform admin_private.recording_event(r.id,null,'interrupted',jsonb_build_object('reason','recording_owner_disconnected'));
 end loop;
 delete from admin_private.portal_clients c using public.employee_activity_sessions a where c.session_id=a.session_id and a.status<>'Logged In' and c.last_seen_at<now()-interval '7 days';
end $$;
