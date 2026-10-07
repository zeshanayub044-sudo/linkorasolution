-- Admin status actions also mirror through the durable queue. Historical
-- corrections and additions are deliberately excluded from automatic sync.
create or replace function admin_private.queue_employee_sheet_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='INSERT' and new.status='Logged In'
      and new.login_source in ('user','admin')
      and new.login_at >= now()-interval '5 minutes' then
    insert into public.attendance_sheet_sync_queue(session_id,action)
    values (new.session_id,'login') on conflict do nothing;
  elsif tg_op='UPDATE' and old.status='Logged In' and new.status='Logged Out'
      and new.logout_source in ('user','admin')
      and new.logout_at >= now()-interval '5 minutes' then
    insert into public.attendance_sheet_sync_queue(session_id,action)
    values (new.session_id,'logout') on conflict do nothing;
  end if;
  return new;
end;
$$;
