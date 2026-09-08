-- Finding #6: audit_log.actor_id / actor_email were supplied by the browser, so a
-- compromised or malicious admin session could forge attribution.
-- Finding #5: get_phone_by_national_id() is SECURITY DEFINER and was executable by
-- anon over REST -> unauthenticated phone lookup / enumeration by national ID.
-- Finding #7: mutable search_path on SECURITY DEFINER-adjacent functions.

BEGIN;

-- 1. Force the actor to come from the verified JWT, never the request body.
--    Service-role inserts (edge functions) have no auth.uid(); leave those as
--    supplied so `Service role can insert audit logs` keeps working.
CREATE OR REPLACE FUNCTION public.audit_log_set_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.actor_id    := auth.uid();
    NEW.actor_email := COALESCE(
      NULLIF(auth.jwt() ->> 'email', ''),
      NEW.actor_email,
      'unknown'
    );
  END IF;
  -- created_at is always server time, never client-controlled.
  NEW.created_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_log_set_actor ON public.audit_log;
CREATE TRIGGER trg_audit_log_set_actor
  BEFORE INSERT ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_set_actor();

-- 2. Append-only: no client may rewrite or erase history.
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_log FROM anon, authenticated;
REVOKE INSERT, SELECT ON public.audit_log FROM anon;

-- 3. Pin search_path on the JWT helper functions (advisor 0011).
ALTER FUNCTION public.current_national_id() SET search_path = '';

-- 4. get_phone_by_national_id is only ever called by the auth-login edge function
--    running as service_role. Take it away from the public API roles.
REVOKE EXECUTE ON FUNCTION public.get_phone_by_national_id(text) FROM anon, authenticated, public;
GRANT  EXECUTE ON FUNCTION public.get_phone_by_national_id(text) TO service_role;

-- 5. notify_push() is a trigger helper; it is never called over REST.
REVOKE EXECUTE ON FUNCTION public.notify_push() FROM anon, authenticated, public;

-- 6. Unused grants on `feedback` (its RLS has no anon policy, so these are already
--    unreachable -- removed as defence in depth).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, SELECT ON public.feedback FROM anon;
REVOKE UPDATE, DELETE, TRUNCATE ON public.feedback FROM authenticated;

COMMIT;
