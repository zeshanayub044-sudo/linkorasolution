# LINKORA Blog CMS setup

## Architecture

The public static site uses `blog.html` and `blog-post.html?slug=...` to read published content from the existing Supabase project. `blog-admin.html` uses Supabase Auth for editorial work. It has a separate browser session key and a separate database role table from the Tennis Portal. Articles live in Postgres, images in the dedicated `blog-images` Storage bucket. The browser contains only a publishable key in `blog-config.js`; no service-role credentials are used.

The two additive migrations were generated with `npx supabase migration new` and applied to project `nbvylffxmjmovyfhbytu`:

- `supabase/migrations/20261004183027_blog_cms.sql`
- `supabase/migrations/20261004183909_blog_read_policy.sql`

The CLI generated both migration files; the files were then named to match the versions recorded by the live project's migration service. They do not modify Tennis Portal tables, functions, roles, or policies. Keep the existing Tennis migrations when reconciling repository branches before a future `supabase db push`; the live project already has those migrations.

## Tables and roles

`blog_posts` stores slug, title, excerpt, plain-text content, status, dates, view count, image URL, category and SEO fields. `reading_minutes` is a generated estimate. `blog_authors` contains public display details only; no author email is exposed. `blog_editors` is the private, server-controlled authorization table with `blog_admin` and `blog_editor` roles and an `is_active` flag.

Anonymous users can read only published posts and public author details. Signed-in users without an active Blog role get the same post visibility and cannot write. Editors can create posts as themselves, edit/publish their own posts and delete their own drafts. Blog Admins can edit/delete any Blog post. Neither role grants any extra Tennis access. `author_id`, `view_count`, timestamps and role rows cannot be written directly by the browser. The database trigger sets `published_at` the first time a post publishes and preserves that original date on later edits or republishing. Column grants and RLS enforce these rules server-side.

## Create the first Blog Admin

Create or select an existing **Supabase Auth** email/password user in this project. The user must confirm the email according to the project's Auth settings. In the project's SQL Editor, as a trusted database owner, run the following after replacing the email and display name. Do not put this SQL or any password in the browser:

```sql
begin;
do $$
begin
  if not exists (select 1 from auth.users where lower(email) = lower('ADMIN_EMAIL_HERE')) then
    raise exception 'Auth user does not exist';
  end if;
end $$;
insert into public.blog_authors (id, display_name, title)
select id, 'DISPLAY NAME HERE', 'Blog Admin'
from auth.users where lower(email) = lower('ADMIN_EMAIL_HERE')
on conflict (id) do update set display_name = excluded.display_name, title = excluded.title;
insert into public.blog_editors (user_id, role, is_active)
select id, 'blog_admin', true
from auth.users where lower(email) = lower('ADMIN_EMAIL_HERE')
on conflict (user_id) do update set role = excluded.role, is_active = true;
commit;
```

For a Blog Editor, use the same procedure with a different Auth user and `role = 'blog_editor'`. Only a trusted database owner should change this table. To revoke Blog access, set `is_active = false`; the Auth account and Tennis access remain separate. Confirm the assigned user with a trusted SQL query or by signing into `blog-admin.html` and checking the role label.

## Editorial workflow

1. Open `blog-admin.html`, sign in with the approved Auth account, and choose **New article**.
2. Enter title, excerpt, category and content. The slug is suggested from the title and can be edited. It must remain unique; duplicate slugs show an error.
3. Write plain text. Blank lines separate sections; `#`, `##` and `###` start headings, and `-` starts list items. The preview uses the same safe renderer as the public page.
4. Optionally upload a JPEG, PNG, WebP or AVIF image (maximum 5 MB). The file goes under the uploader's Auth UUID in `blog-images`. Optional SEO title/description fall back to title/excerpt; use a canonical URL only for intentional canonicalization.
5. Save as **Draft** or select **Published** and save. The list also offers Publish/Unpublish, Edit, View and permitted Delete actions. Deletion asks for confirmation.
6. Published posts appear automatically on `blog.html`. Each links to `blog-post.html?slug=...`.

The bucket and its upload/delete policies are created by the first migration. Browser uploads use the user's Auth session. Removing a featured image from a post unlinks it; it does not delete the Storage object. Review unused objects periodically in the Supabase dashboard.

## Views and search

The public detail page calls the constrained `blog_record_view(slug)` RPC once per post per browser session. It increments only a published post. Anonymous users cannot update `view_count` directly. Public search checks title, excerpt and category across the published posts fetched for the listing; the category dropdown filters that set.

## Files

- Modified: `blog.html`.
- Added: `blog-post.html`, `blog-admin.html`, `blog.css`, `blog-config.js`, `blog-common.js`, `blog-list.js`, `blog-post.js`, `blog-admin.js`, the two Blog migrations, this setup guide and `BLOG_CMS_AUDIT.md`.

## Verification performed

The migrations were applied to the existing project. Rollback-only live database tests confirmed anonymous draft isolation and lack of writes, unauthorized authenticated-user denial, editor own-post creation/publishing with cross-author modification denied, Blog Admin cross-author edit/delete, partial drafts, duplicate-slug rejection, preservation of `published_at`, direct view-count update denial, and the view RPC's published-only increment. The test transactions left zero posts, authors or editors. Browser checks confirmed the public empty state, missing-article state and editor sign-in page at desktop/mobile widths; JavaScript syntax checks passed. A real editor login/upload and the full create-to-public-view journey still need an assigned Blog Admin account and one published article.

## Deployment

Deploy the changed static files together. The live database migrations are already applied. Before publishing your first article, assign the first Blog Admin as above. Verify the site hostname used for canonical URLs and, if a custom domain differs from `linkorasolution.com`, adjust its static metadata. Publish a real article and verify its image and share preview on the live domain.
