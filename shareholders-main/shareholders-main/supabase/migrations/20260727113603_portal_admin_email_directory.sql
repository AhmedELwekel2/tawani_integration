-- =====================================================================
-- Single source of truth for "who is a portal admin".
--
-- There is no admins table: admin identity lives in auth.users as
-- raw_app_meta_data->>'portal_admin'. service_role has NO select on
-- auth.users (RLS is enabled there) but postgres does, hence
-- SECURITY DEFINER owned by postgres.
--
-- This returns admin EMAIL ADDRESSES, so it must never be callable by
-- anon/authenticated. Postgres grants EXECUTE to PUBLIC by default on
-- new functions, so the REVOKE below is mandatory, not decorative.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_portal_admin_emails()
RETURNS TABLE (user_id uuid, email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  -- Belt and braces: the codebase carries two definitions of "admin"
  -- (the portal_admin flag, and "email is not @internal.local" used by
  -- the admin-portal-users function). Requiring both means an account
  -- created straight from the Supabase dashboard -- real email, no flag
  -- -- is excluded here, matching RLS, which would reject it anyway.
  --
  -- Deliberately no ::boolean cast: it raises 22P02 on any non-boolean
  -- string and would take the entire lookup down.
  SELECT u.id, lower(btrim(u.email))
  FROM auth.users u
  WHERE (
          u.raw_app_meta_data -> 'portal_admin' = 'true'::jsonb
          OR lower(u.raw_app_meta_data ->> 'portal_admin') = 'true'
        )
    AND u.email IS NOT NULL
    AND btrim(u.email) <> ''
    AND u.email NOT LIKE '%@internal.local'
    AND u.deleted_at IS NULL
    AND (u.banned_until IS NULL OR u.banned_until < now())
$function$;

ALTER FUNCTION public.get_portal_admin_emails() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_portal_admin_emails() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_portal_admin_emails() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_portal_admin_emails() TO service_role;

COMMENT ON FUNCTION public.get_portal_admin_emails() IS
  'Portal admin recipients for automated notifications. SECURITY DEFINER over auth.users; service_role only.';
