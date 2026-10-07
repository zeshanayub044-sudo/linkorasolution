# Tennis Portal Google Sheets attendance

The active attendance log is the **Tennis Portal Logs** tab in the existing Google Sheet. Its bound Apps Script project handles employee login/logout writes and Co-CEO report reads. Do not create a new Sheet or use the older `attendance.html` / `activity-config.js` route; `attendance.html` redirects to `tennis-portal.html`.

The current flow is Supabase Auth → `manage-employee` (active-profile check) → session RPC (concurrency and audit support) → authenticated Apps Script `doPost()` → Google Sheet. The portal reports a successful employee sign-in or sign-out only after the Sheet confirms the write. The Co-CEO report in the portal and the Google Sheets attendance log in `attendance-admin.html` read this same Sheet through `manage-employee`. Other established admin analytics still use the Supabase session tables; those records are retained for compatibility and history.

## Existing Sheet contract

Tab: `Tennis Portal Logs`

Columns, in order: `Email`, `Employee Name`, `Employee ID`, `Scheme`, `Role`, `Login Date`, `Login Time`, `Logout Date`, `Logout Time`, `Status`, `Session ID`.

Dates and times use `Asia/Karachi`. The script checks these headers before reading or writing. It deduplicates by Session ID, updates the original row on sign-out, and can recover a missing login row using its original login timestamp. It never rewrites existing historical rows during deployment.

The Apps Script web app keeps its existing deployment ID when a new version is deployed. `doGet()` is a health check that returns no attendance data. `doPost()` requires the existing `GOOGLE_SHEETS_WEBHOOK_SECRET` Script Property for `login`, `logout`, and `report`. The matching secret and `GOOGLE_APPS_SCRIPT_URL` belong only in Supabase Edge Function secrets. Never put the secret or a service-role key in website files, this document, or a migration.

## Updating the existing deployment

1. Open the Apps Script project bound to the existing spreadsheet. Confirm the `Tennis Portal Logs` tab and its eleven headers.
2. Update `Code.gs` from `google-apps-script/Code.gs` and save.
3. Choose **Deploy → Manage deployments**, edit the active web app, select **New version**, and deploy. Keep the same deployment ID and access settings. The current production deployment is Version 4 (7 October 2026).
4. Confirm the configured Edge Function URL still points to that deployment. Deploy `supabase/functions/manage-employee/index.ts` with its existing custom bearer verification setting (`verify_jwt=false`); the function itself checks Supabase Auth and the active Co-CEO role before allowing reports.
5. Test an employee sign-in/sign-out, then check the Sheet row and both Co-CEO report views. A backend failure must show an error, not an empty-record message.

The existing `attendance_sheet_sync_queue` is a retry safety net for interrupted deliveries and admin attendance changes. Use Admin → Settings → **Retry pending sync** for any queued rows; its writes are idempotent by Session ID.
