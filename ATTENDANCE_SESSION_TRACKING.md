> Current workflow: [Employee attendance](EMPLOYEE_PORTAL_ATTENDANCE_FLOW.md) and [Employee screen sharing](EMPLOYEE_SCREEN_SHARE.md). Explicit Clock In and 5-second / 15-second defaults supersede the historical workflow below.

# Attendance browser-session tracking

Supabase `employee_activity_sessions` remains authoritative. Existing monthly, leave, account management and history RPCs remain in use. This feature enrolls a session when the new employee portal connects; it does not bulk close, delete or backdate older untracked sessions.

## Timing and configuration

The singleton `company_settings` row holds constrained server settings:

| Setting | Default | Allowed seconds |
| --- | ---: | ---: |
| attendance_heartbeat_seconds | 30 | 20–60 |
| attendance_disconnect_seconds | 180 | 120–600 |
| attendance_background_seconds | 900 | 300–3600 |
| attendance_close_grace_seconds | 15 | 10–60 |

Change these only through an authorized database administrator. The existing public settings form does not write these fields. Review and record policy changes before altering them. Existing connections adopt a changed heartbeat interval on reconnect; server lease limits use current settings immediately. A secondary tab checks in every two intervals. The Co-CEO workforce table refreshes in one batched request every 15 seconds. The database expiry job runs every 15 seconds. Requests have a 12-second client timeout.

## Identity and session integrity

The existing Supabase Auth client performs password login/restoration. `workforce-live` validates the JWT with Auth, takes the user ID from the verified Auth response, and takes `session_id` from the verified token. A private database lookup requires that Auth session still exists and that the employee profile is active. Browser-supplied user IDs and roles cannot grant access.

Connect/start, heartbeat and expiry serialize on the employee profile. A partial unique index permits one tracked open attendance session per employee. An existing live tracked session, including an overnight session, resumes. Existing untracked prior-day sessions retain the existing “Needs Review” behavior; no logout time is invented. Same-day legacy duplicates are preserved for review rather than deleted. Heartbeats cannot reopen a completed session.

Random client and per-page tab UUIDs support coordination without device fingerprinting. The client UUID uses localStorage when available; server tab leases remain authoritative if browser storage is unavailable. BroadcastChannel and a primary-tab lease reduce redundant work. All open tabs maintain individual server leases. Closing one tab does not close attendance while another lease remains live.

## Refresh, background pages and closing

Visibility changes only update the background lease flag. Blur, tab switching and minimizing do not request logout. Background timer throttling is tolerated for 15 minutes; ordinary background heartbeats keep extending that allowance. Browsers can freeze/discard pages, suspend devices or stop all networking indefinitely. No website can distinguish such a frozen page from a closed device after all signals disappear. Beyond the configured background allowance, the server may estimate a timeout. Do not present this as evidence that the employee stopped working.

`pagehide` attempts a small sendBeacon, falling back to keepalive fetch. It carries a random capability limited to closing that one registered tab. It contains no password or long-lived Auth token. Only its SHA-256 hash is stored privately. The plaintext capability stays in page memory, rotates on reconnect, and grants no read, heartbeat or screen-viewing access.

A close signal starts a cancellable 15-second close grace. Refresh/reopen inside this grace cancels the pending close and resumes the same session. BFcache restoration reconnects too. With no remaining live tab, the scheduler completes the session after the grace (plus up to one job interval). Its logout time is the server receipt time of the final close signal, marked `portal_closed`. A signal alone cannot distinguish navigation from shutdown instantly; the grace intentionally prevents false refresh sign-outs.

If closing cannot reach the server, expiry uses per-tab foreground/background deadlines. Brief network failure does not log out immediately. After three heartbeat intervals without contact, the session may show “Connection Lost”; the configured deadline controls actual termination. Timeout sets:

- `logout_source = system`
- `auto_closed = true`, `estimated_logout = true`
- `disconnect_reason = heartbeat_timeout`
- `logout_at = last_heartbeat_at` (server-observed, bounded by login)
- `closed_at` = the time the server processed expiry

An explicit Sign out uses the original attendance endpoint and actual server time, with `manual_logout`. A stale tab supplies its exact session UUID and cannot close a newer session. Reopening after completion creates a new session; it never overwrites completed history. Auth sign-out remains distinct from attendance timeout.

## Reporting and audit

