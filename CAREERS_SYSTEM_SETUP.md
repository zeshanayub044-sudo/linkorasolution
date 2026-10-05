# Careers system setup

## Architecture

The static website uses `careers.html` for open roles and `career-job.html?slug=...` for an open role and its application form. Both use the existing Supabase project through a browser-safe publishable key. `careers-admin.html` uses the same Supabase Auth accounts as the site, but checks a dedicated Careers Admin role in the database before loading private data. The Tennis and Blog role tables are separate and unchanged.

Candidate submissions go to the public `career-apply` Edge Function. It validates form fields, consent, an open job, CV type and size, uploads the CV to private Storage with a server-side key, and invokes a service-role-only RPC that rechecks the job and creates the application. A unique `(job_id, email)` constraint stops repeat applications to the same job. The function removes an upload if the database write fails and preserves it if a committed write cannot be confirmed after a network error.

## Database schema

Migration: `supabase/migrations/20261004193618_careers_system.sql` (generated initially with `npx supabase migration new careers_system`; filename aligned to the version recorded by the live migration tool).

- `public.career_jobs`: role content, status (`draft`, `open`, `closed`, `archived`), publication and closing times, author and timestamps. Slugs are unique. Publishing requires summary, description, responsibilities and requirements.
- `public.career_applications`: private candidate details, consent timestamp, private `resume_path`, constrained status (`new`, `reviewing`, `shortlisted`, `interview`, `offered`, `hired`, `rejected`), private notes and timestamps. One email can apply once per job.
- `public.career_admins`: dedicated `careers_admin` membership keyed to `auth.users.id`; inactive entries lose access.
- `public.career_current_role()`: a signed-in user's Careers role. `public.career_submit_application(...)`: server-only open-job/consent validation and insert.

## Storage and authorization

The `career-resumes` bucket is private, limited to 8 MB and PDF, DOC or DOCX MIME types. The browser never receives a secret/service-role key. Candidates send their CV only to the Edge Function. Careers Admins can request a 60-second signed CV URL from the admin panel; the panel removes its link on close. The bucket cannot be browsed publicly. A dedicated RLS policy allows authenticated, active Careers Admins to select resume objects. Candidate text is rendered with DOM text nodes, not HTML.

The public can read only currently open jobs; authenticated non-admins gain no extra jobs or candidate access. Only Careers Admins can create/edit jobs, read applications, or update application status and notes. Candidate fields, notes, role mappings and uploads cannot be written directly from anonymous browsers. Admin deletion is limited to draft jobs without applications; close/archive previously published jobs to retain application history.

## First admin and future admins

The first admin was assigned live to the existing Supabase Auth account supplied by the owner on 2026-10-04. The grant was operational data, intentionally omitted from the migration so credentials/identities are not hardcoded in source. To add another admin, a trusted project owner can run this in the Supabase SQL Editor after the person has an Auth account:

```sql
insert into public.career_admins (user_id, role, is_active)
select id, 'careers_admin', true
from auth.users where lower(email) = lower('OWNER_SUPPLIED_EMAIL')
on conflict (user_id) do update set role = excluded.role, is_active = true;
```

This SQL must be run only from the trusted SQL Editor or a backend with a server key. Do not run it in browser code. Deactivate with `update public.career_admins set is_active = false where user_id = ...`.

## Operating the system

1. Open `careers-admin.html`, sign in with the approved Supabase Auth account, and choose **Add job**.
2. Fill in the job information. Save as **Draft** or choose **Open** to publish. The public listing updates from Supabase; no HTML editing is needed.
3. Edit a job to change details, or use **Close** to stop applications. Closing date also hides an expired open job and the submission RPC rejects it. A closed job can be republished after adjusting its closing date.
4. Applicants appear newest first. Filter by job, status, date or name/email. Open one to see all submitted details and a short-lived CV link. Update status and internal notes with **Save review**. Notes never appear publicly.
5. A candidate opens an open role, completes the application and consents to recruitment processing. A success message appears after the private CV upload and database write complete. A repeat application for the same job/email receives a duplicate message.

## Deployment

1. Merge the stacked PRs in order (branding, Blog CMS, then Careers), or deploy a branch containing their combined code. The website is static; publish the HTML/CSS/JS/assets at the site root.
2. Apply `supabase/migrations/20261004193618_careers_system.sql` to the matching Supabase project. It was applied to `nbvylffxmjmovyfhbytu` on 2026-10-04; do not apply it twice or reset production.
3. Deploy `supabase/functions/career-apply/index.ts` as `career-apply` with JWT verification disabled because candidates are public. This was deployed to that project on 2026-10-04. Its code handles only a constrained public POST and permits CORS from the production domains and local test origins.
4. The function uses Supabase's server-provided `SUPABASE_URL` and `SUPABASE_SECRET_KEYS.default` or the legacy `SUPABASE_SERVICE_ROLE_KEY`; never put either key in website files. Confirm these are available in the function environment.
5. Grant the owner an Auth account and the dedicated Careers role as above. The supplied owner's existing account is already active in the live project.
6. If deploying on a different domain, update the allowed origin list in the function and redeploy. Update `careers-config.js` only if the Supabase project or publishable key changes.

## Test checklist

- Sign in as the approved Careers Admin. Create a draft, verify it is absent publicly, publish it, edit it, then close it and verify it disappears publicly.
- Apply to an open test job with a real PDF/DOC/DOCX CV and a unique test email. Check success, private bucket object, candidate detail, signed CV link, status/notes save and duplicate rejection. Remove test records and private file afterward with trusted admin access.
- Verify an anonymous visitor and an unrelated signed-in Auth user cannot read applications, list/download CVs, edit jobs, call the submission RPC directly, or grant Careers roles.
- Verify the Edge Function rejects closed/expired jobs, oversize/wrong-type CVs, invalid fields and missing consent. Verify mobile navigation, form, admin tables and dialog.

## Files

New: `careers.html`, `career-job.html`, `careers-admin.html`, `careers.css`, `careers-config.js`, `careers-common.js`, `careers-list.js`, `career-job.js`, `careers-admin.js`, the migration and `supabase/functions/career-apply/index.ts`.

Modified: public `index.html`, `about.html`, `services.html`, `blog.html`, `blog-post.html`, `contact.html`, `script.js`, `styles.css` and `sitemap.xml`. The public header and both static/dynamic footers link to Careers.
