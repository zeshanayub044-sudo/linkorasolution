# Supabase schema ownership, 2026-09-30

This inventory is based on the checked-in callers, the deployed Edge Function source, live PostgreSQL catalogs and aggregate row counts. `LEGACY UNKNOWN` means the repository does not show a current consumer, but an external client may still use the object. No object is deleted in Phase 1.

| Object | Category | Evidence and disposition |
| --- | --- | --- |
| `public.employee_profiles` | TENNIS PORTAL ACTIVE | `tennis-portal.js` loads it after Auth login; deployed `manage-employee` checks it. Six active rows. Retain as the Tennis identity and role source. |
| `public.employee_activity_sessions` | TENNIS PORTAL ACTIVE | Deployed `manage-employee` writes sessions and serves the Co-CEO report. 39 rows at audit. Retain. |
| Supabase Auth `auth.users` | TENNIS PORTAL ACTIVE | Browser password sign-in/reset and both profile tables reference Auth UUIDs. Seven users at audit. Retain. |
| Edge Function `manage-employee` | TENNIS PORTAL ACTIVE | Browser invokes `start-session`, `end-session`, `get-activity-report`; deployed version 14 supports them. Retain unchanged in Phase 1. |
| `public.profiles` | LEGACY UNKNOWN | Two rows, used by legacy RLS/RPCs and `supabase-attendance-setup.sql`; Tennis frontend does not query it. Confirm external consumers before retirement. |
| `public.attendance_records` | LEGACY UNKNOWN | Zero rows, used by legacy `check_in`, `check_out`, `correct_attendance`; no checked-in active frontend caller. Direct staff writes are removed in Phase 1, but table and RPCs remain. |
| `public.leave_requests` | LEGACY UNKNOWN | Zero rows, read by `check_in` and legacy policies; no checked-in active frontend caller. Staff own create/read and admin decision path remain. |
| `public.company_settings` | LEGACY ATTENDANCE ACTIVE | One configuration row read by `check_in`/`check_out`; required while those RPCs remain available. |
| `public.audit_log` | LEGACY ATTENDANCE ACTIVE | `correct_attendance` writes an audit entry; zero rows today. Retain so corrections remain auditable. |
| `public.employee_profilesss` | ACCIDENTAL / UNUSED | Empty identity/timestamp table; no foreign key, policy, repository reference, or deployed Tennis Function use. Investigate provenance before any later cleanup. |
| RPC `public.check_in()` | LEGACY UNKNOWN | Server-timestamped legacy attendance insert; no checked-in caller. Retained for possible external use; anonymous EXECUTE revoked. |
| RPC `public.check_out()` | LEGACY UNKNOWN | Server-timestamped legacy attendance update; no checked-in caller. Retained; anonymous EXECUTE revoked. |
| RPC `public.correct_attendance(uuid,timestamptz,timestamptz,text)` | LEGACY UNKNOWN | Uses `is_admin()` and writes `audit_log`; no checked-in caller. Retained; anonymous EXECUTE revoked. |
| RPC `public.employee_login_email(text)` | SAFE CANDIDATE FOR RETIREMENT | No repository frontend or deployed Function call. It exposes an active legacy email by employee ID; browser-role EXECUTE revoked in Phase 1. Keep definition until external consumers are checked. |
| RPC `public.is_admin()` | LEGACY ATTENDANCE ACTIVE | Referenced by live legacy RLS policies and `correct_attendance`. Based on active `profiles.role='admin'`, unrelated to Tennis `Co-CEO`. Anonymous EXECUTE revoked, authenticated retained. |
| Trigger function `public.set_updated_at()` | LEGACY ATTENDANCE ACTIVE | Used by live triggers on `profiles`, `attendance_records`, and `leave_requests`. Retain. |
| Edge Function `quick-responder` | SAFE CANDIDATE FOR RETIREMENT | Deployed generic sample under its own slug; no Tennis frontend call or employee-table query. Confirm external invocation before deletion in a later phase. |
| `supabase-attendance-setup.sql` | LEGACY UNKNOWN | Standalone SQL describing the older system, not a tracked Supabase migration; it differs from live policy state and must not be reapplied unreviewed. |
| `attendance.html` / `attendance.js` / `google-apps-script/Code.gs` | LEGACY UNKNOWN | Separate Google sign-in and Sheets log, not the Supabase Tennis flow. External deployment/usage is unverified. |

The current recorded migration history only creates the two Tennis tables. It does not reproduce the older tables, functions, triggers, indexes, grants, or `employee_profilesss`. The Phase 1 security migration is written against the verified live catalog; a full historical baseline still requires a complete read-only schema dump and controlled migration-history reconciliation. No category here authorizes deletion.
