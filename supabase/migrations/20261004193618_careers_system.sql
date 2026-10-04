-- Careers authorization and candidate data are separate from Tennis and Blog.
create schema if not exists career_private;
revoke all on schema career_private from public, anon, authenticated;
grant usage on schema career_private to authenticated;

create table public.career_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'careers_admin' check (role = 'careers_admin'),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.career_jobs (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 3 and 180),
  slug text not null unique check (char_length(slug) <= 140 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  department text not null check (char_length(btrim(department)) between 2 and 100),
  location text not null check (char_length(btrim(location)) between 2 and 160),
  employment_type text not null check (employment_type in ('full_time', 'part_time', 'internship', 'contract')),
  workplace_type text not null check (workplace_type in ('on_site', 'remote', 'hybrid')),
  experience_level text not null check (char_length(btrim(experience_level)) between 2 and 100),
  salary_min numeric(12,2) check (salary_min is null or salary_min >= 0),
  salary_max numeric(12,2) check (salary_max is null or salary_max >= 0),
  salary_currency text check (salary_currency is null or salary_currency ~ '^[A-Z]{3}$'),
  summary text not null default '' check (char_length(summary) <= 700),
  description text not null default '' check (char_length(description) <= 20000),
  responsibilities text not null default '' check (char_length(responsibilities) <= 12000),
  requirements text not null default '' check (char_length(requirements) <= 12000),
  preferred_qualifications text not null default '' check (char_length(preferred_qualifications) <= 12000),
  benefits text not null default '' check (char_length(benefits) <= 12000),
  status text not null default 'draft' check (status in ('draft', 'open', 'closed', 'archived')),
  published_at timestamptz,
  closes_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint career_salary_range check (salary_min is null or salary_max is null or salary_min <= salary_max),
  constraint career_salary_currency check ((salary_min is null and salary_max is null) or salary_currency is not null),
  constraint career_open_content check (
    status <> 'open' or
    (char_length(btrim(summary)) > 0 and char_length(btrim(description)) > 0 and
     char_length(btrim(responsibilities)) > 0 and char_length(btrim(requirements)) > 0 and
     published_at is not null)
  )
);

create index career_jobs_public_idx on public.career_jobs (published_at desc) where status = 'open';
create index career_jobs_creator_idx on public.career_jobs (created_by, updated_at desc);

create table public.career_applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.career_jobs (id) on delete restrict,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 160),
  email text not null check (char_length(email) <= 320 and email = lower(btrim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
  phone text not null check (char_length(btrim(phone)) between 7 and 40),
  city text not null check (char_length(btrim(city)) between 2 and 120),
  country text not null check (char_length(btrim(country)) between 2 and 120),
  linkedin_url text check (linkedin_url is null or (char_length(linkedin_url) <= 500 and linkedin_url ~ '^https://')),
  portfolio_url text check (portfolio_url is null or (char_length(portfolio_url) <= 500 and portfolio_url ~ '^https://')),
  years_experience numeric(4,1) not null check (years_experience between 0 and 60),
  current_company text check (current_company is null or char_length(current_company) <= 160),
  "current_role" text not null check (char_length(btrim("current_role")) between 2 and 160),
  expected_salary text check (expected_salary is null or char_length(expected_salary) <= 100),
  notice_period text not null check (char_length(btrim(notice_period)) between 2 and 120),
  cover_letter text not null check (char_length(btrim(cover_letter)) between 20 and 10000),
  resume_path text not null check (resume_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}[.](pdf|doc|docx)$'),
  application_status text not null default 'new' check (application_status in ('new','reviewing','shortlisted','interview','offered','hired','rejected')),
  admin_notes text not null default '' check (char_length(admin_notes) <= 10000),
  consented_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint career_application_one_per_email unique (job_id, email)
);

create index career_applications_newest_idx on public.career_applications (created_at desc);
create index career_applications_job_newest_idx on public.career_applications (job_id, created_at desc);
create index career_applications_status_idx on public.career_applications (application_status, created_at desc);

create function career_private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.career_admins a
    where a.user_id = (select auth.uid()) and a.role = 'careers_admin' and a.is_active = true
  );
$$;
revoke all on function career_private.is_admin() from public, anon, authenticated;
grant execute on function career_private.is_admin() to authenticated;

create function public.career_current_role()
returns text language sql stable security invoker set search_path = '' as $$
  select case when career_private.is_admin() then 'careers_admin' else null end;
$$;
revoke all on function public.career_current_role() from public, anon, authenticated;
grant execute on function public.career_current_role() to authenticated;

create function career_private.prepare_job()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.status = 'open' then
    if new.closes_at is not null and new.closes_at <= now() then
      raise exception 'An open job needs a future closing date' using errcode = '22023';
    end if;
    if new.published_at is null then new.published_at := now(); end if;
  end if;
  if tg_op = 'UPDATE' and (
    new.title,new.slug,new.department,new.location,new.employment_type,new.workplace_type,
    new.experience_level,new.salary_min,new.salary_max,new.salary_currency,new.summary,
    new.description,new.responsibilities,new.requirements,new.preferred_qualifications,
    new.benefits,new.status,new.closes_at
  ) is distinct from (
    old.title,old.slug,old.department,old.location,old.employment_type,old.workplace_type,
    old.experience_level,old.salary_min,old.salary_max,old.salary_currency,old.summary,
    old.description,old.responsibilities,old.requirements,old.preferred_qualifications,
    old.benefits,old.status,old.closes_at
  ) then new.updated_at := now(); end if;
  return new;
