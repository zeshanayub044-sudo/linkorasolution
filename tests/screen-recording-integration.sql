-- Rollback-only integration: synthetic metadata, no physical objects and no test history retained.
do $test$
declare emp uuid;other uuid;boss uuid;ea uuid;ba uuid;res jsonb;rid uuid;sid uuid:=gen_random_uuid();tab uuid:=gen_random_uuid();cid uuid:=gen_random_uuid();seq integer;seg_path text;denied boolean;n integer;gen integer;
begin
 select p.id,a.id into emp,ea from public.employee_profiles p join auth.sessions a on a.user_id=p.id where p.is_active and p.role='Employee' and (a.not_after is null or a.not_after>now()) limit 1;
 select p.id,a.id into boss,ba from public.employee_profiles p join auth.sessions a on a.user_id=p.id where p.is_active and p.role='Co-CEO' and (a.not_after is null or a.not_after>now()) limit 1;
 select id into other from public.employee_profiles where is_active and role='Employee' and id<>emp limit 1;
 if emp is null or boss is null then raise exception 'Existing employee and Co-CEO Auth sessions required';end if;
 update public.employee_activity_sessions set status='Needs Review' where employee_id=emp and status='Logged In';
 update admin_private.screen_recording_settings set enabled=true,policy_ready=true,storage_budget_bytes=1000000000 where id=true;
 denied:=false;begin perform public.portal_presence_action(emp,ea,'clock-in',jsonb_build_object('sessionId',sid,'tabId',tab,'clientId',cid,'closeTokenHash',repeat('a',64)));exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Legacy Clock In bypassed recording';end if;
 denied:=false;begin perform public.portal_employee_start_session(emp,sid);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Legacy manage-employee bypass';end if;
 denied:=false;begin perform public.portal_recording_action(emp,ea,'begin',jsonb_build_object('acknowledged',false));exception when invalid_parameter_value then denied:=true;end;if not denied then raise exception 'Consent bypass';end if;
 denied:=false;begin perform public.portal_recording_action(emp,ea,'begin',jsonb_build_object('acknowledged',true,'noticeVersion',1,'displaySurface','browser','mimeType','video/webm','codec','video/webm;codecs=vp9'));exception when invalid_parameter_value then denied:=true;end;if not denied then raise exception 'Tab selection accepted';end if;
 res:=public.portal_recording_action(emp,ea,'begin',jsonb_build_object('acknowledged',true,'noticeVersion',1,'displaySurface','monitor','mimeType','video/webm','codec','video/webm;codecs=vp9','sessionId',sid,'tabId',tab,'clientId',cid,'closeTokenHash',repeat('a',64)));
 rid:=(res->'recording'->>'id')::uuid;gen:=(res->'recording'->>'generation')::integer;
 if not exists(select 1 from public.employee_activity_sessions where session_id=sid and status='Logged In') then raise exception 'Linked attendance absent';end if;
 if (res->'recording'->>'retention_until')::timestamptz-(res->'recording'->>'started_at')::timestamptz<>interval '90 days' then raise exception 'Incorrect retention';end if;
 perform public.portal_recording_action(emp,ea,'activate',jsonb_build_object('recordingId',rid,'tabId',tab,'generation',gen));
 denied:=false;begin perform public.portal_recording_action(emp,ea,'list','{}');exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Employee list access';end if;
 denied:=false;begin perform public.portal_recording_action(other,ea,'detail',jsonb_build_object('recordingId',rid));exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Forged identity accepted';end if;
 denied:=false;begin perform public.portal_recording_action(emp,ea,'pulse',jsonb_build_object('recordingId',rid));exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Omitted owner IDs accepted';end if;
 denied:=false;begin perform public.portal_recording_action(emp,ea,'settings','{}');exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Employee changed policy';end if;
 denied:=false;begin perform public.portal_recording_action(boss,ba,'delete',jsonb_build_object('recordingId',rid,'confirmed',true));exception when invalid_parameter_value then denied:=true;end;if not denied then raise exception 'Active recording deleted';end if;
 update admin_private.screen_recording_settings set storage_budget_bytes=1;
 denied:=false;begin perform public.portal_recording_action(emp,ea,'reserve',jsonb_build_object('recordingId',rid,'tabId',tab,'generation',gen,'sequence',1,'sizeBytes',1000,'durationSeconds',1,'endedAt',now()));exception when program_limit_exceeded then denied:=true;end;if not denied then raise exception 'Budget exceeded';end if;
 update admin_private.screen_recording_settings set storage_budget_bytes=1000000000;
 res:=public.portal_recording_action(emp,ea,'reserve',jsonb_build_object('recordingId',rid,'tabId',tab,'generation',gen,'sequence',1,'sizeBytes',1000,'durationSeconds',1,'endedAt',now()));
 denied:=false;begin perform public.portal_recording_action(emp,ea,'reserve',jsonb_build_object('recordingId',rid,'tabId',tab,'generation',gen,'sequence',1,'sizeBytes',999,'durationSeconds',1,'endedAt',now()));exception when invalid_parameter_value then denied:=true;end;if not denied then raise exception 'Immutable bytes changed';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',emp,'session_id',ea,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 denied:=false;begin insert into storage.objects(bucket_id,name,metadata) values('employee-screen-recordings',res->>'path',jsonb_build_object('size',999));exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Wrong-size upload allowed';end if;
 execute 'reset role';
 for seq in 1..3 loop
  res:=public.portal_recording_action(emp,ea,'reserve',jsonb_build_object('recordingId',rid,'tabId',tab,'generation',gen,'sequence',seq,'sizeBytes',1000,'durationSeconds',1,'endedAt',now()));seg_path:=res->>'path';
  if seg_path is null then raise exception 'Path missing';end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',emp,'session_id',ea,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  insert into storage.objects(bucket_id,name,metadata) values('employee-screen-recordings',seg_path,jsonb_build_object('size',1000,'mimetype','video/webm'));
  execute 'reset role';
  perform public.portal_recording_action(emp,ea,'commit',jsonb_build_object('recordingId',rid,'tabId',tab,'generation',gen,'sequence',seq));
  perform public.portal_recording_action(emp,ea,'commit',jsonb_build_object('recordingId',rid,'tabId',tab,'generation',gen,'sequence',seq));
 end loop;
 if (select total_segments from admin_private.screen_recordings where id=rid)<>3 then raise exception 'Commit retry duplicated count';end if;
 -- Exact reservations, private storage and immutable metadata are enforced by RLS.
 execute 'set local role authenticated';
 select count(*) into n from storage.objects where bucket_id='employee-screen-recordings';if n<>0 then raise exception 'Employee can read/list storage';end if;
 denied:=false;begin insert into storage.objects(bucket_id,name,metadata) values('employee-screen-recordings','unauthorized.webm','{"size":1000}');exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Unreserved object upload';end if;
 denied:=false;begin perform public.portal_recording_action(emp,ea,'detail',jsonb_build_object('recordingId',rid));exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Authenticated direct service RPC';end if;
 execute 'reset role';
 execute 'set local role service_role';
 res:=public.portal_recording_action(boss,ba,'list',jsonb_build_object('from',current_date-89,'to',current_date));if jsonb_array_length(res->'rows')<1 then raise exception '90-day list failed';end if;
 res:=public.portal_recording_action(boss,ba,'detail',jsonb_build_object('recordingId',rid));if jsonb_array_length(res->'segments')<>3 then raise exception 'Manifest failed';end if;
 res:=public.portal_recording_action(boss,ba,'playback',jsonb_build_object('recordingId',rid,'sequence',2));if (res->>'ttl')::integer<>300 or res->>'path' is null then raise exception 'Playback grant wrong';end if;
 execute 'reset role';
 if not exists(select 1 from admin_private.screen_recording_events where recording_id=rid and event='viewed' and actor_id=boss) then raise exception 'View unaudited';end if;
 denied:=false;begin perform public.portal_recording_action(emp,ea,'playback',jsonb_build_object('recordingId',rid,'sequence',1));exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Employee playback';end if;
 res:=public.portal_recording_action(emp,ea,'finalize',jsonb_build_object('recordingId',rid,'tabId',tab,'generation',gen,'expectedSegments',3));if res->>'status'<>'finalizing' then raise exception 'Premature completion or false incomplete';end if;
 perform public.portal_presence_action(emp,ea,'clock-out',jsonb_build_object('sessionId',sid));if (select status from admin_private.screen_recordings where id=rid)<>'completed' then raise exception 'Clock Out completion failed';end if;
 -- Retention access cutoff precedes physical deletion; deletion is verified against Storage metadata.
 update admin_private.screen_recordings set retention_until=now()-interval '1 second' where id=rid;
 denied:=false;begin perform public.portal_recording_action(boss,ba,'playback',jsonb_build_object('recordingId',rid,'sequence',1));exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Expired playback';end if;
 denied:=false;begin perform public.portal_recording_maintenance('deleted',jsonb_build_object('recordingId',rid));exception when invalid_parameter_value then denied:=true;end;if not denied then raise exception 'Deletion marked without object removal';end if;
 res:=public.portal_recording_maintenance('candidates');if jsonb_array_length(res->'rows')<1 then raise exception 'Retention candidate absent';end if;
 -- Unexpected disconnect preserves existing uploaded segments and marks interruption through attendance.
 sid:=gen_random_uuid();tab:=gen_random_uuid();
 res:=public.portal_recording_action(emp,ea,'begin',jsonb_build_object('acknowledged',true,'noticeVersion',1,'displaySurface','unknown','mimeType','video/webm','codec','video/webm;codecs=vp8','sessionId',sid,'tabId',tab,'clientId',cid,'closeTokenHash',repeat('b',64)));
 rid:=(res->'recording'->>'id')::uuid;gen:=(res->'recording'->>'generation')::integer;
 perform public.portal_recording_action(emp,ea,'activate',jsonb_build_object('recordingId',rid,'tabId',tab,'generation',gen));
 res:=public.portal_recording_action(emp,ea,'reserve',jsonb_build_object('recordingId',rid,'tabId',tab,'generation',gen,'sequence',1,'sizeBytes',1000,'durationSeconds',1,'endedAt',now()));seg_path:=res->>'path';
 insert into storage.objects(bucket_id,name,metadata)values('employee-screen-recordings',seg_path,'{"size":1000}');
 execute 'set local role service_role';perform public.portal_recording_maintenance('sweep');execute 'reset role';if (select total_segments from admin_private.screen_recordings where id=rid)<>1 then raise exception 'Crash commit recovery failed';end if;
 update admin_private.portal_clients set last_seen_at=now()-interval '16 seconds' where session_id=sid;
 update public.employee_activity_sessions set last_heartbeat_at=now()-interval '16 seconds' where session_id=sid;
 perform admin_private.expire_portal_sessions(emp);if (select status from admin_private.screen_recordings where id=rid)<>'interrupted' then raise exception 'Auto-close missed recording';end if;
 if (select total_segments from admin_private.screen_recordings where id=rid)<>1 then raise exception 'Uploaded crash history lost';end if;
 res:=public.portal_recording_action(boss,ba,'statuses','{}');if jsonb_array_length(res->'rows')<1 then raise exception 'Today recording badges absent';end if;
 -- An expired recording with zero objects can be verified without bypassing Storage deletion protection.
 sid:=gen_random_uuid();insert into public.employee_activity_sessions(session_id,employee_id,login_at,logout_at,status)values(sid,emp,now(),now(),'Logged Out');
 insert into admin_private.screen_recordings(employee_id,attendance_session_id,auth_session_id,tab_id,status,mime_type,codec,display_surface,notice_version,retention_until)
 values(emp,sid,ea,gen_random_uuid(),'interrupted','video/webm','video/webm;codecs=vp8','monitor',1,now()-interval '1 second')returning id into rid;
 execute 'set local role service_role';perform public.portal_recording_maintenance('deleted',jsonb_build_object('recordingId',rid));execute 'reset role';if (select status from admin_private.screen_recordings where id=rid)<>'expired' then raise exception 'Expiration not finalized';end if;
 if has_function_privilege('anon','public.portal_recording_action(uuid,uuid,text,jsonb)','EXECUTE') or has_function_privilege('authenticated','public.portal_recording_maintenance(text,jsonb)','EXECUTE') then raise exception 'Privileged RPC exposed';end if;
 if has_table_privilege('authenticated','admin_private.screen_recordings','SELECT') or has_table_privilege('anon','admin_private.screen_recording_segments','SELECT') then raise exception 'Recording metadata exposed';end if;
 if (select public from storage.buckets where id='employee-screen-recordings') then raise exception 'Public recording bucket';end if;
end $test$;
