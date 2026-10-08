# Tennis Portal Google Sheets mirror

Supabase `employee_activity_sessions` is authoritative. The bound Apps Script mirrors session changes into the existing `Tennis Portal Logs` tab and date snapshots into a new `Attendance Matrix` tab. The Sheet is never required for employee attendance success. See [ATTENDANCE_GOOGLE_SHEET_SPEC.md](ATTENDANCE_GOOGLE_SHEET_SPEC.md) for the exact columns and status rules.

`doPost()` requires the existing `GOOGLE_SHEETS_WEBHOOK_SECRET` Script Property. Actions are `capabilities` (contract version 5), `login`, `logout`, `report` (legacy raw read) and `matrix-day`. `doGet()` remains a health check. The Edge Function supplies canonical Supabase timestamps and the configured company timezone. Raw deliveries are idempotent by session UUID; matrix deliveries are idempotent by company date plus employee UUID. Apps Script uses `LockService` during writes. No secret belongs in this repository, the Sheet or browser code.

Update the **existing** bound Apps Script project from `google-apps-script/Code.gs`; create a new version of its existing web-app deployment and keep its URL. Then deploy `manage-employee` with the existing Edge secrets. Use Attendance Admin → Settings to retry pending deliveries and rebuild selected matrix dates from Supabase. Preserve the raw tab and all historical rows.
