-- Run with the new migration inside BEGIN/ROLLBACK before deployment; no test inquiry survives.
do $test$
declare request_id uuid:=gen_random_uuid();result jsonb;lead_id uuid;uid uuid;denied boolean;n integer;i integer;
begin
 result:=public.marketing_submit_lead(jsonb_build_object('request_id',request_id,'name','QA disposable inquiry','email','qa@example.invalid','service','Backlinks','message','Rollback-only acceptance test','source_page','/contact.html','utm',jsonb_build_object('utm_source','qa')),repeat('a',64));lead_id:=(result->>'id')::uuid;
 if not exists(select 1 from public.marketing_leads where id=lead_id and utm->>'utm_source'='qa' and crm_status='pending')then raise exception 'Lead or UTM not saved';end if;
 result:=public.marketing_submit_lead(jsonb_build_object('request_id',request_id),repeat('a',64));if not(result->>'duplicate')::boolean then raise exception 'Idempotent retry duplicated';end if;
 execute 'set local role anon';
 denied:=false;begin perform 1 from public.marketing_leads;exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Anon lead read';end if;
 denied:=false;begin perform public.marketing_submit_lead('{}',repeat('a',64));exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Public submission RPC exposed';end if;
 execute 'reset role';
 select id into uid from public.employee_profiles where role='Employee' and is_active limit 1;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);execute 'set local role authenticated';
 select count(*) into n from public.marketing_leads;if n<>0 then raise exception 'Employee can read leads';end if;
 denied:=false;begin delete from public.marketing_leads where id=lead_id;exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Employee can delete leads';end if;execute 'reset role';
 select id into uid from public.employee_profiles where role='Co-CEO' and is_active limit 1;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);execute 'set local role authenticated';select count(*) into n from public.marketing_leads where id=lead_id;if n<>1 then raise exception 'Co-CEO read denied';end if;execute 'reset role';
 for i in 1..4 loop perform public.marketing_submit_lead(jsonb_build_object('request_id',gen_random_uuid(),'name','QA','email','qa@example.invalid','service','Backlinks','message','Rollback test','source_page','/contact.html'),repeat('a',64));end loop;
 denied:=false;begin perform public.marketing_submit_lead(jsonb_build_object('request_id',gen_random_uuid()),repeat('a',64));exception when program_limit_exceeded then denied:=true;end;if not denied then raise exception 'Rate limit bypass';end if;
 perform public.marketing_crm_result(lead_id,false);if(select crm_status from public.marketing_leads where id=lead_id)<>'failed' then raise exception 'CRM failure not tracked';end if;
end $test$;
