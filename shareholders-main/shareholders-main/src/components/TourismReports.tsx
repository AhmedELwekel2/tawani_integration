import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Newspaper, FileText, AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import {
  getPublishedReports,
  reportPdfUrl,
  isTawaniConfigured,
  TawaniReport,
} from '../services/tawaniService';
import { translateError } from '../utils/errorUtils';
import { PdfViewer } from './PdfViewer';

const PAGE_SIZE = 9;

/**
 * Published tourism reports, read-only.
 *
 * Stockholders never trigger generation -- that costs minutes of LLM time and
 * happens in the admin panel. The reports live in the Tawani agent's own
 * database, not in Supabase; this tab lists the ones an admin has published and
 * opens the PDF the agent serves.
 */
const TourismReports: React.FC = () => {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === 'ar';
  const locale = isAr ? 'ar-SA' : 'en-US';

  const [items, setItems] = useState<TawaniReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const [pdf, setPdf] = useState<{ url: string; name: string | null } | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getPublishedReports();
      setItems(data);
      setPage(1);
    } catch (err) {
      setError(
        translateError(
          err instanceof Error ? err.message : t('tourismReports.failedToLoad', 'Failed to load reports'),
          t
        )
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const visible = useMemo(
    () => items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [items, page]
  );

  const openPdf = (report: TawaniReport) => {
    // The agent serves its own stored PDFs, so there is no URL to mint first.
    setPdf({ url: reportPdfUrl(report.id), name: report.pdf_file });
  };

  const formatDate = (iso: string | null): string => {
    if (!iso) return '';
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
  };

  if (!isTawaniConfigured()) {
    return (
      <div className="py-16 text-center text-slate-400">
        <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
        <p className="text-sm">{t('tourismReports.unavailable', 'Reports are not available right now.')}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-400">
        <Loader2 className="w-8 h-8 animate-spin mb-3" />
        <p className="text-sm">{t('tourismReports.loading', 'Loading reports…')}</p>
      </div>
    );
  }

  return (
    <div className="p-6 sm:p-8">
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Newspaper className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-800 leading-tight">
              {t('tourismReports.title', 'Tourism Reports')}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {t('tourismReports.subtitle', 'Sector reports published by the cooperative')}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-primary transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          {t('common.retry', 'Refresh')}
        </button>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 mb-6 p-4 rounded-xl bg-rose-50 text-rose-700 border border-rose-100">
          <span className="flex items-center text-sm font-medium">
            <AlertCircle className="w-4 h-4 me-2 flex-shrink-0" />
            {error}
          </span>
        </div>
      )}

      {items.length === 0 && !error && (
        <div className="py-16 text-center text-slate-400">
          <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">{t('tourismReports.empty', 'No reports have been published yet.')}</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((report, index) => (
          <motion.article
            key={report.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: Math.min(index * 0.04, 0.24) }}
            className="flex flex-col p-5 rounded-2xl bg-white border border-slate-200/70 shadow-sm hover:shadow-md hover:border-primary/30 transition-all"
          >
            <span className="inline-flex self-start items-center px-2.5 py-0.5 mb-3 rounded-full bg-primary/10 text-primary text-xs font-semibold">
              {t(`tourismReports.type.${report.report_type}`, report.report_type)}
            </span>

            <h3 className="text-base font-bold text-slate-800 leading-snug mb-1">
              {isAr ? report.title_ar : report.title_en}
            </h3>

            {formatDate(report.published_at) && (
              <p className="text-xs text-slate-400 mb-3">{formatDate(report.published_at)}</p>
            )}

            {(isAr ? report.summary_ar : report.summary_en) && (
              <p className="text-sm text-slate-600 leading-relaxed line-clamp-3 mb-4">
                {isAr ? report.summary_ar : report.summary_en}
              </p>
            )}

            {report.pdf_file && (
              <button
                type="button"
                onClick={() => openPdf(report)}
                className="mt-auto inline-flex items-center gap-2 text-sm font-semibold text-primary hover:text-primary/80 transition-colors"
              >
                <FileText className="w-4 h-4" />
                {t('tourismReports.openPdf', 'Open report')}
              </button>
            )}
          </motion.article>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-8">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40 hover:bg-slate-50 transition-colors"
          >
            {t('common.previous', 'Previous')}
          </button>
          <span className="text-sm text-slate-500">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40 hover:bg-slate-50 transition-colors"
          >
            {t('common.next', 'Next')}
          </button>
        </div>
      )}

      {pdf && <PdfViewer fileUrl={pdf.url} fileName={pdf.name} onClose={() => setPdf(null)} />}
    </div>
  );
};

export default TourismReports;
