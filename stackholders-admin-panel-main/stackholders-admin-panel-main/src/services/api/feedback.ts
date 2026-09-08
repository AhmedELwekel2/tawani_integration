/** Satisfaction survey: question CRUD, responses and aggregate stats. */

import { supabaseClient } from '../supabaseClient';
import { logAction, AUDIT_ACTIONS } from '../auditService';

export interface FeedbackQuestion {
  id: string;
  question_ar: string;
  question_en: string | null;
  question_type: 'rating' | 'text';
  category_ar: string | null;
  category_en: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface FeedbackResponse {
  id: string;
  stockholder_id: string | null;
  overall_rating: number | null;
  submitted_at: string;
  /**
   * Identity snapshot captured at submission time by the
   * `trg_snapshot_feedback_stockholder` trigger. The FK to stockholders is
   * ON DELETE SET NULL, so these are the only identity left once a
   * stockholder is hard-deleted. Always prefer the live `stockholders`
   * join below when it is present — the snapshot can be stale if the
   * shareholder later renamed themselves.
   */
  stockholder_name_ar: string | null;
  stockholder_name_en: string | null;
  stockholder_national_id: string | null;
  stockholder_email: string | null;
  stockholders?: {
    full_name_en: string | null;
    full_name_ar: string | null;
    email: string | null;
    national_id: string;
  };
}

/** Identity of a survey respondent, resolved across live row + snapshot. */
export interface RespondentIdentity {
  name: string | null;
  nationalId: string | null;
  email: string | null;
  /** Stockholder row is gone, but we still know who submitted it. */
  isDeleted: boolean;
}

export const resolveRespondent = (
  r: FeedbackResponse,
  lang: string
): RespondentIdentity => {
  const live = r.stockholders;
  const name =
    lang === 'ar'
      ? live?.full_name_ar || live?.full_name_en || r.stockholder_name_ar || r.stockholder_name_en
      : live?.full_name_en || live?.full_name_ar || r.stockholder_name_en || r.stockholder_name_ar;

  const hasSnapshot = Boolean(
    r.stockholder_name_ar || r.stockholder_name_en || r.stockholder_national_id || r.stockholder_email
  );

  return {
    name: name || null,
    nationalId: live?.national_id || r.stockholder_national_id || null,
    email: live?.email || r.stockholder_email || null,
    isDeleted: !live && hasSnapshot,
  };
};

export interface FeedbackAnswer {
  id: string;
  response_id: string;
  question_id: string;
  rating_value: number | null;
  text_value: string | null;
  feedback_questions?: FeedbackQuestion;
}

// ---- Questions CRUD ----
export const getSurveyQuestions = async (activeOnly = false): Promise<FeedbackQuestion[]> => {
  let query = supabaseClient
    .from('feedback_questions')
    .select('*')
    .order('sort_order', { ascending: true });
  if (activeOnly) query = query.eq('is_active', true);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data as FeedbackQuestion[]) || [];
};

export const createSurveyQuestion = async (
  q: Omit<FeedbackQuestion, 'id' | 'created_at'>
): Promise<FeedbackQuestion> => {
  const { data, error } = await supabaseClient
    .from('feedback_questions')
    .insert(q)
    .select()
    .single();
  if (error) throw new Error(error.message);
  const result = data as FeedbackQuestion;
  logAction(AUDIT_ACTIONS.CREATE_SURVEY_QUESTION, 'feedback_questions', result.id);
  return result;
};

export const updateSurveyQuestion = async (
  id: string,
  updates: Partial<Omit<FeedbackQuestion, 'id' | 'created_at'>>
): Promise<FeedbackQuestion> => {
  const { data, error } = await supabaseClient
    .from('feedback_questions')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  logAction(AUDIT_ACTIONS.UPDATE_SURVEY_QUESTION, 'feedback_questions', id, { fields: Object.keys(updates) });
  return data as FeedbackQuestion;
};

export const deleteSurveyQuestion = async (id: string): Promise<void> => {
  const { error } = await supabaseClient.from('feedback_questions').delete().eq('id', id);
  if (error) throw new Error(error.message);
  logAction(AUDIT_ACTIONS.DELETE_SURVEY_QUESTION, 'feedback_questions', id);
};

// ---- Responses ----
export const getSurveyResponses = async (): Promise<FeedbackResponse[]> => {
  const { data, error } = await supabaseClient
    .from('feedback_responses')
    .select('*, stockholders (full_name_en, full_name_ar, email, national_id)')
    .order('submitted_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data as FeedbackResponse[]) || [];
};

export const getSurveyAnswers = async (responseId: string): Promise<FeedbackAnswer[]> => {
  const { data, error } = await supabaseClient
    .from('feedback_answers')
    .select('*, feedback_questions (*)')
    .eq('response_id', responseId)
    .order('feedback_questions(sort_order)', { ascending: true });
  if (error) throw new Error(error.message);
  return (data as FeedbackAnswer[]) || [];
};

export const getSurveyStats = async (): Promise<{
  avgRating: number;
  totalResponses: number;
  ratingDistribution: Record<string, number>;
}> => {
  const { data, error } = await supabaseClient
    .from('feedback_responses')
    .select('overall_rating');
  if (error) throw new Error(error.message);

  const withRating = (data || []).filter((r) => r.overall_rating !== null);
  const totalResponses = data?.length ?? 0;
  const avgRating =
    withRating.length > 0
      ? withRating.reduce((s, r) => s + (r.overall_rating as number), 0) / withRating.length
      : 0;

  const ratingDistribution: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  withRating.forEach((r) => {
    const bucket = Math.round(r.overall_rating as number).toString();
    ratingDistribution[bucket] = (ratingDistribution[bucket] ?? 0) + 1;
  });

  return { avgRating, totalResponses, ratingDistribution };
};

// Legacy — kept for backward compatibility (old feedback table)
export interface FeedbackEntry {
  id: string;
  stockholder_id: string | null;
  rating: number;
  category: string;
  message: string | null;
  created_at: string;
  stockholders?: {
    full_name_en: string | null;
    full_name_ar: string | null;
    email: string | null;
  };
}

export const getAllFeedback = async (categoryFilter?: string): Promise<FeedbackEntry[]> => {
  let query = supabaseClient
    .from('feedback')
    .select('*, stockholders (full_name_en, full_name_ar, email)')
    .order('created_at', { ascending: false });
  if (categoryFilter && categoryFilter !== 'all') query = query.eq('category', categoryFilter);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
};

export const getFeedbackStats = async (): Promise<{ avgRating: number; totalCount: number; byCategory: Record<string, number> }> => {
  const { data, error } = await supabaseClient.from('feedback').select('rating, category');
  if (error) throw new Error(error.message);
  const totalCount = data.length;
  const avgRating = totalCount > 0 ? data.reduce((s, i) => s + i.rating, 0) / totalCount : 0;
  const byCategory: Record<string, number> = {};
  data.forEach((i) => { byCategory[i.category] = (byCategory[i.category] || 0) + 1; });
  return { avgRating, totalCount, byCategory };
};
