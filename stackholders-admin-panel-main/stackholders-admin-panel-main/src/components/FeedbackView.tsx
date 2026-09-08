import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getSurveyQuestions,
  getSurveyResponses,
  getSurveyAnswers,
  getSurveyStats,
  createSurveyQuestion,
  updateSurveyQuestion,
  deleteSurveyQuestion,
  resolveRespondent,
  type FeedbackQuestion,
  type FeedbackResponse,
  type FeedbackAnswer,
} from '../services/apiService';
import { getFriendlyError } from '../utils/errorHelpers';
import './FeedbackView.css';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const RATING_LABELS: Record<number, string> = {
  1: 'غير راضٍ',
  2: 'غير راضٍ نسبياً',
  3: 'محايد',
  4: 'راضٍ',
  5: 'راضٍ جداً',
};

const RatingBar: React.FC<{ value: number; max?: number }> = ({ value, max = 5 }) => {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const color =
    value >= 4 ? '#10b981' : value >= 3 ? '#f59e0b' : '#ef4444';
  return (
    <div className="fv-rating-bar-container">
      <div className="fv-bar-wrap">
        <div className="fv-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="fv-bar-num" style={{ color }}>
        {value.toFixed(1)}
      </span>
    </div>
  );
};

const Stars: React.FC<{ value: number }> = ({ value }) => {
  const rounded = Math.round(value);
  return (
    <span className="fv-stars">
      {[1, 2, 3, 4, 5].map((s) => (
        <span key={s} className={s <= rounded ? 'fv-star filled' : 'fv-star'}>★</span>
      ))}
    </span>
  );
};