Live Workforce shows Online, Connection Lost, Signed Out, Auto Closed (estimated), Manual Correction and untracked legacy opens. Attendance History and the Supabase log show last heartbeat and logout type. History CSV includes last heartbeat, source/type and an estimated flag. The ordinary daily/monthly computations retain existing definitions; consult session history when a day includes estimated time.

The existing audit log records starts, tracking enrollment, normal logout, portal close, timeout/auto-close, corrections, sharing and viewer changes. No heartbeat spam is stored as audit events. Existing admin corrections keep their original before/after audit and clear stale estimate labels when correcting a session.

Private lease tables have RLS enabled and no anonymous/authenticated grants. Public presence/workforce RPCs are executable only by the service role behind the authenticated Edge Function. The batched history metadata RPC is callable by authenticated clients but checks active Co-CEO status and a current Auth session before returning anything.

## Scheduled cleanup and Google Sheets

`linkora-portal-session-leases` uses pg_cron and a database-only private function. It does not need an open employee/admin browser or a working Edge endpoint.

Status changes enqueue the existing durable raw-log and matrix queues. Heartbeats do not enqueue spreadsheet writes. A separate minute job invokes the queue worker using a narrow random capability stored in Vault; the private table stores only its hash. The token cannot authorize employee or viewer actions, and the worker is rate-limited to one acceptance per 30 seconds. No service-role key appears in a cron command or public file.

The existing Sheet remains a mirror. Apps Script contract 6 preserves all eleven raw-log columns and UUID idempotency. Normal logout shows “Logged Out”, a close signal shows “Portal Closed”, and a timeout shows “Auto Closed (estimated)”. Matrix snapshots include an estimated label whenever a day includes an estimated session. An existing contract 5 matrix accepts that label, but raw estimated closures stay queued until contract 6 is deployed; they are never silently exported as an ordinary employee logout.

To deploy the prepared script: replace Code.gs in the existing bound Tennis Portal Logs project, save, then Deploy → Manage deployments → edit the existing web-app deployment → New version → Deploy. Preserve the deployment URL and existing script secret. Do not create another Sheet, change headers or send the secret. The scheduled worker retries pending rows after deployment. Apps Script UI deployment was unavailable in this execution environment and still needs this owner step.

## Validation record and operator tests

Passed: repository validation; mocked browser logic for hidden pages, BFcache restore, shared-session tabs, close capability, transient network errors and stopped sessions; Edge handler authorization/validation tests; production database rollback tests for connect/refresh, duplicate prevention, one/final-tab close, five-minute hidden lease, recovery, timeout estimation, reopen, normal logout, spoof rejection and audit. Database expiry jobs were observed succeeding. All synthetic database records and role changes rolled back.

These are logic/backend tests, not a claim that physical browser minimization/shutdown was exercised. Real browser chooser, cross-device WebRTC, actual throttling and restrictive-network TURN remain manual acceptance tests.

| Scenario | Expected manual observation |
| --- | --- |
| Login / normal logout | Live Workforce heartbeat advances; normal completed session |
| Minimize / other tab for several minutes | No sign-out; heartbeat resumes/continues |
| Refresh | Same attendance UUID, no extra sign-in or sign-out |
| Two portal tabs, close one | Remaining tab keeps same session active |
| Close final portal tab | Portal Closed after grace, or estimated timeout if beacon failed |
| Brief offline / online within lease | Same session recovers |
| Foreground offline beyond 180 seconds | Auto Closed; logout is labeled estimated |
| Device shutdown | Eventually estimated expiry, never claimed as manual logout |
| Reopen after expiry | A new session; completed timestamps remain unchanged |

## Deployment artifacts

New migrations: `20261008152858_attendance_presence_leases.sql`, `20261008153056_workforce_screen_sharing.sql`, `20261008153128_attendance_presence_scheduler.sql`, `20261008154952_workforce_signaling_indexes.sql`. Existing migrations are untouched. Edge Functions: new `workforce-live`; existing `manage-employee` shares the queue module and exposes presence report metadata. Other functions and Blog/Careers permissions are unchanged.

Security advisor notes: private RLS tables intentionally have no client policies (default deny). The authenticated metadata SECURITY DEFINER RPC is intentional and enforces active Co-CEO identity. Existing unrelated advisor warnings were not weakened or changed. See [Supabase linter documentation](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

References: [Supabase Cron](https://supabase.com/docs/guides/cron), [background timer throttling](https://developer.chrome.com/blog/timer-throttling-in-chrome-88).
