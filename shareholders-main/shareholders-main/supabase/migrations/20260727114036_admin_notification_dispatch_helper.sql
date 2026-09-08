-- =====================================================================
-- Fire-and-forget dispatch to the send-admin-notification edge function.
--
-- Mirrors public.notify_push(): Vault-held bearer token + net.http_post,
-- with a catch-all EXCEPTION handler so a dispatch failure can NEVER
-- abort the caller's INSERT.
--
-- Only the identifier crosses the wire -- no PII -- because
-- net.http_request_queue is readable by anon/authenticated.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.notify_admin_submission(p_event text, p_record_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_key text;
begin
  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'edge_service_role_key'
  limit 1;

  if v_key is null then
    raise log 'notify_admin_submission: edge_service_role_key missing, skipping % %', p_event, p_record_id;
    return;
  end if;

  perform net.http_post(
    url := 'https://fyjtgjetqwqpqsisymql.supabase.co/functions/v1/send-admin-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := jsonb_build_object(
      'event', p_event,
      'record_id', p_record_id
    ),
    -- pg_net defaults to 5000ms; the SMTP fan-out needs headroom.
    timeout_milliseconds := 30000
  );
exception
  when others then
    raise log 'notify_admin_submission: dispatch error for % %: %', p_event, p_record_id, sqlerrm;
end;
$function$;

ALTER FUNCTION public.notify_admin_submission(text, uuid) OWNER TO postgres;

-- SECURITY DEFINER with Vault access: nobody but the trigger functions may call
-- this. Leaving the default PUBLIC grant would let any authenticated user drive
-- arbitrary authenticated POSTs at the edge function.
REVOKE ALL ON FUNCTION public.notify_admin_submission(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_admin_submission(text, uuid) FROM anon, authenticated;

COMMENT ON FUNCTION public.notify_admin_submission(text, uuid) IS
  'Dispatches an admin notification email via the send-admin-notification edge function. Never raises.';
