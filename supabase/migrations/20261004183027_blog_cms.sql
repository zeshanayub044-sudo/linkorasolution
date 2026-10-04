-- Blog CMS objects are isolated from employee and Tennis Portal tables.
create schema if not exists blog_private;
revoke all on schema blog_private from public, anon, authenticated;
grant usage on schema blog_private to authenticated;

create table public.blog_authors (
  id uuid primary key references auth.users (id) on delete restrict,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 100),
  title text check (title is null or char_length(title) <= 120),
  bio text check (bio is null or char_length(bio) <= 1500),
  avatar_url text check (avatar_url is null or avatar_url ~ '^https://'),
  created_at timestamptz not null default now()
);

-- This table is never writable through the browser. Owners provision roles in
-- Supabase SQL Editor after creating the Auth account.
create table public.blog_editors (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('blog_admin', 'blog_editor')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 3 and 200),
  slug text not null unique check (char_length(slug) <= 140 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  excerpt text not null default '' check (char_length(excerpt) <= 700),
  content text not null default '' check (char_length(content) <= 200000),
  reading_minutes integer generated always as
    (greatest(1, ceil(char_length(content)::numeric / 1200)::integer)) stored,
  featured_image_url text check (
    featured_image_url is null or
    starts_with(featured_image_url, 'https://nbvylffxmjmovyfhbytu.supabase.co/storage/v1/object/public/blog-images/')
  ),
  author_id uuid not null default auth.uid() references public.blog_authors (id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  view_count bigint not null default 0 check (view_count >= 0),
  seo_title text check (seo_title is null or char_length(seo_title) <= 200),
  seo_description text check (seo_description is null or char_length(seo_description) <= 500),
  canonical_url text check (canonical_url is null or canonical_url ~ '^https://[^[:space:]]+$'),
  category text not null default 'Insights' check (char_length(btrim(category)) between 2 and 80),
  constraint blog_published_content check (
    status <> 'published' or
    (char_length(btrim(excerpt)) > 0 and char_length(btrim(content)) > 0 and published_at is not null)
  )
);

create index blog_posts_published_at_idx on public.blog_posts (published_at desc)
  where status = 'published';
create index blog_posts_author_updated_idx on public.blog_posts (author_id, updated_at desc);
create index blog_posts_category_idx on public.blog_posts (category)
  where status = 'published';

create function blog_private.current_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select e.role
  from public.blog_editors as e
  where e.user_id = (select auth.uid()) and e.is_active = true
  limit 1;
$$;
revoke all on function blog_private.current_role() from public, anon, authenticated;
grant execute on function blog_private.current_role() to authenticated;

-- A browser may learn only its own Blog role, never list or change role rows.
create function public.blog_current_role()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select blog_private.current_role();
$$;
revoke all on function public.blog_current_role() from public, anon, authenticated;
grant execute on function public.blog_current_role() to authenticated;

create function blog_private.prepare_post()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  if tg_op = 'UPDATE' and (
    new.title, new.slug, new.excerpt, new.content, new.featured_image_url,
    new.author_id, new.status, new.seo_title, new.seo_description,
    new.canonical_url, new.category
  ) is distinct from (
    old.title, old.slug, old.excerpt, old.content, old.featured_image_url,
    old.author_id, old.status, old.seo_title, old.seo_description,
    old.canonical_url, old.category
  ) then
    new.updated_at := now();
  end if;
  return new;
end;
$$;
revoke all on function blog_private.prepare_post() from public, anon, authenticated;
create trigger blog_posts_prepare before insert or update on public.blog_posts
for each row execute function blog_private.prepare_post();

alter table public.blog_authors enable row level security;
alter table public.blog_editors enable row level security;
alter table public.blog_posts enable row level security;

revoke all on public.blog_authors, public.blog_editors, public.blog_posts from anon, authenticated;
grant select on public.blog_authors to anon, authenticated;
grant select on public.blog_posts to anon, authenticated;
grant insert (title, slug, excerpt, content, featured_image_url, status,
  seo_title, seo_description, canonical_url, category) on public.blog_posts to authenticated;
grant update (title, slug, excerpt, content, featured_image_url, status,
  seo_title, seo_description, canonical_url, category) on public.blog_posts to authenticated;
grant delete on public.blog_posts to authenticated;

create policy blog_authors_read on public.blog_authors
for select to anon, authenticated using (true);

create policy blog_posts_public_read on public.blog_posts
for select to anon, authenticated using (status = 'published');
create policy blog_posts_editor_read on public.blog_posts
for select to authenticated using ((select blog_private.current_role()) is not null);
create policy blog_posts_editor_insert on public.blog_posts
for insert to authenticated with check (
  (select blog_private.current_role()) in ('blog_admin', 'blog_editor')
  and author_id = (select auth.uid())
);
create policy blog_posts_editor_update on public.blog_posts
for update to authenticated using (
  (select blog_private.current_role()) = 'blog_admin'
  or ((select blog_private.current_role()) = 'blog_editor' and author_id = (select auth.uid()))
) with check (
  (select blog_private.current_role()) = 'blog_admin'
  or ((select blog_private.current_role()) = 'blog_editor' and author_id = (select auth.uid()))
);
create policy blog_posts_editor_delete on public.blog_posts
for delete to authenticated using (
  (select blog_private.current_role()) = 'blog_admin'
  or ((select blog_private.current_role()) = 'blog_editor' and author_id = (select auth.uid()) and status = 'draft')
);

-- This is the sole public write path for views: one published slug, +1 only.
create function public.blog_record_view(p_slug text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_count bigint;
begin
  if p_slug is null or char_length(p_slug) > 140 or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    return null;
  end if;
  update public.blog_posts
  set view_count = view_count + 1
  where slug = p_slug and status = 'published'
  returning view_count into result_count;
  return result_count;
end;
$$;
revoke all on function public.blog_record_view(text) from public, anon, authenticated;
grant execute on function public.blog_record_view(text) to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('blog-images', 'blog-images', true, 5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do nothing;

-- Uploads use a UUID filename under the uploader's Auth UUID. Public bucket
-- URLs may be read without granting public object listing or modification.
create policy blog_images_editor_insert on storage.objects
for insert to authenticated with check (
  bucket_id = 'blog-images'
  and (select blog_private.current_role()) in ('blog_admin', 'blog_editor')
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
create policy blog_images_editor_delete on storage.objects
for delete to authenticated using (
  bucket_id = 'blog-images'
  and (
    (select blog_private.current_role()) = 'blog_admin'
    or ((select blog_private.current_role()) = 'blog_editor'
        and (storage.foldername(name))[1] = (select auth.uid())::text)
  )
);
