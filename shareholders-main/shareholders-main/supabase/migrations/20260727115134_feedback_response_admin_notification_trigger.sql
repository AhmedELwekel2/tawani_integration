-- =====================================================================
-- Email all portal admins when a shareholder submits the survey.
--
-- WHY THIS TRIGGER IS ON feedback_answers AND NOT feedback_responses:
-- submission is TWO separate, non-atomic PostgREST calls -- insert the
-- response, read back its id, then bulk-insert every answer. A trigger on
-- feedback_responses would therefore fire before a single answer existed
-- and the email would be empty. Both clients bulk-insert all answers in
-- ONE statement, so a statement-level trigger here fires exactly once per
-- submission.
-- =====================================================================

-- Idempotency marker. Nullable, so both clients' INSERTs and the admin
-- panel's select('*') are unaffected.
ALTER TABLE public.feedback_responses
  ADD COLUMN IF NOT EXISTS admin_notified_at timestamptz;

COMMENT ON COLUMN public.feedback_responses.admin_notified_at IS
  'Set when the admin notification email was dispatched. Guards against duplicate sends.';

-- Backfill BEFORE creating the trigger, so re-inserting answers against a
-- pre-existing response can never trigger a retroactive blast.
UPDATE public.feedback_responses
   SET admin_notified_at = submitted_at
 WHERE admin_notified_at IS NULL;

CREATE OR REPLACE FUNCTION public.notify_admin_feedback_answers()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  r record;
begin
  -- Atomically CLAIM each response: the UPDATE row-locks, and the
  -- `admin_notified_at is null` predicate means a second statement for the
  -- same response (a client that splits its insert, or a retry) claims
  -- nothing and therefore sends nothing.
  --
  -- Note: `for r in update ... returning` is NOT valid plpgsql -- the
  -- data-modifying statement must be wrapped in a CTE inside a select.
  for r in
    with claimed as (
      update public.feedback_responses fr
         set admin_notified_at = now()
       where fr.id in (select distinct n.response_id from new_rows n)
         and fr.admin_notified_at is null
      returning fr.id
    )
    select id from claimed
  loop
    perform public.notify_admin_submission('feedback_response', r.id);
  end loop;

  return null;
exception
  when others then
    raise log 'notify_admin_feedback_answers: %', sqlerrm;
    return null; -- never block the submission
end;
$function$;

ALTER FUNCTION public.notify_admin_feedback_answers() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.notify_admin_feedback_answers() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_admin_feedback_answers() FROM anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_admin_feedback ON public.feedback_answers;
CREATE TRIGGER trg_notify_admin_feedback
AFTER INSERT ON public.feedback_answers
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.notify_admin_feedback_answers();
