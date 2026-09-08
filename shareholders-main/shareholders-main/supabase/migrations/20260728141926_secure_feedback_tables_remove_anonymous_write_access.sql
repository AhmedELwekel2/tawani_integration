-- Finding #1 (CRITICAL): feedback_questions/answers/responses carried RLS policies
-- granted to role `public` with USING(true)/WITH CHECK(true), and `anon` held
-- INSERT/UPDATE/DELETE grants. Because the publishable key ships in the admin JS
-- bundle, the investor-portal bundle and the Flutter app's .env asset, ANY
-- unauthenticated caller could wipe every survey response and answer, and
-- insert/update/delete survey questions.
--
-- Legitimate access, verified against all three clients:
--   * admin panel  : full CRUD on feedback_questions; read-only on responses/answers
--   * investor web : SELECT questions; INSERT responses+answers as the signed-in stockholder
--   * flutter app  : identical to investor web
-- Nothing anywhere deletes responses or answers, so those policies are dropped
-- outright rather than re-scoped.

BEGIN;

-- 1. Drop the permissive policies.
DROP POLICY IF EXISTS questions_write_all   ON public.feedback_questions;
DROP POLICY IF EXISTS answers_delete_all    ON public.feedback_answers;
DROP POLICY IF EXISTS responses_delete_all  ON public.feedback_responses;

-- 2. Survey questions: admins write, everyone reads.
--    questions_read_all (SELECT, public, true) is intentionally left in place --
--    the portal and app fetch the questionnaire before the user signs in.
CREATE POLICY "Portal admins can insert survey questions"
  ON public.feedback_questions FOR INSERT TO authenticated
  WITH CHECK (public.is_portal_admin());

CREATE POLICY "Portal admins can update survey questions"
  ON public.feedback_questions FOR UPDATE TO authenticated
  USING (public.is_portal_admin())
  WITH CHECK (public.is_portal_admin());

CREATE POLICY "Portal admins can delete survey questions"
  ON public.feedback_questions FOR DELETE TO authenticated
  USING (public.is_portal_admin());

-- 3. Responses/answers: admins may delete (moderation); stockholders never can.
--    Their INSERT + SELECT policies already exist and are correctly scoped to
--    app_metadata.stockholder_id, so they are left untouched.
CREATE POLICY "Portal admins can delete feedback responses"
  ON public.feedback_responses FOR DELETE TO authenticated
  USING (public.is_portal_admin());

CREATE POLICY "Portal admins can delete feedback answers"
  ON public.feedback_answers FOR DELETE TO authenticated
  USING (public.is_portal_admin());

-- 4. Remove the underlying grants so anon cannot reach these paths even if a
--    future policy is written carelessly. anon keeps SELECT on questions only.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.feedback_questions  FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, SELECT ON public.feedback_answers   FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, SELECT ON public.feedback_responses FROM anon;

-- Stockholders submit once; they never edit or remove submitted feedback.
REVOKE UPDATE, TRUNCATE ON public.feedback_answers   FROM authenticated;
REVOKE UPDATE, TRUNCATE ON public.feedback_responses FROM authenticated;
REVOKE TRUNCATE          ON public.feedback_questions FROM authenticated;

COMMIT;
