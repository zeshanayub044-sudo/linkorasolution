# Careers security audit — 2026-10-04

## Verified in the live Supabase project

- The Careers migration is recorded as `20261004193618_careers_system`; the `career-apply` Edge Function is active, version 2, with JWT verification off for the public candidate route.
- The first owner's existing Auth account has one active `careers_admin` mapping. A simulated unrelated signed-in user received a null Careers role and no draft jobs.
- `career_jobs`, `career_applications` and `career_admins` have RLS enabled. Only open jobs were visible under the anonymous role in a rollback test (`1` open, `0` draft). An authenticated Careers Admin created and published a job in a rollback test; publication time was set.
- The application RPC accepted a valid open test job under `service_role`; an admin changed its status and private notes. A closed test job was rejected with SQLSTATE `22023`. All test job/application rows were rolled back and a follow-up query found zero remaining.
- `career-resumes` reports `public = false`. Anonymous users lack `SELECT` and `INSERT` on applications and cannot execute the submission RPC. Signed-in users cannot insert Careers Admin role rows. The private Storage SELECT policy requires active Careers Admin membership; no anonymous Storage policy exists for this bucket.
- The browser code contains only the publishable key. The secret/service-role key is read inside the Edge Function. Candidate fields are displayed using `textContent`. Resume links are signed for 60 seconds.
- Supabase security advisors reported no new Careers high-severity findings. The `career_admins` “RLS enabled, no policy” info item is intentional: direct client access to role mappings is denied. Existing Blog/Tennis/Auth advisories are unrelated to this feature and remain outside this change.

## Remaining live-browser checks

The static Careers pages have not yet been deployed to the production website. A full browser sign-in and end-to-end CV upload/application cannot be verified until the branch is published. The database-level submission, RLS and closed-job paths were tested transactionally without retaining candidate data. After deployment, follow the test checklist in `CAREERS_SYSTEM_SETUP.md` with a disposable role and candidate email, then remove the test data and CV through trusted admin access.

## Operational risks and mitigations

- The public function accepts anonymous applications. Its field/size/file-signature validation, honeypot and unique job/email rule reduce accidental and basic automated abuse; high-volume spam may still require CAPTCHA or a gateway rate limit. The code has a single public endpoint where that control can be added.
- File-signature checks identify common PDF, legacy DOC and DOCX containers but are not antivirus scanning. Do not treat candidate files as trusted; use the browser's safe-download handling and consider malware scanning as volume grows.
- Signed resume links can be used by anyone who obtains them until their 60-second expiry. Admins should avoid sharing them. Revoking a Careers Admin role prevents creating new links; an already issued link lives until expiry.
- The application table preserves candidate data indefinitely. Decide and document a recruitment retention/deletion policy before collecting production applications.
- Supabase advisors also flagged pre-existing password protection and older Blog/Tennis routines. See [Supabase's password security guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) and [database linter](https://supabase.com/docs/guides/database/database-linter) for those separate follow-ups.
