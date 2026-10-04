# Tennis Portal backend repair — Phase 1

Date: 2026-09-30. Project ref: `nbvylffxmjmovyfhbytu`. This report continues from `TENNIS_PORTAL_AUDIT.md`; it records a targeted production security migration. The public site, Tennis Portal UI, Auth accounts, Edge Function bodies, Google Apps Script, and user rows were not changed.

## Summary

The live legacy leave self-update and direct attendance write policies were removed. Browser roles can no longer call the employee-ID-to-email lookup, and anonymous callers can no longer execute the legacy privileged attendance/admin RPCs. A validated check constraint now limits `employee_profiles.role` to the two values already in production: `Employee` and `Co-CEO`. The existing Tennis identity table and Co-CEO backend role check remain in place. Production recorded migration `20260930203350_security_hardening`, and the local SQL file matches the recorded SQL exactly.

Deliverables: `supabase/migrations/20260930203350_security_hardening.sql`, `supabase/tests/security_phase1.sql`, `supabase/tests/role_visibility_phase1.sql`, `supabase/SCHEMA_OWNERSHIP.md`, and pre/post read-only catalog snapshots under `supabase/`. The recovered original migration and Edge Function sources from the audit remain present.

## CLI / project state

`npx supabase --version` succeeded with CLI **2.118.0** using a writable temporary npm cache. `supabase init` created `supabase/config.toml` locally; it is ordinary nonsecret local-stack configuration. No `.temp/project-ref` existed. The CLI `link --project-ref nbvylffxmjmovyfhbytu` returned `AccessTokenRequiredError`; no CLI access token was available. Therefore `migration list --linked` returned `ProjectRefNotLinkedError`, and a read-only `db dump --project-ref ... --schema public --dry-run` also required a CLI access token. No project link was falsely recorded or pointed at a different project.

The connected Supabase tool independently verified the target project ID/ref and healthy status before any production operation. It listed the one initial migration and retrieved live catalog data. Its migration operation was used to apply the **same** reviewed SQL kept in the repository. This avoided entering or exposing an access token, database password, or service-role credential. To finish CLI linking later, authenticate the CLI through its normal login flow and verify the project ref before a read-only dump; no token belongs in this repository or report.

## Migration state

Remote migration history now lists `20260912000000_tennis_portal` and `20260930203350_security_hardening`. The Phase 1 migration was originally generated with `npx supabase migration new security_hardening`, reviewed, applied through Supabase's migration tool, and renamed locally to the version assigned remotely. A read-only comparison of `schema_migrations.statements[1]` and the local file matched after newline normalization. No `db push`, `db reset`, `migration repair`, or blind baseline marking was run.

The complete production schema is **not yet reproducible from local migrations**. The earlier legacy attendance tables, functions, policies, grants, indexes, triggers, and `employee_profilesss` are still live but missing from recorded migration history. The existing standalone `supabase-attendance-setup.sql` is not an accurate migration for the live state and must not be blindly applied. `supabase/LIVE_SCHEMA_CATALOG_PRE_PHASE1.json` and `supabase/LIVE_SCHEMA_CATALOG.json` capture read-only metadata before and after this repair (tables, columns, constraints, indexes, policies, public function definitions, triggers, migration list); the post-change snapshot also records effective function grants. These are evidence for later baseline work, not executable migration files. A full CLI schema dump and local replay remain pending until CLI authentication and a suitable local database runtime are available. No production migration-history repair was attempted.

## Security repairs

