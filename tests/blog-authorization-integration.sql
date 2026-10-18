-- Run only inside BEGIN/ROLLBACK. All temporary article changes are discarded.
do $test$
declare boss uuid; employee uuid; post_id uuid; n integer; denied boolean;
begin
 select p.id into boss from public.employee_profiles p join public.blog_authors a on a.id=p.id where p.role='Co-CEO' and p.is_active limit 1;
 select p.id into employee from public.employee_profiles p where p.role='Employee' and p.is_active limit 1;
 if boss is null or employee is null then raise exception 'Existing authorized/unauthorized profiles required';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',boss,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 insert into public.blog_posts(title,slug,content,excerpt,status) values('Rollback QA draft','rollback-qa-'||gen_random_uuid(),'Temporary rollback-only content','Temporary rollback-only excerpt','draft') returning id into post_id;
 execute 'reset role';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',employee,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 if public.blog_current_role() is not null then raise exception 'Employee unexpectedly authorized';end if;
 select count(*) into n from public.blog_posts p where p.id=post_id;if n<>0 then raise exception 'Draft leaked to employee';end if;
 denied:=false;begin insert into public.blog_posts(title,slug,content,excerpt,status) values('Denied draft','denied-'||gen_random_uuid(),'Denied','Denied','draft');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Unauthorized insert allowed';end if;
 update public.blog_posts set title='Unauthorized change' where id=post_id;get diagnostics n=row_count;if n<>0 then raise exception 'Unauthorized update';end if;
 delete from public.blog_posts where id=post_id;get diagnostics n=row_count;if n<>0 then raise exception 'Unauthorized delete';end if;
 execute 'reset role';execute 'set local role anon';
 select count(*) into n from public.blog_posts p where p.id=post_id;if n<>0 then raise exception 'Draft leaked to anonymous';end if;
 execute 'reset role';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',boss,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 delete from public.blog_posts p where p.id=post_id;get diagnostics n=row_count;if n<>1 then raise exception 'Authorized draft delete denied';end if;
 execute 'reset role';
end $test$;
