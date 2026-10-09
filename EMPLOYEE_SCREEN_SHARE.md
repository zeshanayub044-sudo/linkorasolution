> Screen recording upgrade: the optional live-only behavior below applies while recording is disabled. Once an approved Co-CEO enables recording, Clock In requires explicit monitoring acknowledgement and Entire Screen permission; capture is visibly recorded. See [recording architecture](SCREEN_RECORDING_ARCHITECTURE.md), [security](SCREEN_RECORDING_SECURITY.md), [retention](SCREEN_RECORDING_RETENTION.md) and [capacity estimates](SCREEN_RECORDING_STORAGE_ESTIMATE.md) for the current enabled workflow.

# Employee screen sharing

CLOCK IN directly invokes getDisplayMedia while the click retains transient activation, alongside authenticated attendance creation. Awaiting Auth/network first can lose activation, so the chooser may appear before the database response. WebRTC authorization begins only after successful Clock In. Failed/cancelled/logout/unload flows stop pending approved streams.

Employee approval remains mandatory. Entire Screen is recommended by UI text and displaySurface preference, never forced/silently selected. Tab/window choice remains under browser control. Video is enabled, audio is false. No webcam, microphone, recording/storage, screenshot loop, keystroke/clipboard capture, remote control or screen frames in database rows are added.

Approval shows a persistent sharing banner/Stop Sharing and native browser indicators. Authorized Co-CEOs see only the selected live surface. Employees must choose suitable work content: arbitrary desktop content cannot be redacted reliably; external viewer recording cannot be prevented by this app.

Denial/unsupported capture leaves attendance valid and records requested/declined/unsupported state. Native Stop Sharing or portal Stop terminates tracks/peers/signaling. Re-enable Screen Sharing requires a fresh click and approval. Reload never silently recaptures. Another actively sharing tab remains authoritative so one tab cannot overwrite active status with its denial.

The existing encrypted WebRTC and private authenticated signaling remain. Every live request checks verified JWT/current Auth session/active profile; owner actions check attendance ownership. Only exact active Co-CEO role can view. Blog/Careers roles and ordinary employees cannot view. Participant/generation checks, expiry and cleanup remain. STUN is configured; restrictive networks may require separately configured TURN with short-lived participant credentials.

Automated mocks and rollback SQL cover consent states, cleanup and viewer authorization. Physical Entire Screen selection, Co-CEO playback, cross-network connectivity and native stop/denial remain acceptance checks because browser-control initialization fails in this environment.

References: [native chooser/activation](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia), [Chrome background timers](https://developer.chrome.com/blog/timer-throttling-in-chrome-88/).