| Issue | Before | After | Why | Test result |
| --- | --- | --- | --- | --- |
| Legacy leave self-approval | `leave_update` allowed an authenticated owner to update their row, including `status`. | `leave_update` is gone. `leave_create`/`leave_insert` still allow own insert, `leave_read` allows own/admin read, and `leave_admin_update` requires `is_admin()` in both `USING` and `WITH CHECK`. | RLS cannot distinguish an employee edit from an approval when one broad UPDATE policy covers both. Removing the staff UPDATE policy leaves decisions to the existing legacy admin path. | Post-migration catalog assertion passed; policy readback shows only `leave_admin_update` for UPDATE. No live leave rows were changed. |
| Direct attendance manipulation | `attendance_insert` and `attendance_update` allowed own-row direct writes to authoritative timestamps/status. | Both policies are gone; `attendance_read` and admin DELETE remain. Authenticated callers retain the existing `check_in`, `check_out`, and admin-checked `correct_attendance` RPCs. | Existing RPCs generate server time and the correction RPC writes `audit_log`; direct table writes bypassed those controls. | Catalog assertion passed; no INSERT/UPDATE/ALL policy remains. RPC EXECUTE grants for authenticated users remain. No attendance rows were changed. |
| Employee email enumeration | `employee_login_email(text)` was executable by `anon` and `authenticated`, including through inherited `PUBLIC` grants. No checked-in frontend caller was found. | EXECUTE revoked from `PUBLIC`, `anon`, and `authenticated`; `service_role` has an explicit grant. Function definition retained. | Anonymous or employee-ID lookup could disclose active legacy email addresses. | Effective `has_function_privilege` readback: anon=false, authenticated=false, service_role=true. Anonymous role smoke test also false. |
| Anonymous privileged RPC surface | Anonymous EXECUTE was effective for `check_in`, `check_out`, `correct_attendance`, and `is_admin`, though function-body checks limited effects. | Inherited/public and direct anonymous EXECUTE revoked; authenticated grants retained. | Reduces unnecessary reachability of `SECURITY DEFINER` code without changing legacy employee/admin operation. | Effective grants readback confirms anon=false and authenticated=true for all four. Advisor no longer reports anonymously executable definer RPCs. |
| Malformed Tennis roles | `employee_profiles.role` was required text without an allowed-value constraint. | Validated `employee_profiles_role_check` permits `Employee` and `Co-CEO`. | Prevents misspelled or unexpected role values while keeping the database profile as Tennis role authority. | Preflight found zero other values; post-readback shows validated constraint. All six Tennis profiles remain. |

No new employee-edit policy was added to `leave_requests`: staff can submit and read, but submitted records cannot be edited directly in this phase. This is the conservative choice allowed by the brief. Existing legacy administrators still use `is_admin()` for decisions; Tennis `Co-CEO` does not automatically mean legacy `profiles.role='admin'`.

## RLS matrix

“RPC” means the function, not direct table write. Tennis Co-CEO report access is an Edge Function operation, not a browser SELECT on session rows.

| Object / operation | Anonymous | Ordinary authenticated employee | Tennis Co-CEO | Legacy `profiles` admin | Service role |
| --- | --- | --- | --- | --- | --- |
| `employee_profiles` | No rows | Own active row SELECT; no direct role UPDATE | Own active row SELECT | Same Tennis RLS unless also own Tennis profile | Full privileged access for the Edge Function |
| `employee_activity_sessions` | No rows/writes | No direct access | No direct access; report only through `manage-employee` role check | No direct access absent service role | SELECT/INSERT/UPDATE retained |
| `leave_requests` | No rows/writes | Own SELECT and own INSERT; no UPDATE/approval | Same unless also legacy admin | SELECT/UPDATE/DELETE through `is_admin()` policies | Privileged access |
| `attendance_records` | No rows/writes | Own SELECT; check-in/out through server-timestamped RPCs | Same unless also legacy admin | SELECT/DELETE; corrections through audited `correct_attendance` RPC | Privileged access |
| `employee_login_email(text)` | No EXECUTE | No EXECUTE | No EXECUTE as browser role | No EXECUTE as browser role | EXECUTE retained |
| `check_in()` / `check_out()` | No EXECUTE | EXECUTE, with function-body checks | EXECUTE, with same checks | EXECUTE, with same checks | EXECUTE retained |
| `correct_attendance(...)` / `is_admin()` | No EXECUTE | EXECUTE; `is_admin()` false for ordinary legacy staff, so correction rejected | Depends on separate legacy admin profile | EXECUTE; correction requires active admin and writes audit | EXECUTE retained |

