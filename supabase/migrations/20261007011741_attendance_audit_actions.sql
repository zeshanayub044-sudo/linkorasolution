-- Preserve the existing audit vocabulary and allow the new attendance actions.
alter table public.portal_admin_audit_log
  drop constraint portal_admin_audit_log_action_check;
alter table public.portal_admin_audit_log
  add constraint portal_admin_audit_log_action_check check (action in (
    'user_created', 'user_edited', 'user_disabled', 'user_enabled',
    'role_changed', 'attendance_signed_in', 'attendance_signed_out',
    'stale_session_flagged', 'attendance_settings_changed',
    'attendance_corrected', 'attendance_manually_added'
  ));
