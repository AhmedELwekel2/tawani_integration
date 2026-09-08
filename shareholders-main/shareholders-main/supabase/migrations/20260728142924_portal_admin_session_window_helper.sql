-- !! SUPERSEDED BY 20260728160910_fix_is_portal_admin_execute_privilege.sql !!
-- The REVOKE below, combined with is_portal_admin() being SECURITY INVOKER,
-- caused `ERROR: 42501: permission denied for function portal_admin_session_active`
-- for EVERY authenticated user on all three apps. portal_admin_session_active()
-- no longer exists; the session check now lives inside is_portal_admin(), which
-- is SECURITY DEFINER. Kept here as a record of what was applied.

-- Server-side session lifetime for portal admins ONLY.
--
-- NOTE: superseded ~13 minutes later by 20260728143133, which removes the idle
-- clause below. Kept as a record of what was applied. See that file for why.
--
-- Why not Supabase's project-wide "time-box user sessions" / "inactivity timeout":
-- this Supabase project also serves the stockholder web portal and a *shipped*
-- Flutter app (v1.0.0+4). Neither has an onAuthStateChange listener, and the
-- mobile app has no refresh-failure path -- a project-wide timeout would strand
-- them in a logged-in-looking app whose every query 401s, recoverable only via a
-- paid, rate-limited SMS OTP re-login. Scoping the window to is_portal_admin()
-- gives the admin panel a real, unbypassable session limit while leaving the
-- stockholder code paths (current_national_id / current_stockholder_id) untouched.

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
      -- refreshed_at is `timestamp without time zone` (UTC) while created_at is
      -- timestamptz; the cast is required. NULL means "never refreshed", so fall
      -- back to creation time.
      AND COALESCE(s.refreshed_at AT TIME ZONE 'utc', s.created_at) > now() - interval '75 minutes'
  );
$$;

COMMENT ON FUNCTION public.portal_admin_session_active() IS
  'True when the caller''s JWT maps to an auth.sessions row inside the admin session window (12h absolute / 75min idle). Used only by is_portal_admin().';

-- Not part of the public API surface; only reachable through is_portal_admin().
REVOKE EXECUTE ON FUNCTION public.portal_admin_session_active() FROM public, anon, authenticated;
