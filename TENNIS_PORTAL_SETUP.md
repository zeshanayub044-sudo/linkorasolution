# Tennis Portal setup

This static Linkora site now has a protected employee portal and an Edge Function for activity tracking. The authenticated Edge Function sends activity directly to the Google Apps Script Web App; Apps Script, not Supabase, writes to Google Sheets. It intentionally contains no real credentials.

1. Create a Supabase project and apply the migrations in `supabase/migrations/` in timestamp order.
2. Bootstrap at least one Co-CEO account in Supabase Auth with an email and password, then add its matching `employee_profiles` row using the Auth user UUID, employee ID, name, scheme, role `Co-CEO`, and `is_active = true`. After that, active Co-CEO users can create employees and other Co-CEO users from **User Management** in the portal.
3. The deployed Apps Script Web App owns the `Tennis Portal Logs` sheet. Set the Apps Script project's time zone to `Asia/Karachi`. Its header row must be exactly: `Email | Employee Name | Employee ID | Scheme | Role | Login Date | Login Time | Logout Date | Logout Time | Status | Session ID`. A complete handler is included at `google-apps-script/Code.gs`: paste it into an Apps Script project bound to this spreadsheet, add `GOOGLE_SHEETS_WEBHOOK_SECRET` as a Script Property, and deploy a new Web App version that executes as you and is accessible to anyone.
4. The Apps Script `login` action creates one row using its server-side `Asia/Karachi` date/time and `Logged In` status. Its `logout` action must locate the row by Session ID and update its Logout Date, Logout Time, and Status to `Logged Out`; it must not append a row. It must return JSON with `{ "ok": true }` or `{ "success": true }` only after the sheet write succeeds.
5. Copy `supabase/.env.example` to `supabase/.env`, replace `GOOGLE_SHEETS_WEBHOOK_SECRET` with the exact secret configured in Apps Script, and deploy: `supabase secrets set --env-file supabase/.env`, `supabase functions deploy manage-employee --no-verify-jwt`, and `supabase functions deploy admin-users`. `manage-employee` verifies the bearer token in its own code. `admin-users` also verifies the bearer token and active Co-CEO role before using its server-side service role. The local project has no `supabase/.env`, so these real secrets still need to be set in the deployed Supabase project.
6. Copy `portal-config.example.js` to `portal-config.js`, add the project URL and anon key, and deploy that file with the website. The anon key is public by design; the service-role key and Apps Script webhook secret remain Edge Function secrets.

## Co-CEO admin panel

The login page is the same for every employee. After sign-in, only active profiles whose `role` is exactly `Co-CEO` see the executive admin panel, the latest 200 employee login/logout records, and **User Management**. Employee accounts do not see the panel, and both Edge Functions enforce the Co-CEO check for admin actions.

**User Management** creates Auth accounts with confirmed login email and a temporary password, then creates their employee profile and audit entry. It rejects duplicate login emails and employee IDs, including employee IDs that differ only by case. Admins can edit profiles and email, disable a user with the **Remove** action, or re-enable them through **Edit**. Disabling closes open attendance sessions but keeps all session records. Admin attendance changes require a reason, record the actor and old/new status, and update the existing Google Sheet through the server-side webhook. If the sheet cannot sync after a database change, the admin receives a warning; the database audit remains authoritative. User history and the recent admin activity log are visible only to active Co-CEO accounts.

## Password reset

The portal includes a **Forgot password?** button. In Supabase Dashboard, add the deployed portal URL (for example, `https://linkorasolution.com/tennis-portal.html`) to **Authentication → URL Configuration → Redirect URLs**. This lets the password-reset email return the user to the portal's secure new-password screen.

After updating the portal, deploy both Edge Functions:

```sh
supabase functions deploy manage-employee --no-verify-jwt
supabase functions deploy admin-users
```

The browser never calls Apps Script. The authenticated Edge Functions send the webhook server-side. For normal employee sign-in/sign-out, a failed webhook fails the activity request. For a manual admin change, the database change and audit remain committed and the UI warns if the subsequent sheet sync fails.
