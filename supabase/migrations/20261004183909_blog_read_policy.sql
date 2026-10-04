-- Keep one SELECT policy per API role to avoid evaluating multiple permissive
-- policies for every row. Anonymous readers cannot call the private role helper.
drop policy blog_posts_public_read on public.blog_posts;
drop policy blog_posts_editor_read on public.blog_posts;
create policy blog_posts_anon_read on public.blog_posts
for select to anon using (status = 'published');
create policy blog_posts_authenticated_read on public.blog_posts
for select to authenticated using (
  status = 'published' or (select blog_private.current_role()) is not null
);
