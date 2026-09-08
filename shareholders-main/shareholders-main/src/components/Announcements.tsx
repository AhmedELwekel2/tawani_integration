import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Megaphone, FileText, AlertCircle, Loader2, RefreshCw, X } from 'lucide-react';
import { getAnnouncements, getAnnouncementPdfSignedUrl, Announcement } from '../services/stockholderService';
import { translateError } from '../utils/errorUtils';
import { RichTextContent } from './RichTextContent';
import { PdfViewer } from './PdfViewer';
import './Announcements.css';

const PAGE_SIZE = 9;

/** Strip HTML to plain text for card snippets. Uses an inert parsed document
 * (DOMParser never executes scripts or loads resources). */
const htmlToText = (html: string | null): string => {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
};

export const Announcements: React.FC = () => {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === 'ar';
  const locale = isAr ? 'ar-SA' : 'en-US';

  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const [selected, setSelected] = useState<Announcement | null>(null);
  const [pdf, setPdf] = useState<{ url: string; name: string | null } | null>(null);
  const [openingPdf, setOpeningPdf] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getAnnouncements();
      setItems(data);
      setPage(1);
    } catch (err) {
      setError(translateError(err instanceof Error ? err.message : t('announcements.failedToLoad'), t));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  // Close the detail modal with Esc (only when the PDF viewer isn't on top).
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pdf) setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, pdf]);

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const pageItems = useMemo(
    () => items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [items, page],
  );

  const titleFor = (a: Announcement) =>
    (isAr ? a.title_ar : a.title_en) || (isAr ? a.title_en : a.title_ar);

  const bodyFor = (a: Announcement): { html: string; dir: 'rtl' | 'ltr' } => {
    let html = isAr ? a.body_ar : a.body_en;
    let dir: 'rtl' | 'ltr' = isAr ? 'rtl' : 'ltr';
    if (!html) {
      html = isAr ? a.body_en : a.body_ar;
      dir = isAr ? 'ltr' : 'rtl';
    }
    return { html: html || '', dir };
  };

  const formatDate = (value: string | null): string =>
    value
      ? new Date(value).toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' })
      : '';

  const openPdf = async (a: Announcement) => {
    if (!a.pdf_storage_path) return;
    try {
      setOpeningPdf(true);
      const url = await getAnnouncementPdfSignedUrl(a.pdf_storage_path);
      setPdf({ url, name: a.pdf_file_name });
    } catch (err) {
      setError(translateError(err instanceof Error ? err.message : t('announcements.failedToLoad'), t));
    } finally {
      setOpeningPdf(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-500">
        <Loader2 className="w-8 h-8 animate-spin mb-3 text-primary" />
        <p>{t('announcements.loading')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertCircle className="w-12 h-12 text-rose-500 mb-3" />
        <p className="text-rose-600 mb-4">{error}</p>
        <button
          onClick={load}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary/90"
        >
          <RefreshCw className="w-4 h-4" /> {t('announcements.tryAgain')}
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center text-slate-500">
        <Megaphone className="w-14 h-14 text-slate-300 mb-4" />
        <h3 className="text-lg font-semibold text-slate-700">{t('announcements.empty')}</h3>
        <p className="mt-1 max-w-sm">{t('announcements.emptyDesc')}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {pageItems.map((a, index) => {
          const snippet = htmlToText(bodyFor(a).html);
          return (
            <motion.button
              key={a.id}
              type="button"
              onClick={() => setSelected(a)}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index * 0.04, 0.25) }}
              className="text-start flex flex-col rounded-2xl overflow-hidden border border-slate-200/70 bg-white shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              {a.cover_image_url ? (
                <img src={a.cover_image_url} alt="" className="w-full h-40 object-cover" loading="lazy" />
              ) : (
                <div className="w-full h-40 flex items-center justify-center bg-gradient-to-br from-primary/15 to-secondary/15">
                  <Megaphone className="w-10 h-10 text-primary/70" />
                </div>
              )}
              <div className="p-5 flex flex-col flex-1">
                <h3 className="text-base font-semibold text-slate-800 line-clamp-2">{titleFor(a)}</h3>
                {a.published_at && (
                  <p className="text-xs text-slate-400 mt-1">{formatDate(a.published_at)}</p>
                )}
                {snippet && <p className="text-sm text-slate-500 mt-3 line-clamp-2">{snippet}</p>}
                <span className="mt-4 text-sm font-medium text-primary">{t('announcements.viewDetails')}</span>
              </div>
            </motion.button>
          );
        })}
      </div>

      {totalPages > 1 && (
        <div className="mt-8 flex items-center justify-between border-t border-slate-200 pt-6">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
          >
            {t('transactions.previous')}
          </button>
          <span className="text-sm font-medium text-slate-600">
            {t('transactions.page', { page, total: totalPages })}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
          >
            {t('transactions.next')}
          </button>
        </div>
      )}

      {/* Detail modal */}
      {selected && (
        <div
          className="fixed inset-0 z-[1050] bg-slate-900/60 backdrop-blur-sm flex items-start sm:items-center justify-center p-4 overflow-y-auto"
          onClick={() => setSelected(null)}
          role="dialog"
          aria-modal="true"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            className="relative w-full max-w-2xl my-8 bg-white rounded-2xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setSelected(null)}
              className="absolute top-3 end-3 z-10 p-2 rounded-full bg-white/80 text-slate-600 hover:bg-slate-100"
              title={t('announcements.viewer.close')}
            >
              <X className="w-5 h-5" />
            </button>

            {selected.cover_image_url ? (
              <img src={selected.cover_image_url} alt="" className="w-full max-h-72 object-cover" />
            ) : (
              <div className="w-full h-32 flex items-center justify-center bg-gradient-to-br from-primary/15 to-secondary/15">
                <Megaphone className="w-12 h-12 text-primary/70" />
              </div>
            )}

            <div className="p-6 max-h-[60vh] overflow-y-auto">
              <h2 className="text-xl font-bold text-slate-800">{titleFor(selected)}</h2>
              {selected.published_at && (
                <p className="text-sm text-slate-400 mt-1">
                  {t('announcements.publishedOn', { date: formatDate(selected.published_at) })}
                </p>
              )}

              {bodyFor(selected).html && (
                <RichTextContent
                  html={bodyFor(selected).html}
                  dir={bodyFor(selected).dir}
                  className="mt-4 text-slate-700"
                />
              )}

              {selected.pdf_storage_path && (
                <div className="mt-6">
                  <button
                    onClick={() => openPdf(selected)}
                    disabled={openingPdf}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-60"
                  >
                    {openingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                    {t('announcements.viewDocument')}
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}

      {pdf && <PdfViewer fileUrl={pdf.url} fileName={pdf.name} onClose={() => setPdf(null)} />}
    </div>
  );
};

export default Announcements;
