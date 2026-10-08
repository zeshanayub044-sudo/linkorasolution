-- Cover new audit/provenance foreign keys used by administrator history queries.
create index if not exists employee_activity_sessions_login_actor_idx
  on public.employee_activity_sessions (login_actor_id);
create index if not exists employee_activity_sessions_logout_actor_idx
  on public.employee_activity_sessions (logout_actor_id);
create index if not exists portal_admin_audit_log_admin_idx
  on public.portal_admin_audit_log (admin_id, created_at desc);
