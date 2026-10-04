# Blog CMS security and launch audit

## Verified controls

- Blog roles come only from `public.blog_editors`, which has RLS enabled and no browser grants. The public `blog_current_role()` RPC reports only the caller's role.
- Public and ordinary authenticated readers see only published post rows; drafts are hidden by RLS. Public-safe author records contain no email.
- Anonymous readers have no Blog post insert, update or delete privilege. Editors cannot directly change `author_id`, `view_count` or timestamps; they cannot modify another author's post or delete their own published post. Blog Admin cross-author changes are restricted to Blog tables.
- `blog_record_view(text)` is the sole anonymous write path. It validates a slug and increments only a published row by one. Invalid or draft slugs return null. It has an empty search path and narrow EXECUTE grants.
- Blog image uploads require an active Blog role and a path under the uploader's Auth UUID. The dedicated bucket restricts type and size. No service-role key is shipped to the browser.
- Article content is stored as plain text and rendered with `textContent`; no stored HTML is executed. Slugs, content lengths, status, image prefix and canonical URL are checked in the database.
- The migrations do not touch employee/Tennis tables or their policies.

## Live RLS checks

The following were exercised against project `nbvylffxmjmovyfhbytu` in transactions ending with `ROLLBACK`:

| Scenario | Result |
| --- | --- |
| Anonymous reader with one published and one draft fixture | 1 visible, 0 drafts; no direct write privilege |
| Anonymous view RPC on published/draft/invalid slug | 1 / null / null |
| Auth user without Blog role | Role null, 1 visible, 0 drafts, insert denied |
| Blog Editor | Own draft created and published; another author's edit and own published-post delete denied |
| Blog Admin | Another author's draft edited and deleted |
| Workflow constraints | Partial draft saved; duplicate slug rejected; original publication date preserved; direct view-count update denied |
| Image policy | Editor's own UUID path insert allowed; another UUID path insert denied |
| After all rollback tests | 0 posts, 0 authors, 0 role assignments |

The Supabase security advisor reports `blog_editors` as “RLS enabled, no policy” (intentional: browsers have no direct access) and the anonymous `blog_record_view` SECURITY DEFINER RPC (intentional, constrained). Its other findings concern pre-existing Tennis/Auth objects or project password settings and were left untouched. See the [database linter](https://supabase.com/docs/guides/database/database-linter), [RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security), and [Storage access guidance](https://supabase.com/docs/guides/storage/security/access-control).

## Remaining limitations and recommendations

- **First account:** No Blog Admin role or public article has been assigned yet. Complete the setup guide with the owner's chosen Auth email, then test actual sign-in, image upload and publishing through the browser.
- **SEO rendering:** Article metadata and JSON-LD are set in client JavaScript after fetching Supabase data. Crawlers and social preview bots that do not run JavaScript may see the generic page metadata. For dependable per-post previews and indexing at scale, add a server-rendered/edge-rendered route and a generated article sitemap.
- **View accuracy:** Session storage reduces repeated refresh counts in one browser session, but anonymous callers can still invoke the public RPC repeatedly. For abuse resistance, put a rate-limited edge endpoint in front of the counter or aggregate server logs.
- **Image privacy:** The bucket is public so a draft image is reachable by anyone who learns its URL. Avoid uploading confidential draft art. Unlinking an image does not remove the Storage object; schedule cleanup for unused files.
- **Search scale:** The listing fetches published summaries in pages of 200 and filters them in the browser. If the article set grows large, move search/filter and pagination to indexed server queries.
- **Content formatting:** The safe plain-text renderer supports headings and bullet lists, but not rich HTML, inline links or media embeds. Add a vetted Markdown renderer with sanitization if those become requirements.
- **No seeded copy:** The Blog starts empty. Publish real content through the editor rather than shipping placeholder articles.
