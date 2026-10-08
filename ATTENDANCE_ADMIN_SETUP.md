# Attendance Admin setup

The employee route is `tennis-portal.html`; the Co-CEO route is `attendance-admin.html`. Supabase Auth and `employee_profiles` identify employees. `employee_activity_sessions` is the authoritative attendance history. Google Sheets is a reporting mirror and may lag without blocking sign-in or sign-out. Blog and Careers are unaffected.

## Access and employee management

The page admits only an authenticated user whose `employee_profiles` row is active with role `Co-CEO`. Every privileged reporting and mutation RPC repeats that check through `public.is_admin()`. The `admin-users` and `manage-employee` Edge Functions validate bearer tokens and active profiles before privileged service-role operations. Only active Co-CEOs can request company-wide reports or sync. Neither the service-role key nor the Sheet secret is in browser assets.

Employees can be created, edited, activated and deactivated through the existing `admin-users` function. Creation provisions Supabase Auth and rejects duplicate email/employee ID. Deactivation removes future portal access while retaining all sessions, leave and audit history. Profile changes queue the current company date for Sheet matrix synchronization.

## Attendance and leave calculations

`portal_attendance_daily_v2` produces one row per employee and company-local date, using `company_settings.timezone`, workdays, start time and grace period. It uses `employee_active_periods` to avoid counting days before activation or after deactivation. A completed or open session counts as present. An older open or `Needs Review` session is **Missing Sign-Out**; no logout time is invented. A current-day open session is **Signed In**. Without attendance, an active scheduled day covered by an **Approved** `leave_requests` record is **On Leave**. Otherwise it becomes **Absent** only after the start/grace cutoff; future time is **Awaiting**. Unscheduled or inactive days are **Not Scheduled**. Actual attendance takes precedence over overlapping leave.

`portal_attendance_monthly_v2` counts present, absent, approved leave, late and missing sign-out days, completed work minutes and average hours. Attendance percent divides attended scheduled days by elapsed scheduled active days, excluding approved leave. Day/month views, employee detail, reports and CSV use these RPCs. Session history and issues retain established bounded RPCs. CSV exports escape formula prefixes.

The existing `leave_requests` table now references current `employee_profiles` UUIDs rather than legacy `profiles`. Employees may insert only their own **Pending** requests. Direct update/delete privileges are removed; a Co-CEO changes status or details through `portal_attendance_save_leave`, which requires an admin reason and writes before/after values to `portal_admin_audit_log`. Only Approved leave changes absence reporting. Manual session addition, correction and status changes retain their existing reason and audit requirements.

## Google Sheets delivery

Session inserts/edits and leave/profile changes queue work in Supabase transactions. `attendance_sheet_sync_queue` handles raw session rows; `attendance_matrix_sync_queue` handles company dates. `manage-employee` returns success after the Supabase session commits and starts a background sync attempt. A Sheet failure records an error and retry time; it cannot undo attendance. Co-CEOs can retry pending deliveries under Settings or rebuild a chosen 46-day matrix range. Queued work survives an Edge Runtime interruption. The raw tab stays `Tennis Portal Logs`; the new person-centric tab is `Attendance Matrix`. See [ATTENDANCE_GOOGLE_SHEET_SPEC.md](ATTENDANCE_GOOGLE_SHEET_SPEC.md).

## Deployment order

1. Apply `supabase/migrations/20261007130000_attendance_leave_and_matrix.sql`, `20261007131500_attendance_leave_audit_actions.sql`, `20261008100000_attendance_monthly_rate_fix.sql`, and `20261008103000_attendance_sync_version_guard.sql` in order. All four were applied to production; do not reset or replay them manually.
2. Save `google-apps-script/Code.gs` to the **existing bound project**, then deploy a new version of the existing web app. Keep the deployment URL and `GOOGLE_SHEETS_WEBHOOK_SECRET` Script Property.
3. Deploy `supabase/functions/manage-employee/index.ts` with its current custom bearer validation (`verify_jwt=false`). Keep `GOOGLE_APPS_SCRIPT_URL`, `GOOGLE_SHEETS_WEBHOOK_SECRET`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as Edge secrets only.
4. Publish the changed website files. The public `portal-config.js` should continue to contain only the Supabase URL and anon key.
5. Sign in as each Co-CEO, retry pending sync, and reconcile historical dates in Settings. Review the raw and matrix tabs before relying on the mirror for management exports.

Local checks: `node tests/google-apps-script.test.cjs` and `node tests/attendance-matrix.test.cjs`. Production verification should include an employee sign-in/out, open session, approved leave, absence, deactivated account, both Co-CEOs and employee/anonymous denial. Test employee creation and leave on reversible temporary records; do not invent historical sign-out times or delete existing sessions.
