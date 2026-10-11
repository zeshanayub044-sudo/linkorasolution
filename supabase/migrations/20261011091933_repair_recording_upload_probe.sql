-- Storage v1.80.2 probes INSERT with contentLength before bytes are stored.
-- Final object metadata uses size. Both must match the immutable reservation.
-- Ownership, active leases, retention, private reads and non-upsert rules are unchanged.
create or replace function admin_private.recording_upload_allowed(p_path text,p_metadata jsonb)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from admin_private.screen_recording_segments s
 join admin_private.screen_recordings r on r.id=s.recording_id
 join public.employee_activity_sessions a on a.session_id=r.attendance_session_id
 join admin_private.portal_clients c on c.session_id=a.session_id and c.tab_id=r.tab_id
 where s.storage_path=p_path and coalesce(p_metadata->>'size',p_metadata->>'contentLength')::bigint=s.size_bytes and s.upload_status='pending' and s.generation=r.generation
 and r.employee_id=(select auth.uid()) and r.auth_session_id=((select auth.jwt())->>'session_id')::uuid
 and admin_private.portal_identity(r.employee_id,r.auth_session_id)
 and r.status in ('recording','upload_issue') and r.retention_until>now()
 and a.status='Logged In' and c.auth_session_id=r.auth_session_id and c.close_requested_at is null
 and c.last_seen_at>now()-interval '15 seconds' and r.owner_seen_at>now()-interval '20 seconds');
$$;
