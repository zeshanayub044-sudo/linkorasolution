-- Keep numerator inside the same active scheduled denominator used for attendance rate.
create or replace function public.portal_attendance_monthly_v2(p_month date)
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
      else round(100.0*count(*) filter(where d.session_count>0 and d.scheduled and d.active_on_day)/
        count(*) filter(where d.scheduled and d.active_on_day and
          d.attendance_status not in ('Awaiting','On Leave')),1) end
  from public.portal_attendance_daily_v2(v_first,v_last,null) d
  group by d.user_id order by max(d.full_name);
end;
$$;
