-- The company schedule is readable by signed-in portal users; only the
-- audited Co-CEO RPC may update it. RLS already denied other writes, and
-- these revocations remove unnecessary table-level grants as well.
revoke select, insert, update, delete on public.company_settings from anon;
revoke insert, update, delete on public.company_settings from authenticated;
