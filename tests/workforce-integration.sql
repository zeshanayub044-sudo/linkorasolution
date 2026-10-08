begin;
do $test$
declare emp uuid; other_emp uuid; admin_id uuid; emp_auth uuid; admin_auth uuid;
 s uuid:=gen_random_uuid(); tab_a uuid:=gen_random_uuid(); tab_b uuid:=gen_random_uuid();
 client_id uuid:=gen_random_uuid(); result jsonb; share uuid; peer uuid; generation integer;
 denied boolean; initial_count integer; saved_login timestamptz; saved_logout timestamptz;
begin
 select p.id,a.id into emp,emp_auth from public.employee_profiles p join auth.sessions a on a.user_id=p.id
 where p.is_active and p.role='Employee' and (a.not_after is null or a.not_after>now()) limit 1;
 select p.id,a.id into admin_id,admin_auth from public.employee_profiles p join auth.sessions a on a.user_id=p.id
 where p.is_active and p.role='Co-CEO' and (a.not_after is null or a.not_after>now()) limit 1;
 select id into other_emp from public.employee_profiles where is_active and role='Employee' and id<>emp limit 1;
 if emp is null or admin_id is null then raise exception 'Test requires existing employee and Co-CEO Auth sessions'; end if;
 select count(*) into initial_count from public.employee_activity_sessions;
 -- All changes, including test setup, audit events and queue rows roll back.
 update public.employee_activity_sessions set status='Needs Review' where employee_id=emp and status='Logged In';
 result:=public.portal_presence_action(emp,emp_auth,'connect',jsonb_build_object('sessionId',s,'tabId',tab_a,'clientId',client_id,'closeTokenHash',repeat('a',64),'background',false));
 if (result->>'sessionId')::uuid<>s or not(result->>'active')::boolean then raise exception 'Connect failed'; end if;
 result:=public.portal_presence_action(emp,emp_auth,'connect',jsonb_build_object('sessionId',gen_random_uuid(),'tabId',tab_b,'clientId',client_id,'closeTokenHash',repeat('b',64),'background',false));
 if (result->>'sessionId')::uuid<>s or (select count(*) from public.employee_activity_sessions)<>initial_count+1 then raise exception 'Refresh/multitab duplicated attendance'; end if;
 perform public.portal_presence_close(s,tab_a,repeat('a',64));
 update admin_private.portal_clients set close_requested_at=now()-interval '30 seconds' where session_id=s and tab_id=tab_a;
 perform admin_private.expire_portal_sessions(emp);
 if (select status from public.employee_activity_sessions where session_id=s)<>'Logged In' then raise exception 'Closing one tab ended remaining tab'; end if;
 -- Refresh inside close grace cancels that tab's pending close and rotates its capability.
 result:=public.portal_presence_action(emp,emp_auth,'connect',jsonb_build_object('sessionId',gen_random_uuid(),'tabId',tab_a,'clientId',client_id,'closeTokenHash',repeat('c',64),'background',false));
 if (result->>'sessionId')::uuid<>s or public.portal_presence_close(s,tab_a,repeat('a',64)) then raise exception 'Refresh/token rotation failed'; end if;
 denied:=false;
 begin perform public.portal_presence_action(other_emp,emp_auth,'heartbeat',jsonb_build_object('sessionId',s,'tabId',tab_a,'clientId',client_id)); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Identity spoof accepted'; end if;
 denied:=false;
 begin perform public.portal_workforce_action(emp,emp_auth,'workforce','{}'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Employee can list workforce'; end if;
 -- Consent metadata grants no media; only the employee browser supplies selected video.
 result:=public.portal_workforce_action(emp,emp_auth,'share-start',jsonb_build_object('sessionId',s,'tabId',tab_a)); share:=(result->>'shareId')::uuid;
 denied:=false;
 begin perform public.portal_workforce_action(emp,emp_auth,'viewer-join',jsonb_build_object('shareId',share)); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Employee viewer accepted'; end if;
 result:=public.portal_workforce_action(admin_id,admin_auth,'viewer-join',jsonb_build_object('shareId',share));
 peer:=(result->>'peerId')::uuid; generation:=(result->>'generation')::integer;
 if peer is null then raise exception 'Authorized viewer join failed'; end if;
 perform public.portal_workforce_action(emp,emp_auth,'signal',jsonb_build_object('peerId',peer,'generation',generation,'kind','offer','payload',jsonb_build_object('type','offer','sdp','temporary-test')));
 result:=public.portal_workforce_action(admin_id,admin_auth,'poll-viewer',jsonb_build_object('peerId',peer,'generation',generation,'afterId',0));
 if jsonb_array_length(result->'signals')<>1 then raise exception 'Secure signaling failed'; end if;
 result:=public.portal_workforce_action(admin_id,admin_auth,'poll-viewer',jsonb_build_object('peerId',peer,'generation',generation-1,'afterId',0));
 if (result->>'active')::boolean then raise exception 'Stale generation accepted'; end if;
 -- Revocation is checked on every participant poll, not just at join.
 update public.employee_profiles set role='Employee' where id=admin_id;
 result:=public.portal_workforce_action(emp,emp_auth,'poll-owner',jsonb_build_object('shareId',share,'afterId',0));
 if jsonb_array_length(result->'peers')<>0 then raise exception 'Revoked viewer still authorized'; end if;
 update public.employee_profiles set role='Co-CEO' where id=admin_id;
 perform public.portal_workforce_action(emp,emp_auth,'share-stop',jsonb_build_object('shareId',share));
 if (select state from admin_private.screen_shares where id=share)<>'ended' or exists(select 1 from admin_private.screen_signals where peer_id=peer) then raise exception 'Share cleanup failed'; end if;
 -- Hidden/background client survives five minutes without a heartbeat.
 update public.employee_activity_sessions set login_at=now()-interval '2 hours',last_heartbeat_at=now()-interval '5 minutes' where session_id=s;
 update admin_private.portal_clients set last_seen_at=now()-interval '5 minutes',background=true,close_requested_at=null where session_id=s;
 perform admin_private.expire_portal_sessions(emp);
 if (select status from public.employee_activity_sessions where session_id=s)<>'Logged In' then raise exception 'Minimized client closed prematurely'; end if;
 -- Brief interruption resumes; expired foreground lease gets estimated last heartbeat.
 result:=public.portal_presence_action(emp,emp_auth,'heartbeat',jsonb_build_object('sessionId',s,'tabId',tab_a,'clientId',client_id,'background',false));
 if not(result->>'active')::boolean then raise exception 'Recovery inside hidden lease failed'; end if;
 update admin_private.portal_clients set last_seen_at=now()-interval '4 minutes',background=false where session_id=s;
 update public.employee_activity_sessions set last_heartbeat_at=now()-interval '4 minutes' where session_id=s;
 perform admin_private.expire_portal_sessions(emp);
 if not exists(select 1 from public.employee_activity_sessions where session_id=s and status='Logged Out' and auto_closed and estimated_logout and logout_source='system' and logout_at=last_heartbeat_at) then raise exception 'Estimated timeout rule failed'; end if;
 select login_at,logout_at into saved_login,saved_logout from public.employee_activity_sessions where session_id=s;
 result:=public.portal_presence_action(emp,emp_auth,'heartbeat',jsonb_build_object('sessionId',s,'tabId',tab_a,'clientId',client_id));
 if (result->>'active')::boolean or not(result->>'estimatedLogout')::boolean then raise exception 'Closed session revived'; end if;
 result:=public.portal_presence_action(emp,emp_auth,'connect',jsonb_build_object('sessionId',gen_random_uuid(),'tabId',tab_a,'clientId',client_id,'closeTokenHash',repeat('d',64),'background',false));
 if (result->>'sessionId')::uuid=s then raise exception 'Reopen rewrote completed session'; end if;
 s:=(result->>'sessionId')::uuid;
 perform public.portal_presence_close(s,tab_a,repeat('d',64));
 update admin_private.portal_clients set close_requested_at=now()-interval '30 seconds' where session_id=s;
 update public.employee_activity_sessions set login_at=now()-interval '1 hour' where session_id=s;
 perform admin_private.expire_portal_sessions(emp);
 if not exists(select 1 from public.employee_activity_sessions where session_id=s and status='Logged Out' and not estimated_logout and disconnect_reason='portal_closed') then raise exception 'Final-tab close failed'; end if;
 result:=public.portal_presence_action(emp,emp_auth,'connect',jsonb_build_object('sessionId',gen_random_uuid(),'tabId',tab_a,'clientId',client_id,'closeTokenHash',repeat('e',64),'background',false));
 s:=(result->>'sessionId')::uuid;
 perform public.portal_employee_end_session(emp,s);
 if not exists(select 1 from public.employee_activity_sessions where session_id=s and status='Logged Out' and not estimated_logout and disconnect_reason='manual_logout') then raise exception 'Normal logout failed'; end if;
 if not exists(select 1 from public.portal_admin_audit_log where target_user_id=emp and action='attendance_session_auto_closed') then raise exception 'Missing timeout audit'; end if;
 if has_function_privilege('authenticated','public.portal_workforce_action(uuid,uuid,text,jsonb)','EXECUTE') or has_table_privilege('authenticated','admin_private.screen_signals','SELECT') or has_table_privilege('anon','admin_private.screen_shares','SELECT') then raise exception 'Private signaling grants leaked'; end if;
end $test$;
rollback;
select 'PASS: connect, refresh, two tabs, one-tab close, hidden lease, recovery, timeout, reopen, final close, normal logout, spoofing, Co-CEO gating, signaling generations, revocation, cleanup, audit and private grants (all changes rolled back)' as result;
