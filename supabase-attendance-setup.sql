-- Linkora Attendance Portal: run this entire migration in Supabase SQL Editor.
-- It is deliberately idempotent and replaces insecure browser-side attendance writes.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  employee_id text unique not null, full_name text not null, email text unique not null,
  department text, designation text, phone text, joining_date date,
  active boolean not null default true,
  role text not null default 'employee' check (role in ('employee','admin')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.company_settings (
  id boolean primary key default true check (id), company_name text not null default 'Linkora Solutions',
  timezone text not null default 'Asia/Karachi', workday_start time not null default '09:00',
  late_after_minutes integer not null default 15 check (late_after_minutes between 0 and 240),
  workdays integer[] not null default array[1,2,3,4,5]
);
insert into public.company_settings (id) values (true) on conflict (id) do nothing;
create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.profiles(id) on delete cascade,
  attendance_date date not null, check_in timestamptz, check_out timestamptz,
  working_minutes integer generated always as (case when check_in is not null and check_out is not null then greatest(0, floor(extract(epoch from (check_out-check_in))/60)::integer) else null end) stored,
  status text not null default 'Working' check (status in ('Working','Present','Completed','Late','Half Day','Leave','Absent','Holiday','Weekend')),
  corrected_by uuid references public.profiles(id), corrected_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(employee_id, attendance_date), check (check_out is null or check_in is not null)
);
create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.profiles(id) on delete cascade,
  leave_type text not null check (leave_type in ('Casual Leave','Sick Leave','Annual Leave','Emergency Leave','Unpaid Leave','Other')),
  start_date date not null, end_date date not null, reason text not null,
  status text not null default 'Pending' check (status in ('Pending','Approved','Rejected')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(end_date >= start_date)
);
create table if not exists public.audit_log (
  id bigint generated always as identity primary key, actor_id uuid references public.profiles(id) on delete set null, target_id uuid references public.profiles(id) on delete set null,
  action text not null, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
alter table public.audit_log drop constraint if exists audit_log_actor_id_fkey;
alter table public.audit_log drop constraint if exists audit_log_target_id_fkey;
alter table public.audit_log add constraint audit_log_actor_id_fkey foreign key (actor_id) references public.profiles(id) on delete set null;
alter table public.audit_log add constraint audit_log_target_id_fkey foreign key (target_id) references public.profiles(id) on delete set null;
-- Upgrade databases created by an earlier version of this portal.
alter table public.profiles add column if not exists updated_at timestamptz not null default now();
alter table public.attendance_records add column if not exists working_minutes integer generated always as (case when check_in is not null and check_out is not null then greatest(0, floor(extract(epoch from (check_out-check_in))/60)::integer) else null end) stored;
alter table public.attendance_records add column if not exists corrected_by uuid references public.profiles(id);
alter table public.attendance_records add column if not exists corrected_at timestamptz;
alter table public.attendance_records add column if not exists created_at timestamptz not null default now();
alter table public.attendance_records add column if not exists updated_at timestamptz not null default now();
alter table public.leave_requests add column if not exists updated_at timestamptz not null default now();
alter table public.attendance_records drop constraint if exists attendance_records_status_check;
alter table public.attendance_records add constraint attendance_records_status_check check (status in ('Working','Present','Completed','Late','Half Day','Leave','Absent','Holiday','Weekend'));
create index if not exists attendance_date_idx on public.attendance_records(attendance_date);
create index if not exists attendance_employee_date_idx on public.attendance_records(employee_id, attendance_date desc);
create index if not exists leaves_employee_dates_idx on public.leave_requests(employee_id, start_date, end_date);

create or replace function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
drop trigger if exists profiles_updated_at on public.profiles; create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
drop trigger if exists attendance_updated_at on public.attendance_records; create trigger attendance_updated_at before update on public.attendance_records for each row execute function public.set_updated_at();
drop trigger if exists leaves_updated_at on public.leave_requests; create trigger leaves_updated_at before update on public.leave_requests for each row execute function public.set_updated_at();

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='admin' and active) $$;
create or replace function public.employee_login_email(lookup_employee_id text) returns text language sql security definer set search_path=public as $$ select email from public.profiles where upper(employee_id)=upper(trim(lookup_employee_id)) and active limit 1 $$;
grant execute on function public.employee_login_email(text) to anon, authenticated;

