-- Run this once in Supabase Dashboard > SQL Editor > New query.
-- Create employee login accounts first in Authentication > Users, then use their UUIDs below.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  employee_id text unique not null,
  full_name text not null,
  email text unique not null,
  department text,
  designation text,
  phone text,
  joining_date date,
  active boolean not null default true,
  role text not null default 'employee' check (role in ('employee', 'admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  attendance_date date not null default current_date,
  check_in timestamptz,
  check_out timestamptz,
  status text not null default 'Present' check (status in ('Present', 'Absent', 'Late', 'Half Day', 'Leave', 'Holiday')),
  unique(employee_id, attendance_date)
);

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  leave_type text not null,
  start_date date not null,
  end_date date not null,
  reason text not null,
  status text not null default 'Pending' check (status in ('Pending', 'Approved', 'Rejected')),
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);

alter table public.profiles enable row level security;
alter table public.attendance_records enable row level security;
alter table public.leave_requests enable row level security;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and active = true) $$;

-- Supports employee-ID sign-in without exposing profile records directly.
create or replace function public.employee_login_email(lookup_employee_id text)
returns text language sql security definer set search_path = public
as $$ select email from public.profiles where employee_id = lookup_employee_id and active = true limit 1 $$;
grant execute on function public.employee_login_email(text) to anon, authenticated;

-- Makes this setup safe to run again after a partial SQL Editor execution.
drop policy if exists "profiles: staff read own profile" on public.profiles;
drop policy if exists "profiles: staff update own profile" on public.profiles;
drop policy if exists "profiles: admins manage staff" on public.profiles;
drop policy if exists "attendance: staff read own" on public.attendance_records;
drop policy if exists "attendance: staff create own" on public.attendance_records;
drop policy if exists "attendance: staff update own" on public.attendance_records;
drop policy if exists "attendance: admins view all" on public.attendance_records;
drop policy if exists "leave: staff read own" on public.leave_requests;
drop policy if exists "leave: staff create own" on public.leave_requests;
drop policy if exists "leave: admins update" on public.leave_requests;

create policy "profiles: staff read own profile" on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "profiles: staff update own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid() and role = 'employee');
create policy "profiles: admins manage staff" on public.profiles for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "attendance: staff read own" on public.attendance_records for select to authenticated using (employee_id = auth.uid() or public.is_admin());
create policy "attendance: staff create own" on public.attendance_records for insert to authenticated with check (employee_id = auth.uid() and attendance_date = current_date);
create policy "attendance: staff update own" on public.attendance_records for update to authenticated using (employee_id = auth.uid() or public.is_admin()) with check (employee_id = auth.uid() or public.is_admin());
create policy "attendance: admins view all" on public.attendance_records for delete to authenticated using (public.is_admin());

create policy "leave: staff read own" on public.leave_requests for select to authenticated using (employee_id = auth.uid() or public.is_admin());
create policy "leave: staff create own" on public.leave_requests for insert to authenticated with check (employee_id = auth.uid());
create policy "leave: admins update" on public.leave_requests for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Replace these placeholders after creating each Authentication user. Exactly one profile must have role 'admin'.
-- insert into public.profiles (id, employee_id, full_name, email, department, designation, phone, joining_date, role)
-- values ('AUTH-USER-UUID-HERE', 'EMP-1024', 'Ayesha Khan', 'ayesha@yourdomain.com', 'Marketing', 'SEO Specialist', '+92...', '2024-03-12', 'employee');
