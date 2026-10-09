# Screen recording retention

Video access expires 90 days from server recording start, including after an interrupted session is resumed. Resume cannot extend this deadline. Retention is fixed at 90 days; normal attendance has separate retention and is never deleted by this worker.

The SQL migration schedules `linkora-screen-recording-retention` once per minute. Cron reads an encrypted Vault capability, never a browser credential or hard-coded secret. The Edge Function hashes/validates it through the existing scoped maintenance authorization and runs the service-only recording maintenance RPC. Existing one-second attendance lease cleanup is retained and additionally closes abandoned recording-owner leases.

## Deletion sequence

1. New playback authorization refuses records at/after their retention deadline. A confirmed Co-CEO deletion sets `deleting` and blocks new access immediately. Live attendance must end before deletion is allowed.
2. Maintenance reconciles reserved objects whose upload succeeded but client commit was lost; it marks stale owners interrupted and old pending reservations missing.
3. It selects up to 20 expired/deleting logical recordings per run. Object paths are derived server-side from the exact UUID/date prefix and actual Storage object inventory, not arbitrary browser input. This includes any physical object under the recording prefix even if its segment commit was lost.
4. Edge calls the real Storage `remove` API in batches of 100, bounded to 1,000 objects or 45 seconds per invocation. Larger recordings remain queued for the next minute; already removed objects disappear from the next candidate inventory. It never directly deletes `storage.objects` SQL rows as a substitute for physical removal.
5. Only after the Storage API succeeds does the server verify that no object remains under that prefix. Then segment statuses become deleted and the logical record becomes expired/deleted. Failure leaves a retryable state for the next scheduled run. Minimal employee/attendance link, times, counts and audit metadata remain; no signed URL or video bytes are retained in metadata.

No new playback URL is issued after expiry. Existing signed URLs live for at most 300 seconds and are capped by remaining retention (one-second granularity). A trusted viewer can retain already downloaded/cached bytes; this is not DRM or guaranteed remote deletion. The open UI rechecks every 15 seconds and clears video upon denied identity/deletion/expiry. Routine object deletion is eventual: outages, quota, worker limits or Storage failure can delay physical cleanup. The admin capacity summary shows overdue cleanup; do not claim that a scheduler failure still removed files exactly at the deadline.

## Operator checks

Use Screen Recordings metrics to check oldest recording, expiring within seven days, storage, and overdue cleanup. Check cron run status plus `net._http_response` for recent worker 202 responses; 202 means queued, not proof of object deletion. Check function logs for the safe generic retry notice and query expired/deleted records versus actual Storage prefix inventory. Alert/repair if overdue cleanup remains beyond successive minute runs. Never print the Vault capability or service key.

Database rollback tests prove access cutoff, candidate selection and refusal to mark an object deleted while it still exists. Mock Edge tests prove physical API invocation before metadata verification, with failures leaving retries. End-to-end physical Storage expiry/removal with a real consented video remains an operator acceptance test before activation; use the same worker and disposable content, not deletion of production attendance or rewriting a deployed migration.

Disabling recording stops new recorded Clock In requirements; it does not disable retention or delete old attendance. Emergency response: disable new starts in the admin policy, have active employees stop/Clock Out, keep retention running, investigate preserved audit events. Fix future migrations additively; never reset production or replay prior migration history.
