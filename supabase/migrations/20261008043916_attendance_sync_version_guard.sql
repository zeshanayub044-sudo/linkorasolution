-- Avoid acknowledging a stale delivery when a new correction requeues it.
alter table public.attendance_sheet_sync_queue
  add column updated_at timestamptz not null default now();

create or replace function admin_private.queue_employee_sheet_sync()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_action text;
begin
  v_action:=case when new.status='Logged Out' then 'logout' else 'login' end;
  insert into public.attendance_sheet_sync_queue(session_id,action)
  values(new.session_id,v_action)
  on conflict(session_id,action) do update set
    synced_at=null,next_attempt_at=now(),attempts=0,last_error=null,
    updated_at=now();
  return new;
end;
$$;
