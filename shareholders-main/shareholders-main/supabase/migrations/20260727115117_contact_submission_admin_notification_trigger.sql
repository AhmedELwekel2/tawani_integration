-- =====================================================================
-- Email all portal admins when a Contact Us form is submitted.
--
-- AFTER INSERT ... FOR EACH ROW is correct here: contact_submissions rows
-- are complete on insert (both the Flutter app and the web portal do a
-- single INSERT), and the BEFORE INSERT trigger
-- contact_submissions_enforce_limits has already trimmed, validated and
-- rate-limited the row by this point.
--
-- The handler swallows every exception: a notification failure must never
-- prevent a shareholder from contacting the cooperative.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.notify_admin_contact_submission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  perform public.notify_admin_submission('contact_submission', new.id);
  return new;
exception
  when others then
    raise log 'notify_admin_contact_submission: %', sqlerrm;
    return new; -- never block the submission
end;
$function$;

ALTER FUNCTION public.notify_admin_contact_submission() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.notify_admin_contact_submission() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_admin_contact_submission() FROM anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_admin_contact ON public.contact_submissions;
CREATE TRIGGER trg_notify_admin_contact
AFTER INSERT ON public.contact_submissions
FOR EACH ROW
EXECUTE FUNCTION public.notify_admin_contact_submission();
