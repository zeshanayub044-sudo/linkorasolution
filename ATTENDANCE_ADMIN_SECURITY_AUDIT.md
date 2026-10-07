# Attendance Admin security audit

Snapshot: 2026-10-06 Pacific / 2026-10-07 UTC, Supabase project `nbvylffxmjmovyfhbytu`.

| Object / operation | Anonymous | Active employee | Active Co-CEO | Enforcement |
| --- | --- | --- | --- | --- |
| Own `employee_profiles` row | Denied | Read only | Own row through RLS; directory through authorized Edge Function | RLS, active-ID predicate |
| Raw `employee_activity_sessions` | Denied | Denied | Denied directly | Table grants revoked; service-role functions only |
| Daily, monthly, history, issues, audit RPCs | Denied | Denied | Allowed | `public.is_admin()` within security-definer RPC |
| Manual session/correction/settings RPCs | Denied | Denied | Allowed with validation and audit | `public.is_admin()` and transaction audit |
| `admin-users` account actions | Denied | Denied | Allowed | Verified JWT, Auth lookup, active Co-CEO profile |
| `manage-employee` own start/end | Denied | Allowed | Allowed | Verified bearer and matching Auth UUID; service-role RPC |
| `manage-employee` report/Sheets retry | Denied | Denied | Allowed | Active Co-CEO check in Edge Function |
| `employee_active_periods`, Sheets queue, audit table | Denied | Denied | RPC/Edge only | RLS enabled, direct grants revoked |
| Company settings table | Denied | Read only | Read only directly; audited RPC updates | RLS and least-privilege grants |

`manage-employee` retains `verify_jwt=false` because it previously used this configuration, but it rejects a missing/invalid bearer via Supabase `auth.getUser` before profile lookup or service-role operations. `admin-users` has platform JWT verification enabled and independently verifies the actor. Neither takes an admin role from browser input. The admin page contains the public anon key only. Both active Co-CEO profiles were verified in production; no second authorization table was introduced.

The employee profile RLS test returned exactly one visible own profile and zero other profiles. The employee role had no direct attendance read, audit read, or profile update privilege. Employee calls to settings, live, filtered-history, and manual-add RPCs raised `42501`; an anonymous daily-report call was denied at the function grant. Co-CEO calls succeeded. Manual add/correction/settings, employee edit/deactivation, and safe sign-out tests were performed in transactions that rolled back. The unauthenticated page rendered only the sign-in gate. Browser tests with both Co-CEO passwords, live Auth account creation, and an actual invalid-bearer Edge request were not possible in this run and remain manual verification items; the shell's outbound HTTP check was unavailable.

Session integrity: valid status and timestamp constraints are enabled; administrative corrections require a nonempty reason and preserve before/after audit values. Old open sessions are never silently closed. Admin sign-out rejects old/multiple open rows; deactivation flags historical rows rather than assigning a fabricated logout, and employee sign-out does the same if only an old session exists. Rollback-only tests verified each path. The queue is an at-least-once mirror; concurrent background retries could duplicate a Sheets row if the receiver does not deduplicate by `(session_id, action)`. An administrator should monitor pending rows and the Edge Function logs after deployment. Schedule changes affect future calculated reports and are audited. Historical active intervals are backfilled from profile creation time, because no earlier activation/deactivation timeline existed; verify any exceptional employment dates before relying on older absence totals.

No password or service-role key is committed in the changed browser files, migrations, or documentation. The existing ignored `portal-config.js` contains only the public client configuration. Never place Edge secrets in it.
