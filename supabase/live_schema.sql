--
-- PostgreSQL database dump
--

\restrict 6dZMC6POjP5hMIwqZELZTT5BAXtLGMXDdw7CWzPJdfu3spJX1wRhl5oGurDiVB1

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: attendance_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    attendance_date date DEFAULT CURRENT_DATE NOT NULL,
    check_in timestamp with time zone,
    check_out timestamp with time zone,
    status text DEFAULT 'Present'::text NOT NULL,
    working_minutes integer GENERATED ALWAYS AS (
CASE
    WHEN ((check_in IS NOT NULL) AND (check_out IS NOT NULL)) THEN GREATEST(0, (floor((EXTRACT(epoch FROM (check_out - check_in)) / (60)::numeric)))::integer)
    ELSE NULL::integer
END) STORED,
    corrected_by uuid,
    corrected_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT attendance_records_status_check CHECK ((status = ANY (ARRAY['Working'::text, 'Present'::text, 'Completed'::text, 'Late'::text, 'Half Day'::text, 'Leave'::text, 'Absent'::text, 'Holiday'::text, 'Weekend'::text])))
);


--
-- Name: check_in(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_in() RETURNS public.attendance_records
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare r public.attendance_records; s public.company_settings; local_day date; local_time time; is_late boolean;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and active) then raise exception 'Your account is inactive.' using errcode='42501'; end if;
  select * into s from public.company_settings where id=true; local_day := (now() at time zone s.timezone)::date; local_time := (now() at time zone s.timezone)::time;
  if extract(isodow from local_day)::int <> all(s.workdays) then raise exception 'Today is not a configured working day.'; end if;
  if exists(select 1 from public.leave_requests where employee_id=auth.uid() and status='Approved' and local_day between start_date and end_date) then raise exception 'You have approved leave for today.'; end if;
  is_late := local_time > s.workday_start + make_interval(mins=>s.late_after_minutes);
  insert into public.attendance_records(employee_id,attendance_date,check_in,status) values(auth.uid(),local_day,now(),case when is_late then 'Late' else 'Working' end) returning * into r;
  return r;
exception when unique_violation then raise exception 'Today''s attendance record already exists.' using errcode='23505'; end $$;


