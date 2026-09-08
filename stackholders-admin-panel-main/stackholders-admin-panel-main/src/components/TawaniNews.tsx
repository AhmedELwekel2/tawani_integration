import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getTawaniNews,
  isTawaniConfigured,
  type TawaniNewsPeriod,
} from '../services/tawaniClient';
import { queryKeys } from '../services/queryClient';
import { tawaniErrorKey } from '../utils/tawaniErrors';
import './Tawani.css';

const PERIODS: TawaniNewsPeriod[] = ['daily', 'weekly', 'monthly'];

/** Default lookback per period, matching the agent's own query defaults. */
const DEFAULT_DAYS: Record<TawaniNewsPeriod, number> = { daily: 1, weekly: 7, monthly: 30 };

const IconNews = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9h4" />
    <path d="M18 14h-8m8 4h-8m8-8h-4" />
  </svg>
);

/**
 * Browse the Tawani agent's filtered tourism news feed.
 *
 * This is the cheap half of the integration: `GET /news/*` only scrapes and
 * filters, so it costs seconds and no LLM tokens. Generating a report from the
 * same source material lives in the Reports tab.
 */
export default function TawaniNews() {
  const { t, i18n } = useTranslation();
  const [period, setPeriod] = useState<TawaniNewsPeriod>('weekly');
  const [limit, setLimit] = useState(40);

  const configured = isTawaniConfigured();

  const { data, isFetching, error, refetch } = useQuery({
    queryKey: queryKeys.tawani.news(period, limit),
    queryFn: ({ signal }) => getTawaniNews(period, { days: DEFAULT_DAYS[period], limit }, signal),
    enabled: configured,
    // Scraping is slow and the feed moves hourly at most; don't refetch on a whim.
    staleTime: 10 * 60_000,
    retry: false,
  });

  const formatDate = (iso: string | null): string => {
    if (!iso) return '';
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toLocaleDateString(i18n.language === 'ar' ? 'ar-SA' : 'en-US', {
      year: 'numeric', month: 'short', day: '2-digit',
    });
  };

  if (!configured) {
    return (
      <div className="tawani-page">
        <div className="tawani-notice tawani-notice-warn">
          {t('tawani.notConfigured', 'VITE_TAWANI_API_URL is not set. Add it to .env and restart the dev server.')}
        </div>
      </div>
    );
  }

  return (
    <div className="tawani-page">
      <header className="tawani-header">
        <div className="tawani-header-icon"><IconNews /></div>
        <div className="tawani-header-text">
          <h1>{t('tawani.newsTitle', 'Tourism News')}</h1>
          <p>{t('tawani.newsSubtitle', 'Live feed from the Tawani agent — no AI generation, no cost.')}</p>
        </div>
      </header>

      <div className="tawani-toolbar">
        <div className="tawani-segmented" role="group">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              className={`tawani-segment${period === p ? ' active' : ''}`}
              onClick={() => setPeriod(p)}
            >
              {t(`tawani.period.${p}`, p)}
            </button>
          ))}
        </div>

        <label className="tawani-field">
          <span>{t('tawani.limit', 'Max articles')}</span>
          <input
            type="number"
            min={1}
            max={200}
            value={limit}
            onChange={(e) => setLimit(Math.min(200, Math.max(1, Number(e.target.value) || 1)))}
          />
        </label>

        <button type="button" className="tawani-btn" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? t('tawani.loading', 'Loading…') : t('tawani.refresh', 'Refresh')}
        </button>
      </div>

      {error && (
        <div className="tawani-notice tawani-notice-error">
          {t(tawaniErrorKey(error), (error as Error).message)}
        </div>
      )}

      {isFetching && !data && (
        <div className="tawani-notice">
          {t('tawani.fetchingNews', 'Scraping sources — this usually takes a few seconds.')}
        </div>
      )}

      {data && (
        <>
          <p className="tawani-count">
            {t('tawani.articleCount', '{{count}} articles', { count: data.count })}
          </p>

          <div className="tawani-news-grid">
            {data.articles.map((article, index) => (
              <article className="tawani-card" key={article.url || index}>
                {article.image && (
                  <div className="tawani-card-media">
                    {/* Remote images routinely 404 or hotlink-block; hide rather than show a broken frame. */}
                    <img
                      src={article.image}
                      alt=""
                      loading="lazy"
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                  </div>
                )}
                <div className="tawani-card-body">
                  <h3>{article.title || t('tawani.untitled', 'Untitled')}</h3>
                  {article.description && <p className="tawani-card-desc">{article.description}</p>}
                  <div className="tawani-card-meta">
                    {article.source && <span className="tawani-chip">{article.source}</span>}
                    {formatDate(article.published_at) && <span>{formatDate(article.published_at)}</span>}
                  </div>
                  {article.url && (
                    <a href={article.url} target="_blank" rel="noopener noreferrer" className="tawani-card-link">
                      {t('tawani.readSource', 'Read at source')}
                    </a>
                  )}
                </div>
              </article>
            ))}
          </div>

          {data.count === 0 && (
            <div className="tawani-notice">{t('tawani.noArticles', 'No articles matched this period.')}</div>
          )}
        </>
      )}
    </div>
  );
}
