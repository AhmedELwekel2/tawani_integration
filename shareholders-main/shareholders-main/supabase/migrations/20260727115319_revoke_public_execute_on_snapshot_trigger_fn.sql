-- The security linter flags this as "Public Can Execute SECURITY DEFINER
-- Function": Postgres grants EXECUTE to PUBLIC by default, so it was exposed
-- at /rest/v1/rpc/snapshot_feedback_stockholder. It is a trigger function and
-- has no business being callable directly by anyone.
REVOKE ALL ON FUNCTION public.snapshot_feedback_stockholder() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.snapshot_feedback_stockholder() FROM anon, authenticated;
