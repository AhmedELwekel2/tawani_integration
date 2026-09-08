-- P0 FIX for a regression introduced earlier today by 20260728142924 /
-- 20260728143133 / 20260728143338.
--
-- Those migrations put the admin session-window check in a separate helper,
-- public.portal_admin_session_active(), and revoked EXECUTE on it from
-- anon/authenticated -- while leaving is_portal_admin() as SECURITY INVOKER
-- calling it. Postgres checks EXECUTE on the inner function AS THE CALLING ROLE,
-- during expression initialisation, before any AND short-circuiting. And the
-- planner will not inline is_portal_admin() because `SET search_path = ''`
-- gives it a non-null proconfig, so the body really does run via fmgr_sql as
-- the caller.
--
-- Result: every `authenticated` caller hit
--     ERROR: 42501: permission denied for function portal_admin_session_active
-- on all 33 policies across 12 tables that reference is_portal_admin() --
-- including the stockholder-facing ones, because they are all shaped
-- `is_portal_admin() OR <stockholder-scoped>` and the privilege check fires
-- regardless of which branch would have won. That broke the mobile app, the
-- investor portal and the admin panel simultaneously.
--
-- Fix: fold the session check back into is_portal_admin() and make that
-- function SECURITY DEFINER, so the body -- including the auth.sessions read --
-- runs as the owner. Then drop the helper, so the trap cannot be re-introduced.
--
-- auth.jwt() reads current_setting('request.jwt.claims'), which is request-scoped
-- and completely unaffected by SECURITY DEFINER, so admin gating is unchanged:
-- the caller still cannot influence which claims are seen.
--
-- Lesson for future migrations: simulating claims with set_config() while
-- connected as the function owner does NOT exercise the ACL path. Always verify
-- with `SET LOCAL ROLE authenticated`.

CREATE OR REPLACE FUNCTION public.is_portal_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER          -- required: `authenticated` cannot read auth.sessions
SET search_path = ''
AS $$
  SELECT COALESCE((auth.jwt() -> 'app_metadata' ->> 'portal_admin')::boolean, false)
     AND EXISTS (
       SELECT 1
       FROM auth.sessions s
       WHERE s.id = NULLIF(auth.jwt() ->> 'session_id', '')::uuid
         AND s.created_at > now() - interval '12 hours'
     );
$$;

COMMENT ON FUNCTION public.is_portal_admin() IS
  'Admin authorisation: requires the portal_admin JWT claim AND a session younger than 12 hours. SECURITY DEFINER so the auth.sessions read works for the `authenticated` role. The 60-minute idle timeout is enforced client-side in the admin panel. Stockholder access does not use this function.';

-- No longer referenced; removing it prevents the SECURITY INVOKER -> revoked
-- helper trap from coming back.
DROP FUNCTION IF EXISTS public.portal_admin_session_active();

-- Verified after applying, as the real role (not as owner):
--   set local role authenticated; select public.is_portal_admin();          -> false, no error
--   set local role authenticated; select count(*) from public.stockholders; -> 1 (own row, scoped)
--   admin claims + 2h session  -> true
--   admin claims + 13h session -> false
--   stockholder claims         -> false
--   no session_id claim        -> false
