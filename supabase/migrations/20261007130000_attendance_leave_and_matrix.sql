-- Reuse the existing leave table. Its old FK pointed at legacy profiles, while
-- Tennis Portal accounts are identified by auth.users / employee_profiles.
alter table public.leave_requests drop constraint if exists leave_requests_employee_id_fkey;
alter table public.leave_requests add constraint leave_requests_employee_id_fkey
  foreign key (employee_id) references public.employee_profiles(id) on delete restrict;
create index if not exists leave_requests_approved_dates_idx
  on public.leave_requests (employee_id, start_date, end_date)
  where status = 'Approved';

-- An employee may request leave, but may never approve their own request.
drop policy if exists leave_create on public.leave_requests;
drop policy if exists leave_insert on public.leave_requests;
drop policy if exists leave_admin_update on public.leave_requests;
drop policy if exists leave_admin on public.leave_requests;
create policy leave_employee_request on public.leave_requests for insert to authenticated
  with check (employee_id = auth.uid() and status = 'Pending' and
    exists (select 1 from public.employee_profiles p where p.id = auth.uid() and p.is_active));
revoke all on public.leave_requests from public, anon, authenticated;
grant select, insert on public.leave_requests to authenticated;

create function public.portal_attendance_save_leave(
  p_leave_id uuid, p_employee_id uuid, p_leave_type text,
  p_start_date date, p_end_date date, p_leave_reason text,
  p_status text, p_admin_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_before jsonb; v_after jsonb; v_id uuid; v_actor public.employee_profiles%rowtype;
  v_target public.employee_profiles%rowtype;
begin
  if not public.is_admin() then raise exception 'Co-CEO access required' using errcode='42501'; end if;
  if p_employee_id is null or length(trim(coalesce(p_leave_type,''))) not between 2 and 80
    or p_start_date is null or p_end_date is null or p_end_date < p_start_date
    or p_end_date - p_start_date > 365 or p_status not in ('Pending','Approved','Rejected')
    or length(trim(coalesce(p_admin_reason,''))) not between 5 and 500 then
    raise exception 'Invalid leave details or admin reason' using errcode='22023';
  end if;
  select * into v_actor from public.employee_profiles where id = auth.uid();
  select * into v_target from public.employee_profiles where id = p_employee_id;
  if not found then raise exception 'Employee not found' using errcode='P0002'; end if;
  if p_leave_id is null then
    insert into public.leave_requests(employee_id,leave_type,start_date,end_date,reason,status)
    values (p_employee_id,trim(p_leave_type),p_start_date,p_end_date,
      trim(coalesce(p_leave_reason,'')),p_status) returning id into v_id;
  else
    select to_jsonb(l) into v_before from public.leave_requests l
      where l.id=p_leave_id for update;
    if v_before is null then raise exception 'Leave record not found' using errcode='P0002'; end if;
    update public.leave_requests set employee_id=p_employee_id,leave_type=trim(p_leave_type),
      start_date=p_start_date,end_date=p_end_date,
      reason=trim(coalesce(p_leave_reason,'')),status=p_status,updated_at=now()
      where id=p_leave_id;
    v_id := p_leave_id;
  end if;
  select to_jsonb(l) into v_after from public.leave_requests l where l.id=v_id;
  insert into public.portal_admin_audit_log
    (admin_id,admin_name,target_user_id,target_name,action,before_state,after_state,reason)
  values (v_actor.id,v_actor.full_name,p_employee_id,v_target.full_name,
    case when p_leave_id is null then 'leave_created' else 'leave_changed' end,
    v_before,v_after,trim(p_admin_reason));
  return v_id;
end;
$$;
revoke all on function public.portal_attendance_save_leave(uuid,uuid,text,date,date,text,text,text)
  from public,anon,authenticated;
grant execute on function public.portal_attendance_save_leave(uuid,uuid,text,date,date,text,text,text)
  to authenticated;

-- Add leave and explicit missing sign-out without changing the return contract
-- of the deployed daily RPC. The service role may read this snapshot for the
-- Google Sheet mirror; ordinary authenticated users still require Co-CEO.
create function public.portal_attendance_daily_v2(p_from date,p_to date,p_employee uuid default null)
returns table (
  user_id uuid,employee_id text,full_name text,scheme text,role text,
  account_active boolean,attendance_date date,scheduled boolean,active_on_day boolean,
  first_sign_in timestamptz,last_sign_out timestamptz,worked_minutes bigint,
  session_count integer,open_count integer,review_count integer,
  is_late boolean,attendance_status text,leave_type text,leave_status text
) language plpgsql stable security definer set search_path='' as $$
begin
  if coalesce(auth.role(),'') <> 'service_role' and not public.is_admin() then
    raise exception 'Co-CEO access required' using errcode='42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to-p_from > 45 then
    raise exception 'Choose a range of at most 46 days' using errcode='22023';
  end if;
  return query
  with settings as (
    select timezone,workday_start,late_after_minutes,workdays
    from public.company_settings where id=true
  ), days as (
    select gs::date as attendance_day from generate_series(p_from,p_to,interval '1 day') gs
  ), grid as (
    select p.id,p.employee_id,p.full_name,p.scheme,p.role,p.is_active,
      d.attendance_day,s.timezone,s.workday_start,s.late_after_minutes,
      extract(isodow from d.attendance_day)::integer=any(s.workdays) scheduled,
      exists (select 1 from public.employee_active_periods ap
        where ap.employee_id=p.id
          and ap.started_at <= (d.attendance_day::timestamp+s.workday_start) at time zone s.timezone
          and (ap.ended_at is null or ap.ended_at >
            (d.attendance_day::timestamp+s.workday_start) at time zone s.timezone)) active_on_day
    from public.employee_profiles p cross join days d cross join settings s
    where p_employee is null or p.id=p_employee
  )
  select g.id,g.employee_id,g.full_name,g.scheme,g.role,g.is_active,
    g.attendance_day,g.scheduled,g.active_on_day,a.first_login,a.last_logout,
    coalesce(a.worked_minutes,0)::bigint,coalesce(a.session_count,0)::integer,
    coalesce(a.open_count,0)::integer,coalesce(a.review_count,0)::integer,
    (a.first_login is not null and g.scheduled and
      (a.first_login at time zone g.timezone)::time >
      g.workday_start+make_interval(mins=>g.late_after_minutes)) is_late,
    case
      when coalesce(a.review_count,0)>0 or
        (coalesce(a.open_count,0)>0 and g.attendance_day<(now() at time zone g.timezone)::date)
        then 'Missing Sign-Out'
      when coalesce(a.open_count,0)>0 then 'Signed In'
      when coalesce(a.session_count,0)>0 then 'Signed Out'
      when not g.scheduled or not g.active_on_day then 'Not Scheduled'
      when l.id is not null then 'On Leave'
      when g.attendance_day<(now() at time zone g.timezone)::date then 'Absent'
      when g.attendance_day=(now() at time zone g.timezone)::date and
        (now() at time zone g.timezone)::time >
          g.workday_start+make_interval(mins=>g.late_after_minutes) then 'Absent'
      else 'Awaiting'
    end,l.leave_type,l.status
  from grid g
  left join lateral (
    select min(a.login_at) first_login,max(a.logout_at) last_logout,
      sum(case when a.logout_at is not null then
        greatest(0,floor(extract(epoch from a.logout_at-a.login_at)/60)) else 0 end) worked_minutes,
      count(*) session_count,
      count(*) filter(where a.status='Logged In') open_count,
      count(*) filter(where a.status='Needs Review') review_count
    from public.employee_activity_sessions a
    where a.employee_id=g.id
      and a.login_at >= (g.attendance_day::timestamp at time zone g.timezone)
      and a.login_at < ((g.attendance_day+1)::timestamp at time zone g.timezone)
  ) a on true
  left join lateral (
    select l.id,l.leave_type,l.status from public.leave_requests l
    where l.employee_id=g.id and l.status='Approved'
      and g.attendance_day between l.start_date and l.end_date
    order by l.created_at desc limit 1
  ) l on true
  order by g.attendance_day desc,g.full_name;
end;
$$;
revoke all on function public.portal_attendance_daily_v2(date,date,uuid)
  from public,anon,authenticated;
grant execute on function public.portal_attendance_daily_v2(date,date,uuid)
  to authenticated,service_role;

create function public.portal_attendance_monthly_v2(p_month date)
returns table (
  user_id uuid,employee_id text,full_name text,scheme text,role text,
  account_active boolean,present_days bigint,absent_days bigint,leave_days bigint,
  late_days bigint,missing_sign_out_days bigint,worked_minutes bigint,
  average_hours numeric,scheduled_days bigint,attendance_percent numeric
) language plpgsql stable security definer set search_path='' as $$
declare v_first date;v_last date;v_timezone text;
begin
  if not public.is_admin() then raise exception 'Co-CEO access required' using errcode='42501'; end if;
  if p_month is null then raise exception 'Month is required' using errcode='22023'; end if;
  v_first:=date_trunc('month',p_month)::date;
  v_last:=(v_first+interval '1 month'-interval '1 day')::date;
  select timezone into v_timezone from public.company_settings where id=true;
  return query
  select d.user_id,max(d.employee_id),max(d.full_name),max(d.scheme),max(d.role),
    bool_or(d.account_active),
    count(*) filter(where d.session_count>0),
    count(*) filter(where d.attendance_status='Absent'),
    count(*) filter(where d.attendance_status='On Leave'),
    count(*) filter(where d.is_late),
    count(*) filter(where d.attendance_status='Missing Sign-Out'),
    coalesce(sum(d.worked_minutes),0)::bigint,
    case when count(*) filter(where d.session_count>0)=0 then null
      else round(sum(d.worked_minutes)::numeric/
        count(*) filter(where d.session_count>0)/60,2) end,
    count(*) filter(where d.scheduled and d.active_on_day and
      d.attendance_status not in ('Awaiting','On Leave')),
    case when count(*) filter(where d.scheduled and d.active_on_day and
      d.attendance_status not in ('Awaiting','On Leave'))=0 then null
      else round(100.0*count(*) filter(where d.session_count>0 and d.scheduled)/
        count(*) filter(where d.scheduled and d.active_on_day and
          d.attendance_status not in ('Awaiting','On Leave')),1) end
  from public.portal_attendance_daily_v2(v_first,v_last,null) d
  group by d.user_id order by max(d.full_name);
end;
$$;
revoke all on function public.portal_attendance_monthly_v2(date) from public,anon,authenticated;
grant execute on function public.portal_attendance_monthly_v2(date) to authenticated;

-- A durable date queue covers leave, manual correction, account changes and
-- ordinary sessions. It is separate from the existing raw-session queue.
create table public.attendance_matrix_sync_queue (
  attendance_date date primary key,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  synced_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);
alter table public.attendance_matrix_sync_queue enable row level security;
revoke all on public.attendance_matrix_sync_queue from public,anon,authenticated;
grant select,insert,update on public.attendance_matrix_sync_queue to service_role;

create function admin_private.queue_matrix_day(p_day date)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_day is not null then
    insert into public.attendance_matrix_sync_queue(attendance_date) values(p_day)
    on conflict(attendance_date) do update set synced_at=null,next_attempt_at=now(),
      attempts=0,last_error=null,updated_at=now();
  end if;
end;
$$;
revoke all on function admin_private.queue_matrix_day(date) from public,anon,authenticated;

create function admin_private.queue_matrix_session()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_timezone text;
begin
  select timezone into v_timezone from public.company_settings where id=true;
  if tg_op='UPDATE' then
    perform admin_private.queue_matrix_day((old.login_at at time zone v_timezone)::date);
  end if;
  perform admin_private.queue_matrix_day((new.login_at at time zone v_timezone)::date);
  return new;
end;
$$;
revoke all on function admin_private.queue_matrix_session() from public,anon,authenticated;
create trigger attendance_matrix_session_queue
after insert or update of login_at,logout_at,status on public.employee_activity_sessions
for each row execute function admin_private.queue_matrix_session();

create function admin_private.queue_matrix_leave()
returns trigger language plpgsql security definer set search_path='' as $$
declare d date;
begin
  if tg_op='UPDATE' and old.status='Approved' then
    for d in select generate_series(old.start_date,old.end_date,interval '1 day')::date loop
      perform admin_private.queue_matrix_day(d);
    end loop;
  end if;
  if new.status='Approved' then
    for d in select generate_series(new.start_date,new.end_date,interval '1 day')::date loop
      perform admin_private.queue_matrix_day(d);
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function admin_private.queue_matrix_leave() from public,anon,authenticated;
create trigger attendance_matrix_leave_queue
after insert or update on public.leave_requests
for each row execute function admin_private.queue_matrix_leave();

create function admin_private.queue_matrix_employee()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_timezone text;
begin
  select timezone into v_timezone from public.company_settings where id=true;
  perform admin_private.queue_matrix_day((now() at time zone v_timezone)::date);
  return new;
end;
$$;
revoke all on function admin_private.queue_matrix_employee() from public,anon,authenticated;
create trigger attendance_matrix_employee_queue
after insert or update of full_name,employee_id,is_active on public.employee_profiles
for each row execute function admin_private.queue_matrix_employee();

-- Keep the original raw tab idempotent and repairable after audited corrections.
create or replace function admin_private.queue_employee_sheet_sync()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_action text;
begin
  v_action:=case when new.status='Logged Out' then 'logout' else 'login' end;
  insert into public.attendance_sheet_sync_queue(session_id,action)
  values(new.session_id,v_action)
  on conflict(session_id,action) do update set
    synced_at=null,next_attempt_at=now(),attempts=0,last_error=null;
  return new;
end;
$$;
drop trigger if exists employee_activity_sheet_queue on public.employee_activity_sessions;
create trigger employee_activity_sheet_queue
after insert or update of login_at,logout_at,status on public.employee_activity_sessions
for each row execute function admin_private.queue_employee_sheet_sync();

-- Existing Supabase sessions are preserved and scheduled for raw-log recovery.
insert into public.attendance_sheet_sync_queue(session_id,action)
select session_id,case when status='Logged Out' then 'logout' else 'login' end
from public.employee_activity_sessions
on conflict(session_id,action) do nothing;

-- Include every date with historical activity in the new person-centric view.
insert into public.attendance_matrix_sync_queue(attendance_date)
select distinct (a.login_at at time zone s.timezone)::date
from public.employee_activity_sessions a cross join public.company_settings s
where s.id=true
on conflict(attendance_date) do nothing;
