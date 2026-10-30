-- Keep the existing invoker trigger and grants; resolve now() only in pg_catalog.
-- No application rows, Auth accounts or role assignments are changed.
ALTER FUNCTION public.set_updated_at() SET search_path = pg_catalog;