-- Only these RPCs may create or close a workday. now() is database/server time.
create or replace function public.check_in() returns public.attendance_records language plpgsql security definer set search_path=public as $$
declare r public.attendance_records; s public.company_settings; local_day date; local_time time; is_late boolean;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and active) then raise exception 'Your account is inactive.' using errcode='42501'; end if;
  select * into s from public.company_settings where id=true; local_day := (now() at time zone s.timezone)::date; local_time := (now() at time zone s.timezone)::time;
  if extract(isodow from local_day)::int <> all(s.workdays) then raise exception 'Today is not a configured working day.'; end if;
  if exists(select 1 from public.leave_requests where employee_id=auth.uid() and status='Approved' and local_day between start_date and end_date) then raise exception 'You have approved leave for today.'; end if;
  is_late := local_time > s.workday_start + make_interval(mins=>s.late_after_minutes);
  insert into public.attendance_records(employee_id,attendance_date,check_in,status) values(auth.uid(),local_day,now(),case when is_late then 'Late' else 'Working' end) returning * into r;
  return r;
exception when unique_violation then raise exception 'Today''s attendance record already exists.' using errcode='23505'; end $$;
create or replace function public.check_out() returns public.attendance_records language plpgsql security definer set search_path=public as $$
declare r public.attendance_records; s public.company_settings; local_day date;
begin select * into s from public.company_settings where id=true; local_day := (now() at time zone s.timezone)::date;
  update public.attendance_records set check_out=now(),status='Completed' where employee_id=auth.uid() and attendance_date=local_day and check_in is not null and check_out is null returning * into r;
  if r.id is null then raise exception 'There is no open attendance record to check out.'; end if; return r; end $$;
grant execute on function public.check_in() to authenticated; grant execute on function public.check_out() to authenticated;
create or replace function public.correct_attendance(record_id uuid, corrected_check_in timestamptz, corrected_check_out timestamptz, corrected_status text)
returns public.attendance_records language plpgsql security definer set search_path=public as $$
declare r public.attendance_records;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode='42501'; end if;
  if corrected_check_in is null or (corrected_check_out is not null and corrected_check_out < corrected_check_in) then raise exception 'Check-out must be after check-in.'; end if;
  update public.attendance_records set check_in=corrected_check_in, check_out=corrected_check_out, status=corrected_status, corrected_by=auth.uid(), corrected_at=now()
  where id=record_id returning * into r;
  if r.id is null then raise exception 'Attendance record was not found.'; end if;
  insert into public.audit_log(actor_id,target_id,action,metadata) values(auth.uid(),r.employee_id,'attendance_corrected',jsonb_build_object('record_id',record_id));
  return r;
end $$;
grant execute on function public.correct_attendance(uuid,timestamptz,timestamptz,text) to authenticated;

alter table public.profiles enable row level security; alter table public.company_settings enable row level security; alter table public.attendance_records enable row level security; alter table public.leave_requests enable row level security; alter table public.audit_log enable row level security;
drop policy if exists profiles_select on public.profiles; create policy profiles_select on public.profiles for select to authenticated using (id=auth.uid() or public.is_admin());
drop policy if exists "profiles: staff read own profile" on public.profiles;
drop policy if exists "profiles: staff update own profile" on public.profiles;
drop policy if exists "profiles: admins manage staff" on public.profiles;
drop policy if exists profiles_update on public.profiles; create policy profiles_update on public.profiles for update to authenticated using (public.is_admin()) with check(public.is_admin());
drop policy if exists settings_read on public.company_settings; create policy settings_read on public.company_settings for select to authenticated using(true);
drop policy if exists settings_admin on public.company_settings; create policy settings_admin on public.company_settings for update to authenticated using(public.is_admin()) with check(public.is_admin());
drop policy if exists attendance_read on public.attendance_records; create policy attendance_read on public.attendance_records for select to authenticated using(employee_id=auth.uid() or public.is_admin());
drop policy if exists "attendance: staff read own" on public.attendance_records;
drop policy if exists "attendance: staff create own" on public.attendance_records;
drop policy if exists "attendance: staff update own" on public.attendance_records;
drop policy if exists "attendance: admins view all" on public.attendance_records;
-- No direct insert/update policy: RPCs enforce timestamps, state transitions and correction auditing.
drop policy if exists attendance_admin_update on public.attendance_records;
drop policy if exists leave_read on public.leave_requests; create policy leave_read on public.leave_requests for select to authenticated using(employee_id=auth.uid() or public.is_admin());
drop policy if exists "leave: staff read own" on public.leave_requests;
drop policy if exists "leave: staff create own" on public.leave_requests;
drop policy if exists "leave: admins update" on public.leave_requests;
drop policy if exists leave_create on public.leave_requests; create policy leave_create on public.leave_requests for insert to authenticated with check(employee_id=auth.uid());
drop policy if exists leave_admin_update on public.leave_requests; create policy leave_admin_update on public.leave_requests for update to authenticated using(public.is_admin()) with check(public.is_admin());
drop policy if exists audit_read on public.audit_log; create policy audit_read on public.audit_log for select to authenticated using(public.is_admin());
