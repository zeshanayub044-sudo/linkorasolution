# Tennis Portal technical audit

Historical baseline: Phase 1 security repairs were deployed later on 2026-09-30. See `TENNIS_PORTAL_REPAIR_PHASE1.md` for the current policy and grant state.

Audit date: 2026-09-30. Scope: local repository at `main` and read-only inspection of Supabase project `nbvylffxmjmovyfhbytu`. No production data, users, settings, policies, functions, or migration history were changed. Counts below are point-in-time observations. No employee names, email addresses, keys, tokens, or passwords are reproduced here.

## 1. Executive Summary

The Tennis Portal is a static page using Supabase password Auth, a direct RLS-protected read of `public.employee_profiles`, and the deployed `manage-employee` Edge Function for activity logging and the Co-CEO report. The function writes `public.employee_activity_sessions` using a service-role client and calls a Google Apps Script webhook. This is the architecture actually referenced by the Tennis Portal frontend and live function.

The live database also contains an older `profiles`/attendance/leave system, a separate Google-sign-in attendance page, and an empty `employee_profilesss` table. These systems are not the Tennis Portal lifecycle. Only one remote migration is recorded; its statements have now been recovered locally, but it does **not** reproduce the whole live database. The CLI could not be run in this environment, and a standard initial `db pull` would record a new baseline as applied remotely according to [Supabase's CLI workflow](https://supabase.com/docs/guides/local-development/cli-workflows). No such history write was authorized for this audit.

**Assessment:** the primary portal has meaningful server checks for profile activity and Co-CEO report access, but the wider project is not yet a safe, reproducible base for new employee features. The highest risks are writable legacy attendance/leave records, the unverified and locally contradictory Google logging contract, incomplete migration history, and activity sessions that are often left open.

## 2. Current Architecture

`tennis-portal.html` loads `portal-config.js`, Supabase JS v2 from jsDelivr, and `tennis-portal.js` (`tennis-portal.html:50-52`). The public site footer links to the portal (`script.js:152`). The browser signs in with Supabase Auth, reads its own active `employee_profiles` row, then invokes `manage-employee` for `start-session`, `end-session`, and `get-activity-report` (`tennis-portal.js:29-35,110-115,157-170`). The Edge Function validates the bearer token with `auth.getUser`, reads the active profile with the service role, restricts reports by database role, writes activity sessions, and calls a Google webhook (`supabase/functions/manage-employee/index.ts:18-50`). The browser does not call that webhook.

The separate `attendance.html` → `attendance.js` → `activity-config.js` → Google Apps Script `Code.gs` flow uses Google ID tokens and a different sheet format. Its presence does not make it part of the Tennis Portal. The old Supabase attendance schema described by `supabase-attendance-setup.sql` is another distinct generation.

## 3. Local Repository Findings

Relevant Tennis files: `tennis-portal.html`, `tennis-portal.css`, `tennis-portal.js`, `portal-config.js`, `portal-config.example.js`, `TENNIS_PORTAL_SETUP.md`. Relevant legacy files: `supabase-attendance-setup.sql`, `ATTENDANCE_SETUP.md`, `attendance.html`, `attendance.css`, `attendance.js`, `activity-config.js`, `GOOGLE_SHEETS_SETUP.md`, and `google-apps-script/Code.gs`. Public navigation is in `script.js`; `sitemap.xml` also lists the portal.

Before this audit there was no `supabase/` directory, package manifest, local CLI binary, function source, migration file, or CLI link record. The remote migration and both deployed function sources were retrieved read-only and saved under `supabase/migrations/` and `supabase/functions/`. These are recovered remote artifacts, not implementation changes. `TENNIS_PORTAL_SETUP.md:9` references a missing `supabase/.env.example`; `ATTENDANCE_SETUP.md:4` references a missing `supabase/make-existing-admin.sql`. The live URL and public `anon` key in `portal-config.js` are expected browser values; no service-role key was found in the current tracked frontend. A scan of historical JWT-shaped values in `portal-config.js` decoded only the `anon` role. This does not prove every historical file or external deployment is secret-free.

## 4. Live Supabase Findings

The project API ref matches the requested `nbvylffxmjmovyfhbytu`; it is active and reports PostgreSQL 17.6. The GitHub repository `zeshanayub044-sudo/linkorasolution` is public and matches the local `origin`. Remote function listing found `manage-employee` (active, version 14, `verify_jwt=false`) and `quick-responder` (active, version 9, `verify_jwt=true`). Their source was retrievable. The project had 7 Auth users, 6 active Tennis employee profiles (2 `Co-CEO`, 4 `Employee`), 39 activity sessions (26 `Logged In`, 13 `Logged Out`), 2 legacy `profiles`, and no storage buckets. One Auth user has no Tennis profile. There is no Tennis profile without an Auth user. Five Tennis profiles have no matching legacy profile; one shared ID has a different `employee_id` across the two profile tables. These are counts and relationships, not a disclosure of user data.

Supabase's security advisor reported no-policy RLS on `employee_activity_sessions` and `employee_profilesss` (expected denial but deserving review), a mutable search path on `set_updated_at`, broad callable `SECURITY DEFINER` functions, and disabled leaked-password protection. Advisor details: [no-policy RLS](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [function search path](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [anonymous definer calls](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## 5. Database Schema

| Live table | Key columns and constraints | Use |
| --- | --- | --- |
| `employee_profiles` | `id` PK/FK `auth.users` cascade; unique `employee_id`; required `full_name`, `scheme`, `role`, `is_active`; timestamps | Active Tennis identity and role. No role enum/check. |
| `employee_activity_sessions` | `session_id` UUID PK; `employee_id` FK to `employee_profiles` with delete restrict; `login_at`, nullable `logout_at`, status check `Logged In`/`Logged Out` | Active Tennis activity; no direct RLS policies. |
| `profiles` | `id` PK/FK `auth.users` cascade; unique `employee_id` and `email`; `active`; `role` check `employee`/`admin` | Older Supabase attendance system. |
| `attendance_records` | UUID PK; employee FK to `profiles`; unique employee/date; check-in/out/status; generated `working_minutes`; correction fields | Older attendance data, currently zero rows. |
| `leave_requests` | UUID PK; employee FK to `profiles`; date range, reason, status | Older leave system, currently zero rows. |
| `company_settings` | Boolean singleton PK; timezone, workday start, lateness, workdays | Older attendance configuration. |
| `audit_log` | Identity PK; actor/target FKs to `profiles`; action/metadata | Older corrections audit, currently zero rows. |
| `employee_profilesss` | Identity PK, `created_at`; no foreign keys or policies | Empty apparent accidental table. |

All eight public tables have RLS enabled. No public views or enums were found. Primary and unique indexes exist for keys; additional indexes are `attendance_date_idx`, `attendance_employee_date_idx`, and `leaves_employee_dates_idx`. `profiles`, `attendance_records`, and `leave_requests` have `set_updated_at` triggers. No `auth.users` trigger was found, so profile creation is not automatic. Public RPC functions are `check_in`, `check_out`, `correct_attendance`, `employee_login_email`, `is_admin`, and trigger function `set_updated_at`; the first five are `SECURITY DEFINER`. Storage buckets: zero. Function grants inherited through `PUBLIC` make the definer RPCs callable by `anon`/`authenticated`; internal checks limit some effects, but `employee_login_email` returns an active legacy user's email for a supplied employee ID.

## 6. Migration Status

Remote history has exactly `20260912000000_tennis_portal`, six recorded statements (1,207 SQL bytes). Those statements were recovered from `supabase_migrations.schema_migrations` into `supabase/migrations/20260912000000_tennis_portal.sql`, with statement terminators added for a runnable SQL file. They create the two Tennis tables, enable RLS, and add the own-active-profile SELECT policy. They do not define the older attendance schema or the accidental table; those are live changes outside this recorded migration. `supabase-attendance-setup.sql` is a standalone SQL script, not a tracked Supabase migration, and its policy declarations differ from the current live policies.

No local `supabase/config.toml` or `.temp/project-ref` existed, so the checkout was neither initialized nor linked. `npx supabase --version` did not complete; `npx --no-install --offline supabase --version` returned `ENOTCACHED`, and no local binary or global `supabase` command was found. An alternate writable npm cache also stalled without a version. Thus CLI version and a CLI `migration list --linked` comparison could not be verified. The Supabase connector's migration list and the migration history table agreed on the one version. The project was not linked and `db pull` was not run. The Supabase CLI documentation says an initial `db pull` writes a new applied baseline to remote migration history; that conflicts with this audit's explicit no-history-change constraint. **Local migrations do not accurately represent the full current remote schema.** A later controlled baseline process must first resolve how to capture all live drift without overwriting history.

## 7. Edge Functions

`manage-employee` is deployed as version 14 with gateway JWT verification disabled, but its body requires `Authorization: Bearer`, calls Supabase Auth `getUser(token)`, and then requires an active `employee_profiles` row (`index.ts:18-29`). It allows only `start-session`, `end-session`, `get-activity-report` (`index.ts:24-25`). `start-session` inserts a server-timestamped database row and posts a `login` webhook; `end-session` posts `logout` before updating the row; report reads the latest 200 sessions and requires the database `Co-CEO` role (`index.ts:30-50`). The function uses `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_APPS_SCRIPT_URL`, and `GOOGLE_SHEETS_WEBHOOK_SECRET`; values were not retrieved. CORS allows `https://linkorasolution.com`; it is a browser-origin restriction, not the authorization boundary. Non-POST is rejected and errors are returned as JSON. Its source has been saved under `supabase/functions/manage-employee/`.

`quick-responder` is a deployed sample under an unrelated slug, named `manage-employee` in metadata, with `verify_jwt=true`; it echoes a supplied name and has no Tennis table queries. It is not invoked by the portal and was recovered under `supabase/functions/quick-responder/`. The two identical display names should not be mistaken for identical routes. Neither function was deployed or changed.

## 8. Authentication Architecture

Employees are provisioned manually: create a Supabase Auth email/password user, then insert a same-UUID row in `employee_profiles` (`TENNIS_PORTAL_SETUP.md:5-6`). There is no local admin creation screen, account invitation workflow, Auth trigger, or profile synchronizer. The portal has no sign-up control. Whether Supabase Auth's project-level self-signup setting is enabled could not be read with available tools; even a self-registered Auth user would fail portal profile lookup. Live Auth has 7 password accounts and none currently unconfirmed, but that does not establish the project's email-confirmation rule or first-password delivery method.

The browser persists and refreshes Supabase tokens through `persistSession`, `autoRefreshToken`, and URL-session detection (`tennis-portal.js:29-30`). `restoreSession` validates Auth via `getUser` and reloads the profile (`:117-122`). A missing/inactive profile triggers local sign-out. The function revalidates a token and database profile for every action, while database RLS controls direct profile reads. No role is read from user-editable JWT metadata. Auth URL allowlist, signup configuration, session lifetime/revocation settings, and actual Google webhook deployment are not observable through the available connector; these are explicit verification gaps.

## 9. Authorization & RLS

`employee_profiles` permits authenticated SELECT only when `id = auth.uid()` and `is_active = true`; no INSERT, UPDATE, or DELETE policy exists. Ordinary employees cannot directly read another Tennis profile or change their role through the Data API. `employee_activity_sessions` has RLS enabled with no policies, so browser access is denied; the function's service-role client performs writes and report reads. The Co-CEO panel is shown by a case-insensitive frontend role comparison (`tennis-portal.js:13-15,104-106`), while the function independently checks the active database role before returning the report (`index.ts:28-34`). This server check is the actual report authorization. `employee_profiles.role` has no allowed-values check, so malformed/unknown roles may silently lose executive access.

Legacy RLS is less safe. Live `attendance_records` has `attendance_insert` and `attendance_update` policies permitting an authenticated employee's own row; live `leave_requests` has `leave_create`/`leave_insert` and `leave_update` permitting that employee's own row. The broad table UPDATE grants mean a caller can change check-in/out or leave status directly, bypassing the older RPC's intended server timestamps and admin approval. `profiles` SELECT is own/admin, with admin write policies. `employee_login_email` is callable anonymously and reveals email by employee ID. No direct RLS policy exists on `employee_profilesss`. RLS does not constrain privileged service-role operations, so the Edge Function's bearer/profile/role checks are essential.

## 10. Employee User Lifecycle

1. **Create:** administrator uses Supabase Auth out of band, then creates `employee_profiles` with the Auth UUID and role. Duplicate UUID or employee ID is rejected by PK/unique constraints; a failed second step leaves an Auth-only account.
2. **Activate/first password:** password and confirmation/invite handling happen in Supabase Auth outside this repo. Live accounts are confirmed, but the configured requirement and initial delivery mechanism remain unverified.
3. **Login:** browser calls Auth password sign-in; on success, reads own active profile under RLS, generates a UUID, and calls `start-session`. Portal is rendered only after that action returns success (`tennis-portal.js:150-175`).
4. **Use:** employee sees profile fields; Co-CEO also requests a report. The page has no employee creation, attendance, leave, or other admin management controls.
5. **Logout:** `end-session` attempts webhook then database closure; only after success does browser call Auth sign-out (`:177-193`).
6. **Reset/subsequent login:** reset email returns to portal; recovery event shows new-password form; password update signs out; later sign-in repeats profile/session flow (`:123-149,195-198`).
7. **Disable/terminate:** setting `employee_profiles.is_active=false` blocks profile SELECT and Edge Function actions, but Auth credentials remain valid until separately disabled/revoked. Legacy `profiles.active` is a separate flag.

## 11. Admin / Co-CEO Lifecycle

Two live active `Co-CEO` profiles exist. The documented role spelling is `Co-CEO`; frontend and function normalize case/space for comparison. Their account creation and password lifecycle are otherwise the same as employees. Their extra operation is a read-only report via `get-activity-report`; server code checks active profile and `co-ceo`. There is no current UI or function action to create employees, change roles, disable users, reset another user's password, or manage attendance. The older `profiles.role='admin'` does not grant Tennis Co-CEO access. The project has two competing notions of administrator, and one shared Auth ID has conflicting employee IDs across those profile systems.

## 12. Login Lifecycle

Wrong password/nonexistent account: Supabase Auth returns an error and the page shows a sign-in error (`tennis-portal.js:157-163`); exact Auth error text is supplied by the service. Unconfirmed account: frontend special-cases `Email not confirmed`, but whether this can occur under current settings is unverified. Authenticated user without profile, inactive profile, or denied RLS row: `loadProfile` throws a generic inactive-account message and signs out (`:110-122,164-174`). Missing role cannot exist under the live NOT NULL constraint; malformed role can sign in as an ordinary employee. Duplicate profile employee ID is rejected by the database. Expired token: auto-refresh is enabled; a failed refresh or `getUser` error can leave the login screen without a specific message, because `restoreSession` checks only `data.user` (`:117-119`). Function/webhook failure after Auth login signs out and reports the activity error; network exceptions from `signInWithPassword`, reset, or `getUser` have no encompassing catch. The service does not create an activity row when an existing Auth session is restored after refresh (`:117-122,198`).

## 13. Logout Lifecycle

The tab stores a client-generated activity ID in `sessionStorage` (`tennis-portal.js:11,166-169`). On logout it passes that ID; if absent after a refresh/other tab, the function closes the user's most recent open activity row (`:181-187`; function `:43-50`). A webhook error prevents Auth sign-out entirely (`tennis-portal.js:186-191`), so employees can remain signed in while told sign-out failed. If the webhook succeeds and the database update fails, the sheet and database disagree. Browser/tab close has no Tennis Portal `pagehide` closure; refreshed sessions restore Auth but do not start or reconcile activity. The separate Google attendance page has its own best-effort `pagehide` behavior and is not this portal.

## 14. Password Reset Lifecycle

`resetPasswordForEmail` sends to the current portal path (`tennis-portal.js:123-132`); `PASSWORD_RECOVERY` switches to the reset form (`:195-197`); `updateUser({password})` writes the new password and signs out (`:134-149`). The form checks matching passwords and minimum length 8 (`tennis-portal.html:28-32`). The actual Auth redirect allowlist, email template, token lifetime, and password-strength/leaked-password rules could not be read. Supabase's advisor explicitly says leaked-password protection is disabled. Resetting a password does not set `is_active=true`; an inactive account still fails portal authorization after reset. No custom reset endpoint exists.

## 15. Employee Termination Lifecycle

Setting Tennis `is_active=false` removes direct profile visibility and blocks new function actions. It does not itself revoke an existing Supabase Auth session or close any existing `employee_activity_sessions` row. On next page load `restoreSession` signs the user out locally, but an already-rendered tab stays visible until it makes another protected request. The separate legacy `profiles.active` flag and Google `ALLOWED_EMAILS` list are independent. Disabling only one system leaves access in others. Deleting the Auth user cascades the Tennis profile, but the activity FK is `ON DELETE RESTRICT`; deletion can fail while session rows exist. No integrated termination procedure exists.

## 16. Activity / Session Logging

The DB uses a client-selected UUID as the activity session primary key, with server-set timestamps and `Logged In`/`Logged Out` status. There is no unique-open-session rule, expiry, automatic closure, or transaction with Google Sheets. Point-in-time count: 26 of 39 sessions remain `Logged In`. This is consistent with missing close/reconciliation paths but does not prove each open row is abandoned. Reports show the latest 200 by login time. `start-session` deletes the DB row on webhook failure, but ignores rollback-delete errors; `end-session` calls Google first and DB second. These are cross-system consistency risks. The Auth session and activity session are different concepts and are not linked by a server-owned identifier.

## 17. Google Sheets Integration

The deployed function posts `{secret, action, sessionId, email, employeeName, employeeId, scheme, role}` to an environment URL (`manage-employee/index.ts:7-11,40,49`). The local `google-apps-script/Code.gs:15-20,45-54` expects `{credential, action, id}` and validates a Google ID token; its sheet columns are `Record ID | User Name | User Email | ...` (`Code.gs:2-3`). It is the backend for the *separate* Google attendance page (`attendance.js:15-20,36-42`). `TENNIS_PORTAL_SETUP.md:7-8` instead describes a `Tennis Portal Logs` sheet with 11 different columns and a shared webhook secret. The described Tennis-specific Apps Script handler is absent locally. Because the actual deployed Apps Script source and Edge Function environment values were not available, live webhook success/failure cannot be proven. If `GOOGLE_APPS_SCRIPT_URL` points at the checked-in `Code.gs`, every Tennis webhook would fail its credential/ID checks. The Edge Function also treats a non-JSON 2xx response as success (`index.ts:9-11`), so an HTML error/redirect could be misreported as recorded activity.

## 18. Frontend ↔ Backend Contract

| Frontend call | Live backend/database | Result |
| --- | --- | --- |
| Auth `signInWithPassword(email,password)` | Supabase Auth password accounts | Implemented; no public sign-up UI. |
| `employee_profiles` SELECT by Auth UUID | Live table and own-active SELECT policy | Implemented; inactive/missing rows are hidden. |
| `manage-employee/start-session` with UUID | Deployed function v14 and activity table | Implemented; depends on Google webhook. |
| `manage-employee/end-session` with optional UUID | Deployed function v14 | Implemented; optional fallback can close a different open tab's row. |
| `manage-employee/get-activity-report` | Deployed function v14, database Co-CEO check | Implemented; latest 200 rows. |
| Auth `resetPasswordForEmail` and `updateUser` | Supabase Auth | Implemented in code; redirect configuration unverified. |
| Employee creation/termination UI | No Tennis action or local management function | Missing. |
| Tennis Google Sheets webhook | Function sends secret-based payload; local Apps Script requires Google credential | Local contract mismatch; actual remote script unverified. |

## 19. Security Findings

Severity is based on reachable behavior and impact, with verification limits stated. Each finding gives component, current behavior, expected behavior, root cause, impact, and recommended fix.

| Severity | Component / evidence | Current behavior and root cause | Expected behavior and impact | Recommended fix |
| --- | --- | --- | --- | --- |
| **HIGH** | Live `leave_requests` policies `leave_update`, `leave_create`, `leave_insert`; `supabase-attendance-setup.sql:114-119` differs | Signed-in legacy staff may UPDATE their own row, including `status`; broad table UPDATE grant exposes all columns. The live policy was not removed by the standalone SQL. | Only an authorized admin should approve/reject leave. A staff member can self-approve; no rows exist now, but the path is live. | Remove staff UPDATE capability/policy; expose constrained staff submission and admin decision operations, then verify with role-based tests. |
| **HIGH** | Live `attendance_records` policies `attendance_insert`, `attendance_update`; `supabase-attendance-setup.sql:107-113` differs | Signed-in legacy staff can directly insert/update their own timestamps/status, bypassing `check_in`, `check_out`, and correction audit. | Server-owned times and audited corrections. Time and pay/attendance integrity can be forged if this schema is used. | Remove direct write policies/grants and keep narrowly checked RPCs, or retire this unused system after data review. |
| **HIGH** | `manage-employee/index.ts:7-11,40,49`; `google-apps-script/Code.gs:15-20,45-54`; `TENNIS_PORTAL_SETUP.md:7-9` | Three incompatible webhook/sheet contracts exist locally; live Apps Script target is opaque. | One documented, versioned contract with a verified deployed handler. Login/logout can fail or silently misreport sheet writes. | Retrieve and compare the deployed Apps Script, then align source, payload, response validation, and sheet schema in a later repair phase. |
| **HIGH** | Remote migration history; `supabase/migrations/20260912000000_tennis_portal.sql`; live legacy tables | One recorded migration omits much of the live schema; CLI checkout was unlinked/unavailable. | Repeatable migration chain reproducing live public schema. Rebuilds and later changes can drift or fail. | Establish CLI access in a controlled environment, review full catalog/schema dump, and create a reconciled baseline without forcing history repair or production writes during this audit. |
| **HIGH** | `tennis-portal.js:117-122,166-193`; `manage-employee/index.ts:36-50`; 26/39 open sessions | Restored Auth sessions do not reconcile activity; logout requires webhook success; fallback may close the latest other tab; no expiry. | Each Auth login/logout should have reliably matched activity and eventually closed records. Reports can be inaccurate; users can be stuck signed in when logging fails. | Make logout independent of logging success, use a server-owned activity ID/state, idempotent close/retry, and scheduled reconciliation. |
| **MEDIUM** | `manage-employee/index.ts:9-11` | Any 2xx non-JSON webhook response is accepted after `SyntaxError`; success is not positively required. | Require exact machine-readable success acknowledgment. HTML errors can be counted as recorded logs. | Reject unparsable or missing success fields; distinguish redirect, transport, and application errors. |
| **MEDIUM** | `manage-employee/index.ts:40,49-51` | Cross-system writes are ordered but not atomic; rollback delete error ignored. | Explicit durable retry/outbox or single source of truth. Sheet/DB may diverge after partial failure. | Make DB authoritative, queue webhook delivery with idempotency, and monitor retries. |
| **MEDIUM** | Live `employee_login_email(text)`; `supabase-attendance-setup.sql:64-65` | Anonymous caller can resolve an active legacy employee ID to email via `SECURITY DEFINER`. | No public profile enumeration. Increases phishing/account-discovery risk. | Revoke `anon` EXECUTE and replace lookup with a non-enumerating login flow. |
| **MEDIUM** | `employee_profiles.role` live constraint; `tennis-portal.js:13-15`; function `:31` | Arbitrary non-null role text is accepted; code recognizes only normalized `Co-CEO`. | Defined role vocabulary and single authorization source. Bad role data silently removes admin access or causes inconsistent UI. | Add validated role values and centralize role mapping after checking existing rows. |
| **MEDIUM** | `employee_profiles.is_active`; `profiles.active`; Auth sessions; `manage-employee/index.ts:28-29` | Deactivating a Tennis profile blocks portal data/function access but does not revoke Auth or legacy/Google access. | One termination workflow that revokes sessions and all app entitlements. Existing tabs and other systems may remain accessible. | Document and implement coordinated deactivation/revocation/closure after audit. |
| **MEDIUM** | Live Auth and profile counts; no Auth trigger; `TENNIS_PORTAL_SETUP.md:5-6` | Manual two-step creation leaves 1 Auth-only user today; no repair/rollback flow. | Atomic or recoverable provisioning with one identity source. Orphan accounts create confusion and potential later mismapping. | Build an admin-only provisioning flow with rollback and reconciliation checks. |
| **LOW** | `tennis-portal.js:117-119,123-149,150-158` | Some Auth/network calls lack outer exception handling; restore ignores `getUser` error. | Actionable failure states without stuck controls or silent screens. Outages produce poor UX. | Add explicit network/error handling and retry paths. |
| **LOW** | `tennis-portal.html:51` | Supabase JS uses floating CDN major `@2`, with no local lock/integrity pin. | Reproducible reviewed client version. Unexpected upstream minor changes may alter behavior. | Pin an exact version and consider local build/integrity control. |
| **LOW** | Live `quick-responder`; `employee_profilesss`; older Supabase schema | Active sample function and empty typo table remain, alongside unused old schema. | Clear inventory and minimal exposed surface. Confuses operators and adds maintenance burden. | Confirm consumers and retain evidence before retiring in a later phase. |

No client-side service-role key, client-writable Tennis role policy, or anonymous `employee_profiles` SELECT policy was found. No code path logs a password or bearer token, although webhook error bodies may be logged (`manage-employee/index.ts:10-11`). A caller chooses the activity UUID but the function binds it to the validated Auth user, so the current source does not show cross-employee session spoofing; its loose UUID pattern and cross-tab fallback remain integrity concerns. Gateway `verify_jwt=false` is not by itself an authentication bypass here because function code calls `getUser(token)` and checks active profile; keep that check in any refactor. CORS limits browser origins but does not stop direct HTTP callers, which is why the bearer/profile checks matter. The advisor's definer-RPC warnings include functions whose bodies check active/admin and should be assessed individually, rather than all treated as proven privilege escalation.

## 20. Broken or Missing Components

Missing locally: Tennis-specific Apps Script webhook implementation, `supabase/.env.example`, old documented `supabase/make-existing-admin.sql`, CLI config/link, complete migration baseline, employee admin provisioning/termination workflow, and automated activity reconciliation. Present remotely but absent before this audit: both Edge Function sources and the recorded Tennis migration; these have now been recovered locally. There is no evidence of an Edge Function action to create employees, despite the `manage-employee` name and old attendance documentation.

## 21. Local vs Live Supabase Differences

| Subject | Local code | Local documentation | Live Supabase |
| --- | --- | --- | --- |
| Identity | `employee_profiles` + Auth | Tennis setup says manual Auth + profile | Both exist; 6 profiles / 7 Auth users. |
| Tennis activity | `manage-employee` actions | Apps Script-backed session sheet | 39 DB sessions; function actions match frontend. |
| Admin role | `Co-CEO` | Exact `Co-CEO` named | 2 active `Co-CEO`; server checks role. |
| Google handler | Checked-in `Code.gs` uses Google credential + `id` | Tennis setup says secret + `sessionId` and different sheet | Function posts secret + `sessionId`; actual Apps Script target/source unknown. |
| Migration | Recovered one Tennis migration | Tennis setup names that file | One version recorded, plus unmigrated live objects. |
| Older attendance | Standalone SQL attempts restrictive writes | `ATTENDANCE_SETUP.md` claims RPC-only changes | Live write policies still allow staff own-row updates. |
| Employee management | No Tennis admin UI/action | Manual creation only | No deployed Tennis creation action. |
| CLI | No package/config/link | Setup assumes `supabase` commands | Connector works; CLI version/link unavailable locally. |

## 22. Legacy/Unused Components

**Active and required:** Supabase Auth, `employee_profiles`, `employee_activity_sessions`, `manage-employee`, portal frontend. **Active but flawed:** activity-to-Google workflow and manual employee provisioning. **Legacy or unused by Tennis:** `profiles`, `attendance_records`, `leave_requests`, `company_settings`, `audit_log`, their RPCs, standalone attendance SQL, and Google-sign-in `attendance.html` flow. These may still serve a separate staff page; they should not be deleted based solely on this audit. **Missing locally but present remotely before recovery:** one migration and two function sources. **Referenced but missing:** Tennis-specific Apps Script handler, `.env.example`, old admin SQL, end-to-end employee admin actions. **Duplicated:** two profile/role/activity concepts and two different Google Sheets log formats. **Unsafe:** legacy staff write policies and anonymous email lookup. `employee_profilesss` appears accidental and empty; `quick-responder` is a sample endpoint. Neither is used by Tennis code.

## 23. Data Integrity Risks

One Auth-only user, a shared ID with mismatched employee IDs, and 26 currently open Tennis activity rows show that the three identity/logging systems need reconciliation. `employee_activity_sessions.employee_id ON DELETE RESTRICT` can block deletion of a profile/Auth user with logs. Multiple concurrent open sessions per employee are allowed. Sheet/DB writes lack atomicity and an idempotent retry queue. The legacy system's direct write policies undermine server timestamps and leave approval. No production rows were altered to test any path.

## 24. UX Failure Cases

| Case | Observed code behavior |
| --- | --- |
| Wrong password or nonexistent account | Auth error shown; user remains at login. |
| Inactive/missing profile | Generic inactive-account error, then sign-out. |
| Email unconfirmed | Special explanatory message if Auth returns that exact error. |
| Duplicate employee ID | Database rejects manual insert; Auth-only orphan possible. |
| Missing/malformed role | NOT NULL blocks missing; unknown role signs in without Co-CEO panel. |
| Expired/failed Auth refresh | Auto-refresh attempted; restore can silently stop on no user. |
| Network/Supabase outage | Some calls lack catch; form may stay disabled or message remain stale. |
| Edge Function or Google failure at login | Auth signs out; error displayed; rollback may leave an activity row if delete fails. |
| Google failure at logout | Auth sign-out is skipped; user stays signed in. |
| Refresh/other tab | Auth restores, activity ID may be missing; logout chooses latest open session. |
| Deleted Auth user | Token validation eventually fails; activity FK can obstruct deletion if logs remain. |
| Password reset redirect not allowed | Reset flow may fail to return to portal; configuration not verified. |

## 25. Recommended Target Architecture

Keep one employee identity table linked to Auth UUID, with a constrained role and an admin-only provisioning/deactivation service. Keep server-side checks for active status and Co-CEO rights; RLS should enforce own-row access for browser reads. Treat database activity as authoritative; use server-generated, idempotent session records and an outbox/retry path for Sheets. Let Auth logout proceed even when logging is temporarily unavailable. Reconcile stale sessions and record a reason/status for automatic closure. Keep the older attendance system separate until ownership and consumers are confirmed, then either secure and maintain it or retire it through a reviewed migration. Put the exact live schema, function source, and Google handler contract under version control, with nonsecret config examples.

## 26. Recommended Repair Order

1. Restrict the live legacy `leave_requests` and `attendance_records` staff write paths and anonymous email lookup after confirming any remaining consumers. These are the clearest authorization/integrity exposures.
2. Obtain the deployed Apps Script source/config safely, test its contract against the recovered Edge Function, and make the DB/Sheet acknowledgment strict and observable.
3. Restore CLI access in a controlled environment, reconcile the unrecorded schema drift, and validate a clean local rebuild without modifying production migration history during investigation.
4. Define one employee provisioning and termination workflow, including Auth revocation, role validation, and reconciliation of the existing Auth-only user and conflicting IDs.
5. Redesign activity closure/retry so a logging outage cannot prevent logout and open sessions can be reconciled; then address network errors, reset redirect settings, password protection, and sample/legacy cleanup.

### Audit limits and verification

Evidence was obtained from repository files, GitHub repository metadata, Supabase project/migration/function listing, retrieved deployed function source, read-only catalog and aggregate SQL, and Supabase security advisors. No login was attempted, no test user created, no production request or destructive exploit was made, and no live Apps Script source or Supabase Auth dashboard settings were available. Therefore runtime success of the Google webhook, self-signup/email verification settings, password reset redirect allowlist, and full session revocation behavior remain unverified. The recovered SQL and TypeScript files were compared to the remote responses; the local migration is a historical artifact, not a verified complete schema dump. All changes in this audit are local artifact recovery and this report.