// ─── Response Detail View ─────────────────────────────────────────────────────
interface DetailViewProps {
  response: FeedbackResponse;
  onBack: () => void;
  lang: string;
}
const DetailView: React.FC<DetailViewProps> = ({ response, onBack, lang }) => {
  const [answers, setAnswers] = useState<FeedbackAnswer[]>([]);
  const [loading, setLoading] = useState(true);

  const who = resolveRespondent(response, lang);

  useEffect(() => {
    getSurveyAnswers(response.id)
      .then(setAnswers)
      .finally(() => setLoading(false));
  }, [response.id]);

  // Helper to detect if text is mostly Arabic
  const isArabic = (text: string) => /[\u0600-\u06FF]/.test(text);

  // Group answers by category
  const grouped: { cat: string; items: FeedbackAnswer[] }[] = [];
  answers.forEach((a) => {
    const cat =
      lang === 'ar'
        ? a.feedback_questions?.category_ar ?? (lang === 'ar' ? 'عام' : 'General')
        : a.feedback_questions?.category_en ?? 'General';
    const existing = grouped.find((g) => g.cat === cat);
    if (existing) existing.items.push(a);
    else grouped.push({ cat, items: [a] });
  });

  return (
    <div className="fv-detail-view">
      <div className="fv-detail-header">
        <button className="fv-back-btn" onClick={onBack}>
          {lang === 'ar' ? 'عودة →' : '← Back'}
        </button>
        <div className="fv-detail-header-main">
          <div className="fv-detail-header-info">
            <h2>
              {who.name ??
                (who.isDeleted
                  ? lang === 'ar' ? 'مساهم محذوف' : 'Deleted Shareholder'
                  : lang === 'ar' ? 'مساهم غير معروف' : 'Unknown Shareholder')}
              {who.isDeleted && (
                <span className="fv-deleted-badge">
                  {lang === 'ar' ? 'محذوف' : 'Deleted'}
                </span>
              )}
            </h2>
            <p>
              {who.email ??
                (who.nationalId
                  ? `${lang === 'ar' ? 'رقم الهوية' : 'National ID'}: ${who.nationalId}`
                  : '')}
            </p>
          </div>
          {response.overall_rating && (
            <div className="fv-detail-header-rating">
              <span className="fv-modal-rating-num" style={{
                color: response.overall_rating >= 4 ? '#fbbf24' : response.overall_rating >= 3 ? '#fcd34d' : '#f87171'
              }}>{response.overall_rating.toFixed(1)}/5</span>
              <Stars value={response.overall_rating} />
            </div>
          )}
        </div>
      </div>

      <div className="fv-detail-body">
        {loading ? (
          <div className="fv-modal-loading">
            <div className="fv-spinner" />
            <p>{lang === 'ar' ? 'جاري التحميل...' : 'Loading...'}</p>
          </div>
        ) : (
          grouped.map(({ cat, items }) => (
            <div key={cat} className="fv-modal-section">
              <div className="fv-modal-section-header" dir={isArabic(cat) ? 'rtl' : 'ltr'}>{cat}</div>
              {items.map((a) => {
                const qText =
                  lang === 'ar'
                    ? a.feedback_questions?.question_ar
                    : a.feedback_questions?.question_en ?? a.feedback_questions?.question_ar;
                const qDir = isArabic(qText || '') ? 'rtl' : 'ltr';
                
                return (
                  <div key={a.id} className="fv-modal-answer">
                    <p className="fv-modal-question" dir={qDir} style={{ textAlign: qDir === 'rtl' ? 'right' : 'left' }}>
                      {qText}
                    </p>
                    {a.rating_value !== null ? (
                      <div className="fv-modal-rating-answer" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
                        <div className="fv-rating-pills">
                          {[1, 2, 3, 4, 5].map((v) => (
                            <span
                              key={v}
                              className={`fv-pill ${v === a.rating_value ? 'active' : ''}`}
                            >
                              {v}
                            </span>
                          ))}
                        </div>
                        <span className="fv-rating-label-text">
                          {RATING_LABELS[a.rating_value ?? 0]}
                        </span>
                      </div>
                    ) : (
                      <div className="fv-modal-text-answer-wrap" dir={isArabic(a.text_value || '') ? 'rtl' : 'ltr'}>
                        <p className="fv-modal-text-answer" style={{ textAlign: isArabic(a.text_value || '') ? 'right' : 'left' }}>
                          {a.text_value || <em className="fv-no-answer">{lang === 'ar' ? 'لا توجد إجابة' : 'No answer'}</em>}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

// ─── Question Manager ─────────────────────────────────────────────────────────
interface QuestionManagerProps {
  lang: string;
}
const QuestionManager: React.FC<QuestionManagerProps> = ({ lang }) => {
  const { t } = useTranslation();
  const [questions, setQuestions] = useState<FeedbackQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const emptyForm = {
    question_ar: '',
    question_en: '',
    question_type: 'rating' as 'rating' | 'text',
    category_ar: '',
    category_en: '',
    sort_order: 0,
    is_active: true,
  };
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const qs = await getSurveyQuestions();
      setQuestions(qs);
    } catch (e) {
      setError(getFriendlyError(e, t, 'common.error'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const startEdit = (q: FeedbackQuestion) => {
    setEditId(q.id);
    setForm({
      question_ar: q.question_ar,
      question_en: q.question_en ?? '',
      question_type: q.question_type,
      category_ar: q.category_ar ?? '',
      category_en: q.category_en ?? '',
      sort_order: q.sort_order,
      is_active: q.is_active,
    });
    setShowAdd(false);
  };

  const cancelEdit = () => { setEditId(null); setShowAdd(false); setForm(emptyForm); };

  const handleSave = async () => {
    if (!form.question_ar.trim()) return;
    setSaving(true);
    try {
      if (editId) {
        await updateSurveyQuestion(editId, form);
      } else {
        const maxOrder = questions.reduce((m, q) => Math.max(m, q.sort_order), 0);
        await createSurveyQuestion({ ...form, sort_order: maxOrder + 1 });
      }
      await load();
      cancelEdit();
    } catch (e) {
      setError(getFriendlyError(e, t, 'common.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (q: FeedbackQuestion) => {
    try {
      await updateSurveyQuestion(q.id, { is_active: !q.is_active });
      setQuestions((prev) => prev.map((x) => (x.id === q.id ? { ...x, is_active: !q.is_active } : x)));
    } catch (e) { setError(getFriendlyError(e, t, 'common.error')); }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(lang === 'ar' ? 'هل أنت متأكد من حذف هذا السؤال؟' : 'Delete this question?')) return;
    try {
      await deleteSurveyQuestion(id);
      setQuestions((prev) => prev.filter((q) => q.id !== id));
    } catch (e) { setError(getFriendlyError(e, t, 'common.error')); }
  };

  const moveOrder = async (q: FeedbackQuestion, dir: -1 | 1) => {
    const idx = questions.findIndex((x) => x.id === q.id);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= questions.length) return;
    const swap = questions[swapIdx];
    try {
      await Promise.all([
        updateSurveyQuestion(q.id, { sort_order: swap.sort_order }),
        updateSurveyQuestion(swap.id, { sort_order: q.sort_order }),
      ]);
      await load();
    } catch (e) { setError(getFriendlyError(e, t, 'common.error')); }
  };

  // Form UI shared for add and edit
  const FormPanel = (
    <div className="fv-question-form">
      <div className="fv-question-form-grid">
        <div className="fv-form-field">
          <label>{lang === 'ar' ? 'السؤال بالعربية *' : 'Question (Arabic) *'}</label>
          <textarea
            value={form.question_ar}
            onChange={(e) => setForm((p) => ({ ...p, question_ar: e.target.value }))}
            rows={2}
            dir="rtl"
            placeholder="اكتب السؤال بالعربية..."
          />
        </div>
        <div className="fv-form-field">
          <label>{lang === 'ar' ? 'السؤال بالإنجليزية' : 'Question (English)'}</label>
          <textarea
            value={form.question_en}
            onChange={(e) => setForm((p) => ({ ...p, question_en: e.target.value }))}
            rows={2}
            placeholder="Write question in English..."
          />
        </div>
        <div className="fv-form-field">
          <label>{lang === 'ar' ? 'الفئة بالعربية' : 'Category (Arabic)'}</label>
          <input
            value={form.category_ar}
            onChange={(e) => setForm((p) => ({ ...p, category_ar: e.target.value }))}
            dir="rtl"
            placeholder="مثال: الحوكمة والشفافية"
          />
        </div>
        <div className="fv-form-field">
          <label>{lang === 'ar' ? 'الفئة بالإنجليزية' : 'Category (English)'}</label>
          <input
            value={form.category_en}
            onChange={(e) => setForm((p) => ({ ...p, category_en: e.target.value }))}
            placeholder="e.g. Governance & Transparency"
          />
        </div>
        <div className="fv-form-field">
          <label>{lang === 'ar' ? 'نوع السؤال' : 'Question Type'}</label>
          <select
            value={form.question_type}
            onChange={(e) => setForm((p) => ({ ...p, question_type: e.target.value as 'rating' | 'text' }))}
          >
            <option value="rating">{lang === 'ar' ? 'تقييم (1–5)' : 'Rating (1–5)'}</option>
            <option value="text">{lang === 'ar' ? 'نص مفتوح' : 'Open Text'}</option>
          </select>
        </div>
        <div className="fv-form-field fv-form-active">
          <label>
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))}
            />
            {lang === 'ar' ? ' نشط' : ' Active'}
          </label>
        </div>
      </div>
      <div className="fv-form-actions">
        <button className="fv-btn fv-btn-primary" onClick={handleSave} disabled={saving || !form.question_ar.trim()}>
          {saving ? '...' : editId ? (lang === 'ar' ? 'حفظ التعديلات' : 'Save Changes') : (lang === 'ar' ? 'إضافة السؤال' : 'Add Question')}
        </button>
        <button className="fv-btn fv-btn-ghost" onClick={cancelEdit}>
          {lang === 'ar' ? 'إلغاء' : 'Cancel'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="fv-question-manager">
      <div className="fv-qm-toolbar">
        <h3>{lang === 'ar' ? 'إدارة الأسئلة' : 'Question Manager'} <span className="fv-count-badge">{questions.length}</span></h3>
        {!showAdd && !editId && (
          <button className="fv-btn fv-btn-primary" onClick={() => { setShowAdd(true); setForm(emptyForm); }}>
            + {lang === 'ar' ? 'إضافة سؤال' : 'Add Question'}
          </button>
        )}
      </div>

      {error && <div className="fv-error-banner">{error}</div>}
      {showAdd && FormPanel}

      {loading ? (
        <div className="fv-loading"><div className="fv-spinner" /></div>
      ) : (
        <div className="fv-question-list">
          {questions.map((q, idx) => (
            <div key={q.id} className={`fv-question-row ${!q.is_active ? 'inactive' : ''}`}>
              {editId === q.id ? (
                FormPanel
              ) : (
                <>
                  <div className="fv-question-meta">
                    <span className="fv-q-order">{q.sort_order}</span>
                    <span className={`fv-q-type-badge ${q.question_type}`}>
                      {q.question_type === 'rating' ? '1–5' : (lang === 'ar' ? 'نص' : 'Text')}
                    </span>
                    {!q.is_active && <span className="fv-q-inactive-badge">{lang === 'ar' ? 'مخفي' : 'Hidden'}</span>}
                  </div>
                  <div className="fv-question-text-wrap">
                    <p className="fv-q-ar" dir="rtl">{q.question_ar}</p>
                    {q.question_en && <p className="fv-q-en">{q.question_en}</p>}
                    {q.category_ar && <span className="fv-q-cat">{lang === 'ar' ? q.category_ar : (q.category_en ?? q.category_ar)}</span>}
                  </div>
                  <div className="fv-question-actions">
                    <button className="fv-icon-btn" title="Up" onClick={() => moveOrder(q, -1)} disabled={idx === 0}>↑</button>
                    <button className="fv-icon-btn" title="Down" onClick={() => moveOrder(q, 1)} disabled={idx === questions.length - 1}>↓</button>
                    <button className="fv-icon-btn" title={q.is_active ? (lang === 'ar' ? 'إخفاء' : 'Deactivate') : (lang === 'ar' ? 'تفعيل' : 'Activate')} onClick={() => handleToggleActive(q)}>
                      {q.is_active ? '👁' : '🚫'}
                    </button>
                    <button className="fv-icon-btn edit" title={lang === 'ar' ? 'تعديل' : 'Edit'} onClick={() => startEdit(q)}>✏️</button>
                    <button className="fv-icon-btn delete" title={lang === 'ar' ? 'حذف' : 'Delete'} onClick={() => handleDelete(q.id)}>🗑️</button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Main FeedbackView ────────────────────────────────────────────────────────
const FeedbackView: React.FC = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const locale = lang === 'ar' ? 'ar-SA' : 'en-US';

  const [activeTab, setActiveTab] = useState<'responses' | 'questions'>('responses');
  const [responses, setResponses] = useState<FeedbackResponse[]>([]);
  const [stats, setStats] = useState<{ avgRating: number; totalResponses: number; ratingDistribution: Record<string, number> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<FeedbackResponse | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [resps, st] = await Promise.all([getSurveyResponses(), getSurveyStats()]);
      setResponses(resps);
      setStats(st);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('feedback.loading'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { loadData(); }, [loadData]);

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' });

  if (selected) {
    return (
      <DetailView
        response={selected}
        onBack={() => setSelected(null)}
        lang={lang}
      />
    );
  }

  return (
    <div className="fv-root">
      {/* Page Header */}
      <div className="admin-view-header">
        <h1>{t('feedback.title')}</h1>
      </div>

      {/* Tabs */}
      <div className="fv-tabs">
        <button
          className={`fv-tab ${activeTab === 'responses' ? 'active' : ''}`}
          onClick={() => setActiveTab('responses')}
        >
          {lang === 'ar' ? 'الاستجابات' : 'Responses'}
          {stats && <span className="fv-tab-badge">{stats.totalResponses}</span>}
        </button>
        <button
          className={`fv-tab ${activeTab === 'questions' ? 'active' : ''}`}
          onClick={() => setActiveTab('questions')}
        >
          {lang === 'ar' ? 'إدارة الأسئلة' : 'Question Manager'}
        </button>
      </div>

      {/* ── RESPONSES TAB ── */}
      {activeTab === 'responses' && (
        <div className="fv-responses-tab">
          {/* Stats */}
          {stats && (
            <div className="fv-stats-row">
              <div className="fv-stat-card prime">
                <span className="fv-stat-label">{lang === 'ar' ? 'متوسط التقييم العام' : 'Overall Avg Rating'}</span>
                <div className="fv-stat-val-group">
                  <span className="fv-stat-big" style={{
                    color: stats.avgRating >= 4 ? '#10b981' : stats.avgRating >= 3 ? '#f59e0b' : '#ef4444'
                  }}>{stats.avgRating.toFixed(2)}</span>
                  <Stars value={stats.avgRating} />
                </div>
                <RatingBar value={stats.avgRating} />
              </div>
              <div className="fv-stat-card">
                <span className="fv-stat-label">{lang === 'ar' ? 'إجمالي الاستجابات' : 'Total Responses'}</span>
                <span className="fv-stat-big">{stats.totalResponses}</span>
              </div>
              <div className="fv-stat-card dist-card">
                <span className="fv-stat-label">{lang === 'ar' ? 'توزيع التقييمات' : 'Rating Distribution'}</span>
                <div className="fv-dist">
                  {[5, 4, 3, 2, 1].map((v) => {
                    const count = stats.ratingDistribution[v.toString()] ?? 0;
                    const pct = stats.totalResponses > 0 ? (count / stats.totalResponses) * 100 : 0;
                    return (
                      <div key={v} className="fv-dist-row">
                        <span className="fv-dist-label">{v}★</span>
                        <div className="fv-dist-bar-wrap">
                          <div className="fv-dist-bar-fill" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="fv-dist-count">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {error && <div className="fv-error-banner">{error}</div>}

          {loading ? (
            <div className="fv-loading"><div className="fv-spinner" /></div>
          ) : (
            <div className="fv-table-wrap">
              <table className="fv-table">
                <thead>
                  <tr>
                    <th>{lang === 'ar' ? 'المساهم' : 'Shareholder'}</th>
                    <th>{lang === 'ar' ? 'رقم الهوية' : 'National ID'}</th>
                    <th>{lang === 'ar' ? 'متوسط التقييم' : 'Avg Rating'}</th>
                    <th>{lang === 'ar' ? 'تاريخ الإرسال' : 'Date'}</th>
                    <th>{lang === 'ar' ? 'التفاصيل' : 'Details'}</th>
                  </tr>
                </thead>
                <tbody>
                  {responses.length === 0 ? (
                    <tr><td colSpan={5} className="fv-no-data">{t('feedback.noFound')}</td></tr>
                  ) : (
                    responses.map((r) => {
                      const who = resolveRespondent(r, lang);
                      return (
                      <tr key={r.id}>
                        <td>
                          <div className="fv-sh-name">
                            {who.name ?? (
                              <em>
                                {who.isDeleted
                                  ? lang === 'ar' ? 'مساهم محذوف' : 'Deleted shareholder'
                                  : lang === 'ar' ? 'غير معروف' : 'Unknown'}
                              </em>
                            )}
                            {who.isDeleted && who.name && (
                              <span className="fv-deleted-badge">
                                {lang === 'ar' ? 'محذوف' : 'Deleted'}
                              </span>
                            )}
                          </div>
                          <div className="fv-sh-email">{who.email ?? ''}</div>
                        </td>
                        <td>{who.nationalId ?? '—'}</td>
                        <td>
                          {r.overall_rating !== null ? (
                            <div className="fv-rating-cell">
                              <Stars value={r.overall_rating ?? 0} />
                              <span className="fv-rating-num" style={{
                                color: (r.overall_rating ?? 0) >= 4 ? '#10b981' : (r.overall_rating ?? 0) >= 3 ? '#f59e0b' : '#ef4444'
                              }}>{(r.overall_rating ?? 0).toFixed(1)}</span>
                            </div>
                          ) : '—'}
                        </td>
                        <td className="fv-date-cell">{formatDate(r.submitted_at)}</td>
                        <td>
                          <button className="fv-btn fv-btn-outline fv-btn-sm" onClick={() => setSelected(r)}>
                            {lang === 'ar' ? 'عرض الإجابات' : 'View Answers'}
                          </button>
                        </td>
                      </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── QUESTION MANAGER TAB ── */}
      {activeTab === 'questions' && <QuestionManager lang={lang} />}
    </div>
  );
};

export default FeedbackView;
