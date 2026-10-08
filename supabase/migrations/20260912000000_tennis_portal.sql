-- Employee data is private: employees may only read their own active profile.
create table if not exists public.employee_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  employee_id text unique not null,
  full_name text not null,
  scheme text not null,
  role text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_activity_sessions (
  session_id uuid primary key,
  employee_id uuid not null references public.employee_profiles(id) on delete restrict,
  login_at timestamptz not null default now(),
  logout_at timestamptz,
  status text not null check (status in ('Logged In', 'Logged Out')),
  created_at timestamptz not null default now()
);

alter table public.employee_profiles enable row level security;

alter table public.employee_activity_sessions enable row level security;

create policy "employees can read their own profile" on public.employee_profiles
  for select to authenticated using (id = auth.uid() and is_active = true);

-- No direct browser access to activity records. The Edge Function writes with the service role.