## Tests performed

1. Before deployment, read-only preflight found six Tennis profiles with supported role values, zero unexpected attendance write policies, zero unexpected leave update policies, and one existing remote migration. `supabase/tests/security_phase1.sql` failed on the known unsafe attendance policy as expected.
2. After deployment, the same read-only catalog test returned `phase1_catalog_checks_passed`. It checks policies, effective function grants, role constraint, Tennis profile RLS, anonymous policy absence, and service-role table privileges.
3. A read-only `SET LOCAL ROLE authenticated` simulation using an existing ordinary employee showed one own Tennis profile, zero other profiles, zero directly visible activity rows, and `is_admin()=false`. A Co-CEO simulation showed one own active Co-CEO profile and zero direct session rows. The anonymous simulation showed zero protected rows and no email-lookup EXECUTE. A service-role simulation still saw six profiles and 39 session rows. The queries neither displayed identifiers nor changed rows; their reproducible form is in `supabase/tests/role_visibility_phase1.sql`.
4. An ordinary employee context calling the admin-only `correct_attendance` RPC received `42501 Administrator access is required` before any update. An anonymous context calling `employee_login_email` received `42501 permission denied for function`. Both checks ran in read-only transactions against a nonexistent test target or lookup value.
5. Auth user count (7), Tennis profile count (6), Tennis activity count (39), legacy profile count (2), and empty legacy attendance/leave counts were unchanged after deployment. Deployed function versions remained `manage-employee` 14 and `quick-responder` 9. The migration SQL read back from remote history matched the local file.

These tests verify database authorization and deployed migration state. They do **not** constitute a real Auth password login, password reset, Google webhook, or authenticated Edge Function report request. No employee password/token was available, and no account was created for testing.

## Production verification

The live policy list now has `attendance_read` and `attendance_admin` only for `attendance_records`. `leave_requests` has `leave_read`, own insert policies, `leave_admin_update`, and admin DELETE; `leave_update` is absent. `employee_profiles` retains its original own-active SELECT policy. Effective RPC grants and the role constraint match the intended migration. Supabase security advisors no longer list anonymously executable definer functions; remaining notices include no-policy RLS on service-only/unused tables, `set_updated_at` search path, authenticated definer RPCs, and disabled leaked-password protection. Those remaining notices were outside this phase.

The production migration contained policy drops, function GRANT/REVOKE changes, and one CHECK constraint. It did not delete user data, replace function bodies, alter Auth settings, or deploy Edge Functions. It did not touch the Tennis Portal frontend.

## Unresolved issues

- The CLI is initialized locally but **not linked** because it lacks a CLI access token. The connected Supabase tool was used for this migration; `migration list --linked` and `db dump` cannot run until CLI authentication is established.
- The local migration chain still lacks a validated baseline for legacy and accidental live objects. Catalog snapshots preserve current evidence, but clean-environment replay has not been demonstrated. Phase 2 should obtain a complete schema-only dump, reconcile drift without blindly marking history, and run a local replay before further schema work.
- A person with an existing employee account should smoke-test password login, profile display, password reset, and Co-CEO `get-activity-report` in the deployed portal. The database and function source checks strongly suggest these paths are preserved, but this phase did not use a live employee session.
- External consumers of `employee_login_email` and the old attendance RPCs were not observable outside this repository; only `employee_login_email` browser-role access was intentionally closed. If an external client used that lookup, its login flow needs review.
- Google Sheets contract mismatch, activity session lifecycle, stale-session cleanup, provisioning/termination workflows, and legacy-object retirement remain deferred as requested. Do not start those repairs automatically.

Recommended next phase: finish CLI-authenticated schema recovery and reproducible local replay, then validate the deployed Google Sheets contract and activity-session behavior. Keep the existing Tennis identity table and server-side Co-CEO authorization during those changes.