--
-- Name: check_out(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_out() RETURNS public.attendance_records
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare r public.attendance_records; s public.company_settings; local_day date;
begin select * into s from public.company_settings where id=true; local_day := (now() at time zone s.timezone)::date;
  update public.attendance_records set check_out=now(),status='Completed' where employee_id=auth.uid() and attendance_date=local_day and check_in is not null and check_out is null returning * into r;
  if r.id is null then raise exception 'There is no open attendance record to check out.'; end if; return r; end $$;


--
-- Name: correct_attendance(uuid, timestamp with time zone, timestamp with time zone, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.correct_attendance(record_id uuid, corrected_check_in timestamp with time zone, corrected_check_out timestamp with time zone, corrected_status text) RETURNS public.attendance_records
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare r public.attendance_records;
begin
  if not public.is_admin() then raise exception 'Administrator access is required.' using errcode='42501'; end if;
  if corrected_check_in is null or (corrected_check_out is not null and corrected_check_out < corrected_check_in) then raise exception 'Check-out must be after check-in.'; end if;
  update public.attendance_records set check_in=corrected_check_in, check_out=corrected_check_out, status=corrected_status, corrected_by=auth.uid(), corrected_at=now()
  where id=record_id returning * into r;
  if r.id is null then raise exception 'Attendance record was not found.'; end if;
  insert into public.audit_log(actor_id,target_id,action,metadata) values(auth.uid(),r.employee_id,'attendance_corrected',jsonb_build_object('record_id',record_id));
  return r;
end $$;


--
-- Name: employee_login_email(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.employee_login_email(lookup_employee_id text) RETURNS text
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ select email from public.profiles where upper(employee_id)=upper(trim(lookup_employee_id)) and active limit 1 $$;


--
-- Name: is_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ select exists(select 1 from public.profiles where id=auth.uid() and role='admin' and active) $$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ begin new.updated_at=now(); return new; end $$;


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id bigint NOT NULL,
    actor_id uuid,
    target_id uuid,
    action text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.audit_log ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: company_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_settings (
    id boolean DEFAULT true NOT NULL,
    company_name text DEFAULT 'Linkora Solutions'::text NOT NULL,
    timezone text DEFAULT 'Asia/Karachi'::text NOT NULL,
    workday_start time without time zone DEFAULT '09:00:00'::time without time zone NOT NULL,
    late_after_minutes integer DEFAULT 15 NOT NULL,
    workdays integer[] DEFAULT ARRAY[1, 2, 3, 4, 5] NOT NULL,
    CONSTRAINT company_settings_id_check CHECK (id),
    CONSTRAINT company_settings_late_after_minutes_check CHECK (((late_after_minutes >= 0) AND (late_after_minutes <= 240)))
);


--
-- Name: employee_activity_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_activity_sessions (
    session_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    login_at timestamp with time zone DEFAULT now() NOT NULL,
    logout_at timestamp with time zone,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT employee_activity_sessions_status_check CHECK ((status = ANY (ARRAY['Logged In'::text, 'Logged Out'::text])))
);


--
-- Name: employee_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_profiles (
    id uuid NOT NULL,
    employee_id text NOT NULL,
    full_name text NOT NULL,
    scheme text NOT NULL,
    role text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT employee_profiles_role_check CHECK ((role = ANY (ARRAY['Employee'::text, 'Co-CEO'::text])))
);


--
-- Name: employee_profilesss; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_profilesss (
    id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: employee_profilesss_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.employee_profilesss ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.employee_profilesss_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: leave_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leave_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    leave_type text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    reason text NOT NULL,
    status text DEFAULT 'Pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT leave_requests_check CHECK ((end_date >= start_date)),
    CONSTRAINT leave_requests_status_check CHECK ((status = ANY (ARRAY['Pending'::text, 'Approved'::text, 'Rejected'::text])))
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    employee_id text NOT NULL,
    full_name text NOT NULL,
    email text NOT NULL,
    department text,
    designation text,
    phone text,
    joining_date date,
    active boolean DEFAULT true NOT NULL,
    role text DEFAULT 'employee'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT profiles_role_check CHECK ((role = ANY (ARRAY['employee'::text, 'admin'::text])))
);


--
-- Name: attendance_records attendance_records_employee_id_attendance_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_records
    ADD CONSTRAINT attendance_records_employee_id_attendance_date_key UNIQUE (employee_id, attendance_date);


--
-- Name: attendance_records attendance_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_records
    ADD CONSTRAINT attendance_records_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: company_settings company_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_settings
    ADD CONSTRAINT company_settings_pkey PRIMARY KEY (id);


--
-- Name: employee_activity_sessions employee_activity_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_activity_sessions
    ADD CONSTRAINT employee_activity_sessions_pkey PRIMARY KEY (session_id);


--
-- Name: employee_profiles employee_profiles_employee_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_profiles
    ADD CONSTRAINT employee_profiles_employee_id_key UNIQUE (employee_id);


--
-- Name: employee_profiles employee_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_profiles
    ADD CONSTRAINT employee_profiles_pkey PRIMARY KEY (id);


--
-- Name: employee_profilesss employee_profilesss_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_profilesss
    ADD CONSTRAINT employee_profilesss_pkey PRIMARY KEY (id);


--
-- Name: leave_requests leave_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_requests
    ADD CONSTRAINT leave_requests_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_email_key UNIQUE (email);


--
-- Name: profiles profiles_employee_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_employee_id_key UNIQUE (employee_id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: attendance_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attendance_date_idx ON public.attendance_records USING btree (attendance_date);


--
-- Name: attendance_employee_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attendance_employee_date_idx ON public.attendance_records USING btree (employee_id, attendance_date DESC);


--
-- Name: leaves_employee_dates_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX leaves_employee_dates_idx ON public.leave_requests USING btree (employee_id, start_date, end_date);


--
-- Name: attendance_records attendance_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER attendance_updated_at BEFORE UPDATE ON public.attendance_records FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: leave_requests leaves_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER leaves_updated_at BEFORE UPDATE ON public.leave_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: profiles profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: attendance_records attendance_records_corrected_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_records
    ADD CONSTRAINT attendance_records_corrected_by_fkey FOREIGN KEY (corrected_by) REFERENCES public.profiles(id);


--
-- Name: attendance_records attendance_records_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_records
    ADD CONSTRAINT attendance_records_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: audit_log audit_log_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: audit_log audit_log_target_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_target_id_fkey FOREIGN KEY (target_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: employee_activity_sessions employee_activity_sessions_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_activity_sessions
    ADD CONSTRAINT employee_activity_sessions_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employee_profiles(id) ON DELETE RESTRICT;


--
-- Name: employee_profiles employee_profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_profiles
    ADD CONSTRAINT employee_profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: leave_requests leave_requests_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_requests
    ADD CONSTRAINT leave_requests_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: attendance_records attendance_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attendance_admin ON public.attendance_records FOR DELETE TO authenticated USING (public.is_admin());


--
-- Name: attendance_records attendance_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attendance_read ON public.attendance_records FOR SELECT TO authenticated USING (((employee_id = auth.uid()) OR public.is_admin()));


--
-- Name: attendance_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log audit_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_read ON public.audit_log FOR SELECT TO authenticated USING (public.is_admin());


--
-- Name: company_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: employee_activity_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.employee_activity_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: employee_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.employee_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: employee_profilesss; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.employee_profilesss ENABLE ROW LEVEL SECURITY;

--
-- Name: employee_profiles employees can read their own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "employees can read their own profile" ON public.employee_profiles FOR SELECT TO authenticated USING (((id = auth.uid()) AND (is_active = true)));


--
-- Name: leave_requests leave_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leave_admin ON public.leave_requests FOR DELETE TO authenticated USING (public.is_admin());


--
-- Name: leave_requests leave_admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leave_admin_update ON public.leave_requests FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: leave_requests leave_create; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leave_create ON public.leave_requests FOR INSERT TO authenticated WITH CHECK ((employee_id = auth.uid()));


--
-- Name: leave_requests leave_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leave_insert ON public.leave_requests FOR INSERT TO authenticated WITH CHECK ((employee_id = auth.uid()));


--
-- Name: leave_requests leave_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leave_read ON public.leave_requests FOR SELECT TO authenticated USING (((employee_id = auth.uid()) OR public.is_admin()));


--
-- Name: leave_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_admin ON public.profiles TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: profiles profiles_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_read ON public.profiles FOR SELECT TO authenticated USING (((id = auth.uid()) OR public.is_admin()));


--
-- Name: profiles profiles_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated USING (((id = auth.uid()) OR public.is_admin()));


--
-- Name: profiles profiles_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_update ON public.profiles FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: company_settings settings_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY settings_admin ON public.company_settings FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: company_settings settings_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY settings_read ON public.company_settings FOR SELECT TO authenticated USING (true);


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: TABLE attendance_records; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.attendance_records TO anon;
GRANT ALL ON TABLE public.attendance_records TO authenticated;
GRANT ALL ON TABLE public.attendance_records TO service_role;


--
-- Name: FUNCTION check_in(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.check_in() FROM PUBLIC;
GRANT ALL ON FUNCTION public.check_in() TO authenticated;
GRANT ALL ON FUNCTION public.check_in() TO service_role;


--
-- Name: FUNCTION check_out(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.check_out() FROM PUBLIC;
GRANT ALL ON FUNCTION public.check_out() TO authenticated;
GRANT ALL ON FUNCTION public.check_out() TO service_role;


--
-- Name: FUNCTION correct_attendance(record_id uuid, corrected_check_in timestamp with time zone, corrected_check_out timestamp with time zone, corrected_status text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.correct_attendance(record_id uuid, corrected_check_in timestamp with time zone, corrected_check_out timestamp with time zone, corrected_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.correct_attendance(record_id uuid, corrected_check_in timestamp with time zone, corrected_check_out timestamp with time zone, corrected_status text) TO authenticated;
GRANT ALL ON FUNCTION public.correct_attendance(record_id uuid, corrected_check_in timestamp with time zone, corrected_check_out timestamp with time zone, corrected_status text) TO service_role;


--
-- Name: FUNCTION employee_login_email(lookup_employee_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.employee_login_email(lookup_employee_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.employee_login_email(lookup_employee_id text) TO service_role;


--
-- Name: FUNCTION is_admin(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_admin() TO authenticated;
GRANT ALL ON FUNCTION public.is_admin() TO service_role;


--
-- Name: FUNCTION set_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_updated_at() TO anon;
GRANT ALL ON FUNCTION public.set_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_updated_at() TO service_role;


--
-- Name: TABLE audit_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.audit_log TO anon;
GRANT ALL ON TABLE public.audit_log TO authenticated;
GRANT ALL ON TABLE public.audit_log TO service_role;


--
-- Name: SEQUENCE audit_log_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.audit_log_id_seq TO anon;
GRANT ALL ON SEQUENCE public.audit_log_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.audit_log_id_seq TO service_role;


--
-- Name: TABLE company_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.company_settings TO anon;
GRANT ALL ON TABLE public.company_settings TO authenticated;
GRANT ALL ON TABLE public.company_settings TO service_role;


--
-- Name: TABLE employee_activity_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.employee_activity_sessions TO anon;
GRANT ALL ON TABLE public.employee_activity_sessions TO authenticated;
GRANT ALL ON TABLE public.employee_activity_sessions TO service_role;


--
-- Name: TABLE employee_profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.employee_profiles TO anon;
GRANT ALL ON TABLE public.employee_profiles TO authenticated;
GRANT ALL ON TABLE public.employee_profiles TO service_role;


--
-- Name: TABLE employee_profilesss; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.employee_profilesss TO anon;
GRANT ALL ON TABLE public.employee_profilesss TO authenticated;
GRANT ALL ON TABLE public.employee_profilesss TO service_role;


--
-- Name: SEQUENCE employee_profilesss_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.employee_profilesss_id_seq TO anon;
GRANT ALL ON SEQUENCE public.employee_profilesss_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.employee_profilesss_id_seq TO service_role;


--
-- Name: TABLE leave_requests; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.leave_requests TO anon;
GRANT ALL ON TABLE public.leave_requests TO authenticated;
GRANT ALL ON TABLE public.leave_requests TO service_role;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.profiles TO anon;
GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--

\unrestrict 6dZMC6POjP5hMIwqZELZTT5BAXtLGMXDdw7CWzPJdfu3spJX1wRhl5oGurDiVB1
