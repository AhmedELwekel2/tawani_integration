-- !! SUPERSEDED BY 20260728160910_fix_is_portal_admin_execute_privilege.sql !!
-- The REVOKE below, combined with is_portal_admin() being SECURITY INVOKER,
-- caused `ERROR: 42501: permission denied for function portal_admin_session_active`
-- for EVERY authenticated user on all three apps. portal_admin_session_active()
-- no longer exists; the session check now lives inside is_portal_admin(), which
-- is SECURITY DEFINER. Kept here as a record of what was applied.

-- Finding #2 (CRITICAL): admin sessions never expired. Verified in production --
-- a live session created 2026-07-09 was still refreshing 19 days later, and
-- auth.sessions.not_after was NULL for every session on the project.
--
-- is_portal_admin() is the single chokepoint for admin authorisation: 28 RLS
-- policies across 11 tables call it. Adding the session window here bounds every
-- one of them at once, and touches nothing the stockholder portal or the Flutter
-- app depend on (they go through current_national_id / current_stockholder_id,
-- and every shared policy is `is_portal_admin() OR <stockholder-scoped>`, so
-- tightening the admin branch can only ever remove admin access).
--
-- Verified before applying, against real JWT claims simulated via
-- set_config('request.jwt.claims', ...):
--   valid 1h session, refreshed 5m ago            -> true
--   busy admin 11h in, last refresh 4h ago        -> true   (no false logout)
--   13h old session, refreshed 5m ago             -> false  (absolute cap)
--   the real 19-day production session            -> false
--   JWT without a session_id claim                -> false
--   stockholder claims + fresh session            -> false
-- A real access token was also decoded to confirm Supabase emits `session_id`
-- (and that jwt expiry is 60 minutes).

CREATE OR REPLACE FUNCTION public.is_portal_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''      -- advisor 0011; the previous definition was mutable
AS $$
  SELECT COALESCE((auth.jwt() -> 'app_metadata' ->> 'portal_admin')::boolean, false)
     AND public.portal_admin_session_active();
$$;

COMMENT ON FUNCTION public.is_portal_admin() IS
  'Admin authorisation: requires the portal_admin JWT claim AND a session younger than 12 hours. The 60-minute idle timeout is enforced client-side in the admin panel.';
