# Tennis Portal setup

This static Linkora site now has a protected employee portal and an Edge Function for activity tracking. The authenticated Edge Function sends activity directly to the Google Apps Script Web App; Apps Script, not Supabase, writes to Google Sheets. It intentionally contains no real credentials.

1. Create a Supabase project and apply `supabase/migrations/20260912000000_tennis_portal.sql`.
2. In Supabase Auth, create each employee with an email and password. Add a matching `employee_profiles` row using the Auth user UUID, employee ID, name, scheme, role, and `is_active = true`. Give each of the two co-CEO accounts the role `Co-CEO` so they can see the executive admin panel after signing in.
3. The deployed Apps Script Web App owns the `Tennis Portal Logs` sheet. Set the Apps Script project's time zone to `Asia/Karachi`. Its header row must be exactly: `Email | Employee Name | Employee ID | Scheme | Role | Login Date | Login Time | Logout Date | Logout Time | Status | Session ID`. A complete handler is included at `google-apps-script/Code.gs`: paste it into an Apps Script project bound to this spreadsheet, add `GOOGLE_SHEETS_WEBHOOK_SECRET` as a Script Property, and deploy a new Web App version that executes as you and is accessible to anyone.
4. The Apps Script `login` action creates one row using its server-side `Asia/Karachi` date/time and `Logged In` status. Its `logout` action must locate the row by Session ID and update its Logout Date, Logout Time, and Status to `Logged Out`; it must not append a row. It must return JSON with `{ "ok": true }` or `{ "success": true }` only after the sheet write succeeds.
5. Copy `supabase/.env.example` to `supabase/.env`, replace `GOOGLE_SHEETS_WEBHOOK_SECRET` with the exact secret configured in Apps Script, and deploy: `supabase secrets set --env-file supabase/.env` then `supabase functions deploy manage-employee --no-verify-jwt`. JWT verification is implemented inside the function so it can return an appropriate browser response. The local project has no `supabase/.env`, so these real secrets still need to be set in the deployed Supabase project.
6. Copy `portal-config.example.js` to `portal-config.js`, add the project URL and anon key, and deploy that file with the website. The anon key is public by design; the service-role key and Apps Script webhook secret remain Edge Function secrets.

## Co-CEO admin panel

The login page is the same for every employee. After sign-in, only active profiles whose `role` is exactly `Co-CEO` see the executive admin panel and the latest 200 employee login/logout records. Employee accounts do not see the panel, and the Edge Function refuses report requests from them.

The browser never calls Apps Script. The authenticated Edge Function sends the webhook server-side. A failed or rejected webhook now fails the sign-in/sign-out request, so the portal never claims a sheet entry was recorded when it was not.
