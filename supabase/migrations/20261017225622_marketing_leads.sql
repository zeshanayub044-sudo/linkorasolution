create table public.marketing_leads (
 id uuid primary key default gen_random_uuid(), request_id uuid not null unique,
 name text not null check(length(name) between 1 and 120), email text not null check(length(email)<=254),
 phone text not null default '' check(length(phone)<=40), company text not null default '' check(length(company)<=160),
 website text not null default '' check(length(website)<=500), service text not null check(length(service)<=120),
 budget text not null default '' check(length(budget)<=120), message text not null check(length(message) between 1 and 4000),
 source_page text not null check(length(source_page)<=120), utm jsonb not null default '{}' check(pg_column_size(utm)<2000),
 created_at timestamptz not null default now(), status text not null default 'new' check(status in ('new','contacted','qualified','closed')),
 crm_status text not null default 'pending' check(crm_status in ('pending','delivered','failed')), crm_attempted_at timestamptz
);
alter table public.marketing_leads enable row level security;
revoke all on public.marketing_leads from anon,authenticated;
grant select on public.marketing_leads to authenticated;
-- Read-only predicate reuses the current active Co-CEO authorization; it grants no roles.
create function public.marketing_management_access() returns boolean language sql stable security definer set search_path='' as $$
 select admin_private.is_active_co_ceo();
$$;
revoke all on function public.marketing_management_access() from public,anon;
grant execute on function public.marketing_management_access() to authenticated;
create policy marketing_management_read on public.marketing_leads for select to authenticated using ((select public.marketing_management_access()));
create index marketing_leads_created on public.marketing_leads(created_at desc);
create table admin_private.marketing_lead_limits(rate_key text primary key, window_start timestamptz not null, requests integer not null);
alter table admin_private.marketing_lead_limits enable row level security;
revoke all on admin_private.marketing_lead_limits from public,anon,authenticated;
create function public.marketing_submit_lead(p_lead jsonb,p_rate_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result_id uuid; counter integer;
begin
 if p_rate_key !~ '^[a-f0-9]{64}$' or pg_column_size(p_lead)>14000 then raise exception 'Invalid request' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_lead->>'request_id',0));
 select id into result_id from public.marketing_leads where request_id=(p_lead->>'request_id')::uuid;
 if result_id is not null then return jsonb_build_object('id',result_id,'duplicate',true);end if;
 delete from admin_private.marketing_lead_limits where window_start<now()-interval '1 day';
 insert into admin_private.marketing_lead_limits values(p_rate_key,now(),1)
 on conflict(rate_key) do update set requests=case when marketing_lead_limits.window_start<now()-interval '1 hour' then 1 else marketing_lead_limits.requests+1 end,
 window_start=case when marketing_lead_limits.window_start<now()-interval '1 hour' then now() else marketing_lead_limits.window_start end returning requests into counter;
 if counter>5 then raise exception 'Rate limited' using errcode='54000';end if;
 insert into public.marketing_leads(request_id,name,email,phone,company,website,service,budget,message,source_page,utm)
 values((p_lead->>'request_id')::uuid,p_lead->>'name',p_lead->>'email',coalesce(p_lead->>'phone',''),coalesce(p_lead->>'company',''),coalesce(p_lead->>'website',''),p_lead->>'service',coalesce(p_lead->>'budget',''),p_lead->>'message',p_lead->>'source_page',coalesce(p_lead->'utm','{}')) returning id into result_id;
 return jsonb_build_object('id',result_id,'duplicate',false);
end $$;
revoke all on function public.marketing_submit_lead(jsonb,text) from public,anon,authenticated;
grant execute on function public.marketing_submit_lead(jsonb,text) to service_role;
create function public.marketing_crm_result(p_id uuid,p_delivered boolean) returns void language sql security definer set search_path='' as $$
 update public.marketing_leads set crm_status=case when p_delivered then 'delivered' else 'failed' end,crm_attempted_at=now() where id=p_id;
$$;
revoke all on function public.marketing_crm_result(uuid,boolean) from public,anon,authenticated;
grant execute on function public.marketing_crm_result(uuid,boolean) to service_role;
