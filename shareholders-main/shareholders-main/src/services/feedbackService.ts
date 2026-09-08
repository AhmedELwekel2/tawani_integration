import { supabaseClient } from './supabaseClient';
import { logger } from '../utils/logger';

export interface FeedbackQuestion {
  id: string;
  question_ar: string;
  question_en: string | null;
  question_type: 'rating' | 'text';
  category_ar: string | null;
  category_en: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface SurveyAnswer {
  question_id: string;
  rating_value?: number;
  text_value?: string;
}

/**
 * Fetch all active survey questions ordered by sort_order
 */
export const getFeedbackQuestions = async (): Promise<FeedbackQuestion[]> => {
  const { data, error } = await supabaseClient
    .from('feedback_questions')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error) {
    logger.error('Error fetching feedback questions:', error);
    throw error;
  }
  return (data as FeedbackQuestion[]) || [];
};

/**
 * Submits a full survey response with all answers.
 *
 * Subscribers get the same notes section as shareholders, so exactly one of the
 * two ids is set -- whichever directory the submitter came from.
 */
export const submitSurveyResponse = async (
  stockholderId: string | undefined,
  answers: SurveyAnswer[],
  subscriberId?: string
): Promise<void> => {
  try {
    // Calculate overall rating from rating-type answers
    const ratingAnswers = answers.filter((a) => a.rating_value !== undefined);
    const overallRating =
      ratingAnswers.length > 0
        ? ratingAnswers.reduce((sum, a) => sum + (a.rating_value ?? 0), 0) / ratingAnswers.length
        : null;

    // Insert response
    const { data: responseData, error: responseError } = await supabaseClient
      .from('feedback_responses')
      .insert({
        stockholder_id: stockholderId ?? null,
        subscriber_id: subscriberId ?? null,
        overall_rating: overallRating,
      })
      .select('id')
      .single();

    if (responseError) throw responseError;
    const responseId = responseData.id;

    // Insert answers
    const answerRows = answers.map((a) => ({
      response_id: responseId,
      question_id: a.question_id,
      rating_value: a.rating_value ?? null,
      text_value: a.text_value ?? null,
    }));

    const { error: answersError } = await supabaseClient
      .from('feedback_answers')
      .insert(answerRows);

    if (answersError) throw answersError;
  } catch (err) {
    logger.error('Error submitting survey response:', err);
    throw err;
  }
};

// Legacy — kept for backward compatibility (old feedback table)
interface LegacyFeedbackData {
  stockholder_id?: string;
  rating: number;
  category: string;
  message: string;
}
export const submitFeedback = async (data: LegacyFeedbackData): Promise<void> => {
  try {
    const { error } = await supabaseClient
      .from('feedback')
      .insert([
        {
          stockholder_id: data.stockholder_id,
          rating: data.rating,
          category: data.category,
          message: data.message,
        },
      ]);
    if (error) throw error;
  } catch (err) {
    logger.error('Error submitting feedback:', err);
    throw err;
  }
};
