-- General resumes are independent of job applications and remain admin-only.
create table public.career_resume_submissions (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(btrim(full_name)) between 2 and 160),
  email text not null check (char_length(email) <= 320 and email = lower(btrim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
  phone text not null check (char_length(btrim(phone)) between 7 and 40),
  primary_skill text not null check (char_length(btrim(primary_skill)) between 2 and 120),
  city text check (city is null or char_length(city) <= 120),
  country text check (country is null or char_length(country) <= 120),
  "current_role" text check ("current_role" is null or char_length("current_role") <= 160),
  years_experience numeric(4,1) check (years_experience is null or years_experience between 0 and 60),
  linkedin_url text check (linkedin_url is null or (char_length(linkedin_url) <= 500 and linkedin_url ~ '^https://')),
  portfolio_url text check (portfolio_url is null or (char_length(portfolio_url) <= 500 and portfolio_url ~ '^https://')),
  message text not null default '' check (char_length(message) <= 5000),
  resume_path text not null unique check (resume_path ~ '^general/[0-9a-f-]{36}[.](pdf|doc|docx)$'),
  status text not null default 'new' check (status in ('new','reviewing','shortlisted','interview','talent_pool','hired','rejected')),
  admin_notes text not null default '' check (char_length(admin_notes) <= 10000),
  consented_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index career_resume_submissions_newest_idx on public.career_resume_submissions (created_at desc);
create index career_resume_submissions_status_idx on public.career_resume_submissions (status, created_at desc);
create index career_resume_submissions_email_idx on public.career_resume_submissions (email, created_at desc);

create function career_private.touch_resume_submission()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if (new.status,new.admin_notes) is distinct from (old.status,old.admin_notes) then
    new.updated_at := now();
  end if;
  return new;
end;
$$;
revoke all on function career_private.touch_resume_submission() from public, anon, authenticated;
create trigger career_resume_submissions_touch before update on public.career_resume_submissions
for each row execute function career_private.touch_resume_submission();

alter table public.career_resume_submissions enable row level security;
revoke all on public.career_resume_submissions from public, anon, authenticated;
grant select on public.career_resume_submissions to authenticated;
grant update (status,admin_notes) on public.career_resume_submissions to authenticated;
grant select,insert,update,delete on public.career_resume_submissions to service_role;
create policy career_resume_submissions_admin_read on public.career_resume_submissions
for select to authenticated using ((select career_private.is_admin()));
create policy career_resume_submissions_admin_update on public.career_resume_submissions
for update to authenticated using ((select career_private.is_admin()))
with check ((select career_private.is_admin()));

-- Only the server-side Edge Function may create a submission. Lock per email to
-- make the ten-minute duplicate window effective for concurrent requests.
create function public.career_submit_resume(
  p_full_name text, p_email text, p_phone text, p_primary_skill text,
  p_city text, p_country text, p_current_role text, p_years_experience numeric,
  p_linkedin_url text, p_portfolio_url text, p_message text,
  p_resume_path text, p_consent boolean
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  submission_id uuid;
  normalized_email text := lower(btrim(p_email));
begin
  if p_consent is distinct from true or p_resume_path !~ '^general/[0-9a-f-]{36}[.](pdf|doc|docx)$' then
    raise exception 'Invalid resume submission' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(normalized_email, 0));
  if exists (
    select 1 from public.career_resume_submissions
    where email = normalized_email and created_at > now() - interval '10 minutes'
  ) then
    raise exception 'A recent resume submission already exists' using errcode = '23505';
  end if;
  insert into public.career_resume_submissions (
    full_name,email,phone,primary_skill,city,country,"current_role",years_experience,
    linkedin_url,portfolio_url,message,resume_path
  ) values (
    btrim(p_full_name),normalized_email,btrim(p_phone),btrim(p_primary_skill),
    nullif(btrim(p_city),''),nullif(btrim(p_country),''),nullif(btrim(p_current_role),''),
    p_years_experience,nullif(btrim(p_linkedin_url),''),nullif(btrim(p_portfolio_url),''),
    coalesce(btrim(p_message),''),p_resume_path
  ) returning id into submission_id;
  return submission_id;
end;
$$;
revoke all on function public.career_submit_resume(text,text,text,text,text,text,text,numeric,text,text,text,text,boolean)
from public, anon, authenticated;
grant execute on function public.career_submit_resume(text,text,text,text,text,text,text,numeric,text,text,text,text,boolean)
to service_role;

-- Preserve draft deletion while making the correlated application check explicit.
drop policy career_jobs_admin_delete_draft on public.career_jobs;
create policy career_jobs_admin_delete_draft on public.career_jobs
for delete to authenticated using (
  (select career_private.is_admin()) and status = 'draft' and
  not exists (select 1 from public.career_applications a where a.job_id = career_jobs.id)
);
