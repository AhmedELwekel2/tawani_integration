-- !! SUPERSEDED BY 20260728160910_fix_is_portal_admin_execute_privilege.sql !!
-- The REVOKE below, combined with is_portal_admin() being SECURITY INVOKER,
-- caused `ERROR: 42501: permission denied for function portal_admin_session_active`
-- for EVERY authenticated user on all three apps. portal_admin_session_active()
-- no longer exists; the session check now lives inside is_portal_admin(), which
-- is SECURITY DEFINER. Kept here as a record of what was applied.

-- Correction to the previous migration (20260728142924).
--
-- The first version also enforced a 75-minute *idle* window server-side, using
-- auth.sessions.refreshed_at as a proxy for "the client is still around".
-- Measured against this project's real refresh history that proxy is far too
-- coarse: the gap between consecutive refresh tokens has a median of 1h40m,
-- a p95 of 3h50m and a maximum of 5h17m (jwt expiry is 60 minutes, but
-- supabase-js refreshes lazily, not on a strict timer). An admin actively
-- working would have been signed out mid-task whenever their token happened
-- not to refresh.
--
-- So the split is:
--   * absolute 12h cap -> enforced HERE, server-side, unbypassable. This is what
--     kills the reported bug (sessions were surviving 19+ days), and it bounds
--     the damage from a stolen token no matter what the browser does.
--   * 60-minute idle   -> enforced in the browser (src/services/sessionPolicy.ts
--     in the admin-panel repo), where real user activity is actually observable.
--     It is a UX/policy control, not a security boundary; the 12h cap above is
--     the security boundary.

CREATE OR REPLACE FUNCTION public.portal_admin_session_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER          -- `authenticated` cannot read auth.sessions directly
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.sessions s
    WHERE s.id = NULLIF(auth.jwt() ->> 'session_id', '')::uuid
      AND s.created_at > now() - interval '12 hours'
  );
$$;

COMMENT ON FUNCTION public.portal_admin_session_active() IS
  'True when the caller''s JWT maps to an auth.sessions row created within the last 12 hours. Absolute admin session cap; the 60-minute idle timeout is enforced client-side. Used only by is_portal_admin().';

REVOKE EXECUTE ON FUNCTION public.portal_admin_session_active() FROM public, anon, authenticated;