end;
$$;
revoke all on function career_private.prepare_job() from public, anon, authenticated;
create trigger career_jobs_prepare before insert or update on public.career_jobs
for each row execute function career_private.prepare_job();

create function career_private.touch_application()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if (new.application_status,new.admin_notes) is distinct from
     (old.application_status,old.admin_notes) then new.updated_at := now(); end if;
  return new;
end;
$$;
revoke all on function career_private.touch_application() from public, anon, authenticated;
create trigger career_applications_touch before update on public.career_applications
for each row execute function career_private.touch_application();

alter table public.career_admins enable row level security;
alter table public.career_jobs enable row level security;
alter table public.career_applications enable row level security;

revoke all on public.career_admins, public.career_jobs, public.career_applications from anon, authenticated;
grant select on public.career_jobs to anon, authenticated;
grant insert (title,slug,department,location,employment_type,workplace_type,experience_level,
  salary_min,salary_max,salary_currency,summary,description,responsibilities,requirements,
  preferred_qualifications,benefits,status,closes_at) on public.career_jobs to authenticated;
grant update (title,slug,department,location,employment_type,workplace_type,experience_level,
  salary_min,salary_max,salary_currency,summary,description,responsibilities,requirements,
  preferred_qualifications,benefits,status,closes_at) on public.career_jobs to authenticated;
grant delete on public.career_jobs to authenticated;
grant select on public.career_applications to authenticated;
grant update (application_status,admin_notes) on public.career_applications to authenticated;
grant select, insert, update, delete on public.career_admins, public.career_jobs, public.career_applications to service_role;

create policy career_jobs_anon_read on public.career_jobs
for select to anon using (status = 'open' and (closes_at is null or closes_at > now()));
create policy career_jobs_authenticated_read on public.career_jobs
for select to authenticated using (
  (status = 'open' and (closes_at is null or closes_at > now())) or
  (select career_private.is_admin())
);
create policy career_jobs_admin_insert on public.career_jobs
for insert to authenticated with check (
  (select career_private.is_admin()) and created_by = (select auth.uid())
);
create policy career_jobs_admin_update on public.career_jobs
for update to authenticated using ((select career_private.is_admin()))
with check ((select career_private.is_admin()));
create policy career_jobs_admin_delete_draft on public.career_jobs
for delete to authenticated using (
  (select career_private.is_admin()) and status = 'draft' and
  not exists (select 1 from public.career_applications a where a.job_id = id)
);
create policy career_applications_admin_read on public.career_applications
for select to authenticated using ((select career_private.is_admin()));
create policy career_applications_admin_update on public.career_applications
for update to authenticated using ((select career_private.is_admin()))
with check ((select career_private.is_admin()));

-- Called only by the server-side application Edge Function with service_role.
-- The row lock prevents closing a job during an application insert.
create function public.career_submit_application(
  p_job_id uuid, p_full_name text, p_email text, p_phone text,
  p_city text, p_country text, p_linkedin_url text, p_portfolio_url text,
  p_years_experience numeric, p_current_company text, p_current_role text,
  p_expected_salary text, p_notice_period text, p_cover_letter text,
  p_resume_path text, p_consent boolean
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  job public.career_jobs%rowtype;
  application_id uuid;
begin
  if p_consent is distinct from true then
    raise exception 'Consent is required' using errcode = '22023';
  end if;
  select * into job from public.career_jobs
  where id = p_job_id for share;
  if not found or job.status <> 'open' or
     (job.closes_at is not null and job.closes_at <= now()) then
    raise exception 'Job is no longer accepting applications' using errcode = '22023';
  end if;
  if not starts_with(p_resume_path, p_job_id::text || '/') then
    raise exception 'Invalid resume path' using errcode = '22023';
  end if;
  insert into public.career_applications (
    job_id,full_name,email,phone,city,country,linkedin_url,portfolio_url,
    years_experience,current_company,"current_role",expected_salary,
    notice_period,cover_letter,resume_path
  ) values (
    p_job_id,btrim(p_full_name),lower(btrim(p_email)),btrim(p_phone),btrim(p_city),btrim(p_country),
    nullif(btrim(p_linkedin_url),''),nullif(btrim(p_portfolio_url),''),
    p_years_experience,nullif(btrim(p_current_company),''),btrim(p_current_role),
    nullif(btrim(p_expected_salary),''),btrim(p_notice_period),btrim(p_cover_letter),p_resume_path
  ) returning id into application_id;
  return application_id;
end;
$$;
revoke all on function public.career_submit_application(
  uuid,text,text,text,text,text,text,text,numeric,text,text,text,text,text,text,boolean
) from public, anon, authenticated;
grant execute on function public.career_submit_application(
  uuid,text,text,text,text,text,text,text,numeric,text,text,text,text,text,text,boolean
) to service_role;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('career-resumes','career-resumes',false,8388608,
  array['application/pdf','application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;

create policy career_resumes_admin_read on storage.objects
for select to authenticated using (
  bucket_id = 'career-resumes' and (select career_private.is_admin())
);
