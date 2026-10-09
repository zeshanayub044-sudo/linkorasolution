# Employee Portal attendance flow

Portal authentication and attendance are separate. Login validates Supabase Auth and the active employee profile, records portal_login and restores only an already-open session. No open session means NOT CLOCKED IN, no heartbeat and no capture. Legacy tennis-portal.html URLs and internal database/RPC names remain compatible.

## Clock In and Clock Out

Only CLOCK IN invokes workforce-live clock-in. Validated JWT and current Auth session determine identity. Browser times/roles/IDs are not trusted authorization. The existing profile lock and tracked-session unique index serialize server-time get-or-create; ambiguous retries and other tabs reuse active attendance. connect is restore-only and never creates a session.

CLOCK OUT ends the exact owned session, retains Auth login, stops heartbeat/capture/peers/signaling and enqueues existing durable Sheet mirrors. Account Sign out is separate and closes known active attendance before signing out. Other tabs observe closure on their next heartbeat. Existing manual and historical records remain intact.

## Lease policy

company_settings defaults: heartbeat 5 seconds; foreground/background disconnect 15 seconds; all-tabs-closed grace 15 seconds. Every live tab renews its own lease and session heartbeat using server time. Per-heartbeat checks touch only that employee. The database scheduler runs every second. Nominal expiry is 15 seconds after last server contact, plus scheduler/lock/load latency; not an exact guarantee.

pagehide sends a best-effort, close-only capability for its registered tab. Per-tab notification also ends that tab's sharing. It cannot read data/extend leases or close attendance while another tab remains live. BroadcastChannel assists handoff; server leases decide correctness. No client request is required for crash, sleep, lid close, power loss or network loss.

Minimize, tab switching, another application, visibility hidden and blur do not clock out. Visibility changes only renew heartbeat. However, browser/OS suspension may stop JavaScript even in a minimized window. It is indistinguishable from sleep to this lease, so the requested strict 15-second policy may close frozen/minimized pages. The system cannot guarantee unlimited frozen-background attendance and 15-second sleep detection simultaneously. No hidden audio, synthetic media or permission bypass is used.

Refresh restores an existing session inside its lease; it creates no new attendance. Capture cannot silently survive reload: Re-enable Screen Sharing needs fresh approval. Reconnect before expiry resumes. Reconnect after expiry shows the previous closure plus CLOCK IN; it never reopens completed history.

New automatic closures use server closure time for logout_at/closed_at, retain last_heartbeat_at, set auto_closed=true, estimated_logout=false, logout_source=system, and reason heartbeat_timeout or portal_closed. Older estimated records keep their original semantics. Manual Clock Out retains the existing manual_logout/user metadata.

## Sheets, audit and security

Supabase is authoritative. Raw/matrix queues survive Sheet/network errors. Eleven raw columns and historical Tennis Portal Logs sheet name remain intact. Apps Script contract 7 labels server-time closures Auto Closed / Automatic; older estimated closures keep their label. Raw automatic sync waits safely until contract 7 is deployed. Matrix output marks automatic closures; no heartbeat writes a Sheet row. Manual logout keeps Logged Out compatibility.

Existing attendance_session_started means Clock In; attendance_session_normal_logout means manual Clock Out; attendance_session_auto_closed means automatic Clock Out. Audit also records portal_login, connection_recovered, heartbeat_timeout and sharing/request/decline/state/viewer events. Actor/employee/session IDs and server timestamps are retained, never screen contents or credentials.

RLS and private signaling grants remain unchanged. Employees operate only their own attendance. Management/viewing requires an existing active Co-CEO employee profile/current Auth session. Blog/Careers permissions and editable user_metadata do not grant access.

## Verification and remaining physical checks

Automated browser-logic tests cover empty restoration, explicit Clock In, five-second configuration, restored/multiple tabs, hidden visibility without closure, outage/expiry, chooser mocks, denial audit, pending-capture cancellation, stop and ICE ordering. Rollback-only production SQL verifies duplicate prevention, refresh, two tabs, close one/final close, recent hidden lease, recovery, 15-second expiry with server closure time, ownership, Co-CEO gating/revocation, signaling cleanup and private grants. All test changes roll back.

These are not physical browser tests. Required real-device checks: login without attendance; Entire Screen approval; denial; Co-CEO playback; minimize >15 seconds and >5 minutes; tab/app switching; two tabs/close one/final close; refresh; offline shorter/longer than 15 seconds; sleep/lid/crash; reconnect; manual Clock Out retaining login. Measure last_heartbeat_at, close notification and closed_at separately, recording browser/OS. Browser-control initialization currently fails; actual device auto-close timing and these acceptance tests remain unverified.

Apps Script: copy google-apps-script/Code.gs into the existing bound project and redeploy its existing web-app deployment as a new version. Preserve its URL, Sheet, properties and secret. Do not create a replacement deployment.

Measured production scheduler cadence on 2026-10-09: 1.015–1.331 seconds between starts; average tick execution 0.014 seconds over a one-minute sample with no active tracked employees. This measures scheduler operation only, not actual sleep/browser auto-close or loaded production scale. Existing 56 attendance records were verified unchanged by a hash of all pre-existing fields after rollback tests.

Restoration excludes prior-day untracked rows; only tracked or current-day open attendance resumes. Explicit Clock In alone invokes existing stale-review handling. Deployment migrations: 20261009095818_employee_portal_clock_in, 20261009100419_employee_portal_clock_out and 20261009101432_employee_portal_restore_current_session. workforce-live version 2 and manage-employee version 31 are deployed.
