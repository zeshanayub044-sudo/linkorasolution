-- Pure database expiry never depends on a browser or external HTTP request.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create function admin_private.portal_lease_tick()
returns void language plpgsql security definer set search_path='' as $$
begin
  perform admin_private.expire_portal_sessions();
  perform admin_private.expire_screen_shares();
  delete from admin_private.portal_clients c using public.employee_activity_sessions s
    where c.session_id=s.session_id and s.status<>'Logged In' and c.last_seen_at<now()-interval '7 days';
end; $$;
revoke all on function admin_private.portal_lease_tick() from public,anon,authenticated,service_role;
select cron.schedule('linkora-portal-session-leases','15 seconds','select admin_private.portal_lease_tick()');

-- A narrowly scoped random job capability authenticates queue draining. The raw
-- token lives only in Vault; the private table stores its digest, never a key.
create table admin_private.portal_job_auth (
  token_hash text primary key,
  last_run_at timestamptz
);
alter table admin_private.portal_job_auth enable row level security;
revoke all on admin_private.portal_job_auth from public,anon,authenticated;
grant select,update on admin_private.portal_job_auth to service_role;
do $$
declare v_token text:=encode(extensions.gen_random_bytes(32),'hex');
begin
  perform vault.create_secret(v_token,'linkora_portal_maintenance','Scoped attendance queue worker capability');
  insert into admin_private.portal_job_auth(token_hash) values(encode(extensions.digest(v_token,'sha256'),'hex'));
end; $$;

create function public.portal_maintenance_authorize(p_token text)
returns boolean language plpgsql set search_path='' as $$
begin
  if length(coalesce(p_token,''))<>64 then return false; end if;
  update admin_private.portal_job_auth set last_run_at=now()
    where token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
      and (last_run_at is null or last_run_at<now()-interval '30 seconds');
  return found;
end; $$;
revoke all on function public.portal_maintenance_authorize(text) from public,anon,authenticated;
grant execute on function public.portal_maintenance_authorize(text) to service_role;

select cron.schedule('linkora-portal-sheet-worker','* * * * *',$job$
  select net.http_post(
    url:='https://nbvylffxmjmovyfhbytu.supabase.co/functions/v1/workforce-live',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization',
      'Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='linkora_portal_maintenance')),
    body:='{"action":"maintenance"}'::jsonb,
    timeout_milliseconds:=15000);
$job$);

create function public.portal_sheet_auto_closed(p_day date)
returns table(user_id uuid,auto_closed boolean)
language sql stable set search_path='' as $$
  select a.employee_id,bool_or(a.estimated_logout) from public.employee_activity_sessions a
  where (a.login_at at time zone (select timezone from public.company_settings where id=true))::date=p_day
    and a.estimated_logout group by a.employee_id;
$$;
revoke all on function public.portal_sheet_auto_closed(date) from public,anon,authenticated;
grant execute on function public.portal_sheet_auto_closed(date) to service_role;

-- Expiry state writes go into the existing durable queues through their existing triggers.
-- No production attendance is backfilled or closed by this migration itself.
