import React, { useState, useEffect, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, AlertCircle, Sparkles, Loader2 } from 'lucide-react';
import { Button } from './ui/button';
import {
  getFeedbackQuestions,
  submitSurveyResponse,
  type FeedbackQuestion,
  type SurveyAnswer,
} from '../services/feedbackService';
import { useAuth } from '../context/AuthContext';
import { translateError } from '../utils/errorUtils';

import './Feedback.css';

// ─── Rating Question Row ──────────────────────────────────────────────────────
interface RatingRowProps {
  question: FeedbackQuestion;
  value: number;
  onChange: (v: number) => void;
  lang: string;
}
const RatingRow: React.FC<RatingRowProps> = ({ question, value, onChange, lang }) => {
  const { t } = useTranslation();
  const questionText =
    lang === 'ar' || !question.question_en ? question.question_ar : question.question_en;

  return (
    <div className="survey-question-card">
      <p className="survey-question-text">
        <span className="survey-required">*</span> {questionText}
      </p>
      <div className="survey-rating-row">
        <span className="survey-rating-end-label">{t('feedback.survey.dissatisfied')}</span>
        <div className="survey-radio-group">
          {[1, 2, 3, 4, 5].map((v) => (
            <label
              key={v}
              className={`survey-radio-label ${value === v ? 'selected' : ''}`}
              title={t(`feedback.survey.ratingLabels.${v}`)}
            >
              <input
                type="radio"
                name={`q-${question.id}`}
                value={v}
                checked={value === v}
                onChange={() => onChange(v)}
                className="survey-radio-input"
              />
              <span className="survey-radio-number">{v}</span>
            </label>
          ))}
        </div>
        <span className="survey-rating-end-label">{t('feedback.survey.verySatisfied')}</span>
      </div>
    </div>
  );
};

// ─── Text Question ────────────────────────────────────────────────────────────
interface TextRowProps {
  question: FeedbackQuestion;
  value: string;
  onChange: (v: string) => void;
  lang: string;
}
const TextRow: React.FC<TextRowProps> = ({ question, value, onChange, lang }) => {
  const { t } = useTranslation();
  const questionText =
    lang === 'ar' || !question.question_en ? question.question_ar : question.question_en;
  const placeholder = t('feedback.survey.placeholder');

  return (
    <div className="survey-question-card">
      <p className="survey-question-text">
        <span className="survey-required">*</span> {questionText}
      </p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="survey-textarea"
      />
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────
const FeedbackComponent: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { stockholder, subscriberId } = useAuth();
  const lang = i18n.language;

  const [questions, setQuestions] = useState<FeedbackQuestion[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState(true);
  const [questionError, setQuestionError] = useState('');

  // answers: map questionId → {rating_value?, text_value?}
  const [answers, setAnswers] = useState<Record<string, SurveyAnswer>>({});

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');


  // Load questions on mount
  useEffect(() => {
    const load = async () => {
      try {
        setLoadingQuestions(true);
        const qs = await getFeedbackQuestions();
        setQuestions(qs);
        // Initialize answers
        const init: Record<string, SurveyAnswer> = {};
        qs.forEach((q) => {
          init[q.id] = { question_id: q.id };
        });
        setAnswers(init);
      } catch {
        setQuestionError(t('feedback.errors.failedToLoad'));
      } finally {
        setLoadingQuestions(false);
      }
    };
    load();
  }, [t]);

  // Group questions by category
  const grouped = questions.reduce<Record<string, FeedbackQuestion[]>>((acc, q) => {
    const cat = q.category_ar ?? t('feedback.survey.categoryGeneral');
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(q);
    return acc;
  }, {});

  const setRating = (questionId: string, v: number) => {
    setAnswers((prev) => ({ ...prev, [questionId]: { ...prev[questionId], rating_value: v } }));
  };

  const setText = (questionId: string, v: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: { ...prev[questionId], text_value: v } }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate all rating questions answered
    const unanswered = questions.filter(
      (q) => q.question_type === 'rating' && !answers[q.id]?.rating_value
    );
    if (unanswered.length > 0) {
      setStatus('error');
      setErrorMessage(t('feedback.errors.unansweredRating', { count: unanswered.length }));
      return;
    }

    setIsSubmitting(true);
    setStatus('idle');

    try {
      const answerList = Object.values(answers);
      await submitSurveyResponse(stockholder?.id?.toString(), answerList, subscriberId ?? undefined);
      setStatus('success');
    } catch (err) {
      setStatus('error');
      setErrorMessage(
        translateError(err instanceof Error ? err.message : t('feedback.errors.failedToSubmit'), t)
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Loading state
  if (loadingQuestions) {
    return (
      <div className="survey-loading">
        <Loader2 className="survey-spinner" />
        <p>{t('feedback.survey.loading')}</p>
      </div>
    );
  }

  if (questionError) {
    return (
      <div className="survey-error-state">
        <AlertCircle className="w-8 h-8" />
        <p>{questionError}</p>
      </div>
    );
  }

  // ── Success state
  if (status === 'success') {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="survey-success"
      >
        <div className="survey-success-icon">
          <Sparkles className="w-10 h-10" />
        </div>
        <h2>{t('feedback.survey.success.title')}</h2>
        <p>{t('feedback.survey.success.message')}</p>
        <Button
          onClick={() => {
            setStatus('idle');
            const reset: Record<string, SurveyAnswer> = {};
            questions.forEach((q) => { reset[q.id] = { question_id: q.id }; });
            setAnswers(reset);
          }}
          variant="outline"
          className="survey-success-btn"
        >
          {t('feedback.survey.success.submitAnother')}
        </Button>
      </motion.div>
    );
  }

  // ── Survey form
  return (
    <div className="survey-wrapper">
      {/* Header */}
      <div className="survey-header">
        <div className="survey-header-icon">
          <MessageSquare className="w-5 h-5" />
        </div>
        <div>
          <h2 className="survey-title">{t('feedback.survey.title')}</h2>
          <p className="survey-subtitle">{t('feedback.survey.subtitle')}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="survey-form">
        {/* Grouped sections */}
        {Object.entries(grouped).map(([categoryAr, qs]) => {
          const categoryLabel =
            lang === 'ar'
              ? categoryAr
              : (qs[0]?.category_en ?? categoryAr);
          return (
            <motion.section
              key={categoryAr}
              className="survey-section"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <div className="survey-section-header">
                <h3>{categoryLabel}</h3>
              </div>
              <div className="survey-questions-list">
                {qs.map((q) =>
                  q.question_type === 'rating' ? (
                    <RatingRow
                      key={q.id}
                      question={q}
                      value={answers[q.id]?.rating_value ?? 0}
                      onChange={(v) => setRating(q.id, v)}
                      lang={lang}
                    />
                  ) : (
                    <TextRow
                      key={q.id}
                      question={q}
                      value={answers[q.id]?.text_value ?? ''}
                      onChange={(v) => setText(q.id, v)}
                      lang={lang}
                    />
                  )
                )}
              </div>
            </motion.section>
          );
        })}

        {/* Error banner */}
        <AnimatePresence>
          {status === 'error' && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="survey-error-banner"
            >
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <p>{errorMessage}</p>
            </motion.div>
          )}
        </AnimatePresence>


        {/* Submit */}
        <Button
          type="submit"
          disabled={isSubmitting}
          className="survey-submit-btn h-auto"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin me-2" />
              {t('feedback.survey.submitting')}
            </>
          ) : (
            t('feedback.survey.submit')
          )}
        </Button>
      </form>


    </div>
  );
};

export const Feedback = memo(FeedbackComponent);
