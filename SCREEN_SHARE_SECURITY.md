> Current workflow: [Employee attendance](EMPLOYEE_PORTAL_ATTENDANCE_FLOW.md) and [Employee screen sharing](EMPLOYEE_SCREEN_SHARE.md). Explicit Clock In and 5-second / 15-second defaults supersede the historical workflow below.

# Optional live screen sharing security

## Consent and UI

Attendance does not require sharing. The employee starts sharing from `tennis-portal.html` by clicking **Start Screen Sharing**. That direct user action calls the browser's native `getDisplayMedia` chooser with video enabled and audio disabled. The employee chooses the browser-supported screen/window/tab or cancels. There is no remote start action, webcam/microphone capture, screenshot polling or automatic restart.

After approval, a persistent **SCREEN SHARING ACTIVE** banner shows the selected-surface notice, authorized viewer names and **Stop Sharing**. The browser keeps its own indicator. Choosing Cancel produces no stream or share session and leaves attendance running. Starting/stopping attendance does not require consent to share.

Screen contents are whatever the employee explicitly selects. The app cannot reliably redact password fields or personal information inside a selected surface. Employees should choose a work tab/window and exclude sensitive material. A viewer could use their own external capture tools; this app cannot prevent that. These limitations must be communicated rather than claiming technical prevention.

## Media and signaling

Media is live video over encrypted WebRTC between employee and authorized Co-CEO browsers, optionally relayed by TURN. Video is not uploaded into attendance rows, storage buckets or audit logs. No MediaRecorder, microphone, webcam, data channel, keyboard/mouse injection or remote-control API is implemented.

The new `workforce-live` Edge Function assists signaling using private `admin_private.screen_shares`, `screen_peers` and `screen_signals` tables. RLS is enabled; all client table grants are revoked. Only restricted service-role RPCs can touch signaling. SDP/ICE can contain network addresses and are transient, expiring after two minutes or immediately on peer/share termination. Share/peer metadata remains as an audit reference; it contains no screen frames.

Owner and viewer poll every two seconds while connected, with batched signals and indexed peer lookups. There is no per-employee polling loop in the workforce table. Peers use a generation number so a replaced viewer cannot submit stale answers/candidates. ICE received before SDP is buffered. Signals are restricted to the two participants; offers originate from the owner and answers from the viewer. Request/body, signaling-message and active-viewer limits prevent unbounded signaling growth.

## Authorization and revocation

Every ordinary request verifies the Supabase JWT with Auth. A private SQL lookup then checks that its Auth session exists and has not expired, and the employee profile is active. The workforce-wide list and viewer join require the existing exact `Co-CEO` role. Blog/Careers roles, browser-provided roles, email matching and user_metadata do not grant access.

A viewer must join an existing employee-owned active share attached to an open attendance session. There is no anonymous stream and no ordinary employee viewer. SQL checks owner/session health and active Co-CEO status on every signaling/poll action. Owner polls also prune revoked viewers; the scheduler provides backup cleanup. Auth sign-out closes the local viewer. When checks fail or polling fails, the UI closes media conservatively. Revocation is asynchronous, bounded normally by the two-second participant polling interval; there is no claim of instantaneous remote disconnection.

An owner share lease expires after 120 seconds without owner polling. Viewer leases expire after 30 seconds. At most three management viewers may join a share. New viewer generations clear previous signals. No service-role key or TURN shared secret is sent to a browser.

The sendBeacon close capability grants exactly one tab-close action. It cannot authorize joining, polling, ICE credentials, reading workforce data or capture. The separate Vault maintenance token grants only queue draining and cannot authorize any employee/viewer operation.

## Stopping and lifecycle

Employee **Stop Sharing**, the browser-native stop control, attendance ending, local sign-out and pagehide stop all local MediaStream tracks and PeerConnections. A successful owner stop request ends metadata and deletes transient signals; a lost request is handled by the sharing lease. The viewer displays the end reason and clears its video. Closing a viewer releases only that viewer, not the employee's attendance/share. Closing the employee's sharing tab stops its stream even if another portal tab keeps attendance active. Restoring/refreshing a page never silently reopens capture; the employee must click Start and approve again.

## STUN / TURN infrastructure

Default ICE uses Cloudflare STUN. STUN-only operation may fail on restrictive/symmetric NAT networks. Production cross-network reliability should be verified and a TURN relay configured where required.

The Edge Function supports Coturn TURN REST authentication. Configure only server-side secrets:

- `ATTENDANCE_TURN_URLS`: comma-separated `turn:` / `turns:` URLs, including transport where needed.
- `ATTENDANCE_TURN_SHARED_SECRET`: matches Coturn's protected static auth secret.
- `ATTENDANCE_ICE_POLICY`: `all` (default) or `relay` to require TURN and avoid direct peer ICE paths.

Authorized participants receive short-lived (600-second) HMAC credentials, never the shared secret. Serve TURN with valid TLS, appropriate UDP/TCP relay ports and bandwidth limits. Update these secrets using the authorized Supabase Dashboard/CLI, never frontend code or Git. Reconnect the share/viewer if ICE connectivity needs renewed credentials. Relay-only mode fails closed if TURN is unavailable. No managed TURN account was provisioned by this task; configured production TURN availability remains an operator check.

## Audit and RLS verification

The existing portal audit log receives `screen_share_started`, `screen_share_stopped`, `screen_viewer_joined` and `screen_viewer_left`. Each includes actors/target/time and relevant share, attendance or peer IDs. Database start metadata records the employee action, but it cannot itself prove browser permission; the chooser remains mandatory in the shipped client.

No request/decline notification feature was added; it is optional in the requirement. Cancelling the native chooser does not start a share. No screen content, SDP/ICE payload, password, auth token or TURN credential is written into audit events or request logs.

Passed: seven browser-logic tests including no automatic capture, cancellation, persistent indicator, native track-end cleanup, authorization failure and candidate buffering; six Edge handler security tests; rollback-only database tests of employee viewer rejection, Co-CEO join, signal routing, stale generation denial, role revocation, stop cleanup and private grants. RLS remains enabled and browser roles have no private table access. Real native chooser and two-device live-video/stop tests remain owner acceptance tests. Ordinary authenticated users are denied management by the backend, independent of hidden buttons.

## Live acceptance test

Use separate employee and Co-CEO browser sessions (different browsers/profiles/devices so shared Auth storage does not mix accounts). Never send passwords.

1. Employee signs into `https://linkorasolution.com/tennis-portal.html`; Co-CEO opens `https://linkorasolution.com/attendance-admin.html` → Live Workforce.
2. Before employee approval, management sees NOT SHARING and no View button.
3. Employee clicks Start, cancels native chooser: attendance continues, no View button appears.
4. Employee clicks Start again, explicitly selects a work tab/window. Persistent banner and browser indicator appear.
5. Co-CEO clicks View. Confirm employee name/ID/start/connection status and selected live video; no audio or controls.
6. Employee clicks Stop. Confirm browser indicator disappears and viewer video ends. Repeat with browser-native Stop.
7. Try the admin route/viewer with a normal employee account: backend denies access.
8. Observe refresh/multiple tabs/minimize/offline cases from ATTENDANCE_SESSION_TRACKING.md. Sharing must not restart on refresh.

References: [browser screen chooser](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia), [Supabase Edge authentication](https://supabase.com/docs/guides/functions/auth), [Coturn short-lived authentication](https://github.com/coturn/coturn/wiki/turnserver).
