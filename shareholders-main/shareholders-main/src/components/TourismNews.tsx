import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Newspaper, AlertCircle, Loader2, RefreshCw, ExternalLink } from 'lucide-react';
import { getNews, isTawaniConfigured, NewsArticle, NewsPeriod } from '../services/tawaniService';
import { translateError } from '../utils/errorUtils';

const PERIODS: NewsPeriod[] = ['daily', 'weekly', 'monthly'];

/**
 * Tourism news for stockholders, read-only.
 *
 * Deliberately the agent's listing endpoint and nothing else: it scrapes and
 * filters without invoking the LLM, so a stockholder browsing the feed costs
 * nothing. Report generation stays in the admin panel.
 */
const TourismNews: React.FC = () => {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === 'ar';
  const locale = isAr ? 'ar-SA' : 'en-US';

  const [period, setPeriod] = useState<NewsPeriod>('weekly');
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (next: NewsPeriod, signal?: AbortSignal) => {
      try {
        setLoading(true);
        setError(null);
        const data = await getNews(next, 40, signal);
        setArticles(data.articles);
      } catch (err) {
        // An aborted request means the user switched period; not an error.
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(
          translateError(
            err instanceof Error ? err.message : t('tourismNews.failedToLoad', 'Failed to load news'),
            t
          )
        );
      } finally {
        setLoading(false);
      }
    },
    [t]
  );

  useEffect(() => {
    const controller = new AbortController();
    load(period, controller.signal);
    return () => controller.abort();
  }, [period, load]);

  const formatDate = (iso: string | null): string => {
    if (!iso) return '';
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  if (!isTawaniConfigured()) {
    return (
      <div className="py-16 text-center text-slate-400">
        <Newspaper className="w-10 h-10 mx-auto mb-3 opacity-40" />
        <p className="text-sm">{t('tourismNews.unavailable', 'News is not available right now.')}</p>
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
              {t('tourismNews.title', 'Tourism News')}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {t('tourismNews.subtitle', 'Latest sector news from Saudi and international sources')}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => load(period)}
          disabled={loading}
          className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-primary disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          {t('common.retry', 'Refresh')}
        </button>
      </div>

      {/* Period selector */}
      <div className="inline-flex p-1 mb-6 rounded-xl bg-slate-100 gap-1">
        {PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriod(p)}
            className={`px-4 py-1.5 text-sm font-semibold rounded-lg transition-all ${
              period === p
                ? 'bg-white text-primary shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t(`tourismNews.period.${p}`, p)}
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-3 mb-6 p-4 rounded-xl bg-rose-50 text-rose-700 border border-rose-100">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm font-medium">{error}</span>
        </div>
      )}

      {loading && (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin mb-3" />
          <p className="text-sm">{t('tourismNews.loading', 'Gathering the latest news…')}</p>
        </div>
      )}

      {!loading && !error && articles.length === 0 && (
        <div className="py-16 text-center text-slate-400">
          <Newspaper className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">{t('tourismNews.empty', 'No news for this period.')}</p>
        </div>
      )}

      {!loading && articles.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {articles.map((article, index) => (
            <motion.article
              key={article.url || index}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: Math.min(index * 0.03, 0.3) }}
              className="flex flex-col rounded-2xl bg-white border border-slate-200/70 shadow-sm hover:shadow-md hover:border-primary/30 transition-all overflow-hidden"
            >
              {article.image && (
                <div className="h-36 bg-slate-100">
                  {/* Remote images often 404 or block hotlinking; hide rather than
                      leave a broken frame in the card. */}
                  <img
                    src={article.image}
                    alt=""
                    loading="lazy"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                </div>
              )}

              <div className="flex flex-col flex-1 p-5 gap-2">
                <h3 className="text-base font-bold text-slate-800 leading-snug">
                  {article.title || t('tourismNews.untitled', 'Untitled')}
                </h3>

                {article.description && (
                  <p className="text-sm text-slate-600 leading-relaxed line-clamp-3">
                    {article.description}
                  </p>
                )}

                <div className="flex items-center flex-wrap gap-2 mt-auto pt-2 text-xs text-slate-400">
                  {article.source && (
                    <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">
                      {article.source}
                    </span>
                  )}
                  {formatDate(article.published_at) && <span>{formatDate(article.published_at)}</span>}
                </div>

                {article.url && (
                  <a
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:text-primary/80 transition-colors"
                  >
                    {t('tourismNews.readMore', 'Read at source')}
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            </motion.article>
          ))}
        </div>
      )}
    </div>
  );
};

export default TourismNews;
