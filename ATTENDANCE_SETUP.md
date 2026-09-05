# Linkora Attendance Portal setup

1. In Supabase SQL Editor, run `supabase-attendance-setup.sql` in full.
2. Run `supabase/make-existing-admin.sql`, adjusting the email and profile details if needed. This promotes an existing Auth user; it never creates a plaintext administrator password.
3. Deploy the administrator-only function:

   ```sh
   supabase functions deploy manage-employee
   ```

   Supabase automatically provides `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to deployed Edge Functions. Do not place the service-role key in the website.
4. Deploy the static site normally. The browser uses only the Supabase publishable key in `attendance.js`.
5. Sign in as the promoted administrator, open **Employees**, and create employee accounts. The supplied temporary password is sent only to Supabase Auth and is never written to the profiles table or browser storage.

## Verification

- An employee can sign in, check in exactly once, refresh, and check out exactly once.
- A duplicate check-in, check-out without an open day, weekend check-in, and check-in during approved leave are rejected by PostgreSQL.
- Employees can only read their own profile, attendance, and leave records through RLS.
- An administrator can create accounts, reset passwords, approve leave, export CSV, configure timezone/late rule, and correct attendance with an audit entry.
- Test the Edge Function after deployment by creating one employee. A `Failed request to Edge Function` response means the function has not been deployed to the same Supabase project, is missing its managed service-role secret, or the caller is not an active admin profile.
