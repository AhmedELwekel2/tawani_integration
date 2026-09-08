import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  generateTawaniReport,
  getTawaniHealth,
  isTawaniConfigured,
  listTawaniReports,
  updateTawaniReport,
  deleteTawaniReport,
  tawaniReportPdfUrl,
  type TawaniReport,
  type TawaniReportType,
} from '../services/tawaniClient';
import { logAction, AUDIT_ACTIONS } from '../services/auditService';
import { queryKeys } from '../services/queryClient';
import { tawaniErrorKey } from '../utils/tawaniErrors';
import './Tawani.css';

const REPORT_TYPES: TawaniReportType[] = ['daily', 'weekly', 'monthly', 'magazine'];

const IconReports = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <path d="M9 15h6M9 11h2" />
  </svg>
);

/** Elapsed-seconds ticker. A run takes minutes, so a spinner alone reads as a hang. */
function useElapsed(running: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) {
      setSeconds(0);
      return;
    }
    const started = Date.now();
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [running]);
  return seconds;
}

const formatElapsed = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * Generate Tawani reports and choose which ones stockholders see.
 *
 * The reports live in the agent's own database, not ours -- this tab is a remote
 * control for it. Generating stores a draft; publishing is a separate, explicit
 * step, so unreviewed AI Arabic prose never reaches the portal by accident.
 */
export default function TawaniReports() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const isAr = i18n.language === 'ar';

  const [type, setType] = useState<TawaniReportType>('weekly');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [editing, setEditing] = useState<{ id: string; ar: string; en: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const configured = isTawaniConfigured();

  const { data: health } = useQuery({
    queryKey: queryKeys.tawani.health,
    queryFn: ({ signal }) => getTawaniHealth(signal),
    enabled: configured,
    staleTime: 60_000,
    retry: false,
  });

  const { data: reports = [], isLoading: reportsLoading, error: reportsError } = useQuery({
    queryKey: queryKeys.tawani.reports,
    queryFn: ({ signal }) => listTawaniReports(false, signal),
    enabled: configured,
    retry: false,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.tawani.reports });

  const generate = useMutation({
    mutationFn: async (reportType: TawaniReportType) => {
      abortRef.current = new AbortController();
      return generateTawaniReport(reportType, {}, abortRef.current.signal);
    },
    onSuccess: (data, reportType) => {
      setNotice({
        kind: 'ok',
        text: t('tawani.saved', 'Report generated. Publish it to make it visible to stockholders.'),
      });
      logAction(AUDIT_ACTIONS.GENERATE_TAWANI_REPORT, 'tawani', data.id, {
        report_type: reportType,
      });
      invalidate();
    },
    onError: (error) => {
      // A deliberate cancel is not a failure worth shouting about.
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setNotice({ kind: 'error', text: t(tawaniErrorKey(error), (error as Error).message) });
    },
  });

  const elapsed = useElapsed(generate.isPending);

  const publish = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) =>
      updateTawaniReport(id, { is_published: next }),
    onSuccess: (report) => {
      logAction(AUDIT_ACTIONS.PUBLISH_TAWANI_REPORT, 'tawani', report.id, {
        is_published: report.is_published,
      });
      invalidate();
    },
    onError: (error) =>
      setNotice({ kind: 'error', text: t(tawaniErrorKey(error), (error as Error).message) }),
  });

  const rename = useMutation({
    mutationFn: ({ id, ar, en }: { id: string; ar: string; en: string }) =>
      updateTawaniReport(id, { title_ar: ar, title_en: en }),
    onSuccess: () => {
      setEditing(null);
      invalidate();
    },
    onError: (error) =>
      setNotice({ kind: 'error', text: t(tawaniErrorKey(error), (error as Error).message) }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteTawaniReport(id),
    onSuccess: (_result, id) => {
      logAction(AUDIT_ACTIONS.DELETE_TAWANI_REPORT, 'tawani', id, {});
      invalidate();
    },
    onError: (error) =>
      setNotice({ kind: 'error', text: t(tawaniErrorKey(error), (error as Error).message) }),
  });

  if (!configured) {
    return (
      <div className="tawani-page">
        <div className="tawani-notice tawani-notice-warn">
          {t(
            'tawani.notConfigured',
            'VITE_TAWANI_API_URL is not set. Add it to .env and restart the dev server.'
          )}
        </div>
      </div>
    );
  }

  const llmReady = Boolean(health?.llm?.bedrock || health?.llm?.azure);

  const titleOf = (report: TawaniReport) => (isAr ? report.title_ar : report.title_en);

  return (
    <div className="tawani-page">
      <header className="tawani-header">
        <div className="tawani-header-icon">
          <IconReports />
        </div>
        <div className="tawani-header-text">
          <h1>{t('tawani.reportsTitle', 'Tourism Reports')}</h1>
          <p>
            {t(
              'tawani.reportsSubtitle',
              'Generate an AI report, review it, then publish it to stockholders.'
            )}
          </p>
        </div>
      </header>

      {health && !llmReady && (
        <div className="tawani-notice tawani-notice-warn">
          {t(
            'tawani.noLlm',
            'The agent has no LLM credentials configured, so report generation will fail. News browsing still works.'
          )}
        </div>
      )}

      {notice && (
        <div className={`tawani-notice ${notice.kind === 'ok' ? 'tawani-notice-ok' : 'tawani-notice-error'}`}>
          {notice.text}
        </div>
      )}

      {/* Generate */}
      <section className="tawani-panel">
        <h2>{t('tawani.generateHeading', 'Generate')}</h2>

        <div className="tawani-toolbar">
          <div className="tawani-segmented" role="group">
            {REPORT_TYPES.map((r) => (
              <button
                key={r}
                type="button"
                className={`tawani-segment${type === r ? ' active' : ''}`}
                onClick={() => setType(r)}
                disabled={generate.isPending}
              >
                {t(`tawani.type.${r}`, r)}
              </button>
            ))}
          </div>

          {generate.isPending ? (
            <button
              type="button"
              className="tawani-btn tawani-btn-danger"
              onClick={() => abortRef.current?.abort()}
            >
              {t('tawani.cancel', 'Cancel')}
            </button>
          ) : (
            <button type="button" className="tawani-btn" onClick={() => generate.mutate(type)}>
              {t('tawani.generate', 'Generate report')}
            </button>
          )}
        </div>

        {generate.isPending && (
          <div className="tawani-progress">
            <div className="tawani-progress-bar">
              <span />
            </div>
            <p>
              {t('tawani.generating', 'Scraping, generating and rendering — this takes 1–6 minutes.')}{' '}
              <strong>{formatElapsed(elapsed)}</strong>
            </p>
          </div>
        )}
      </section>

      {/* Library */}
      <section className="tawani-panel">
        <h2>{t('tawani.libraryHeading', 'Saved reports')}</h2>

        {reportsLoading && <p className="tawani-muted">{t('tawani.loading', 'Loading…')}</p>}

        {reportsError && (
          <div className="tawani-notice tawani-notice-error">
            {t(tawaniErrorKey(reportsError), (reportsError as Error).message)}
          </div>
        )}

        {!reportsLoading && !reportsError && reports.length === 0 && (
          <p className="tawani-muted">{t('tawani.noReports', 'No reports saved yet.')}</p>
        )}

        {reports.length > 0 && (
          <div className="tawani-table-wrap">
            <table className="tawani-table">
              <thead>
                <tr>
                  <th>{t('tawani.colTitle', 'Title')}</th>
                  <th>{t('tawani.colType', 'Type')}</th>
                  <th>{t('tawani.colGenerated', 'Generated')}</th>
                  <th>{t('tawani.colStatus', 'Status')}</th>
                  <th aria-label={t('tawani.colActions', 'Actions')} />
                </tr>
              </thead>
              <tbody>
                {reports.map((report) => (
                  <tr key={report.id}>
                    <td>
                      {editing?.id === report.id ? (
                        <div className="tawani-title-fields">
                          <input
                            value={editing.ar}
                            dir="rtl"
                            aria-label={t('tawani.titleAr', 'Title (Arabic)')}
                            onChange={(e) => setEditing({ ...editing, ar: e.target.value })}
                          />
                          <input
                            value={editing.en}
                            dir="ltr"
                            aria-label={t('tawani.titleEn', 'Title (English)')}
                            onChange={(e) => setEditing({ ...editing, en: e.target.value })}
                          />
                        </div>
                      ) : (
                        titleOf(report)
                      )}
                    </td>
                    <td>{t(`tawani.type.${report.report_type}`, report.report_type)}</td>
                    <td>
                      {new Date(report.generated_at).toLocaleDateString(isAr ? 'ar-SA' : 'en-US')}
                    </td>
                    <td>
                      <span className={`tawani-status${report.is_published ? ' published' : ''}`}>
                        {report.is_published ? t('tawani.published', 'Published') : t('tawani.draft', 'Draft')}
                      </span>
                    </td>
                    <td className="tawani-row-actions">
                      {editing?.id === report.id ? (
                        <>
                          <button
                            type="button"
                            className="tawani-link-btn"
                            disabled={rename.isPending}
                            onClick={() => rename.mutate(editing)}
                          >
                            {t('tawani.saveTitle', 'Save')}
                          </button>
                          <button
                            type="button"
                            className="tawani-link-btn"
                            onClick={() => setEditing(null)}
                          >
                            {t('tawani.cancel', 'Cancel')}
                          </button>
                        </>
                      ) : (
                        <>
                          {report.pdf_file && (
                            <a
                              className="tawani-link-btn"
                              href={tawaniReportPdfUrl(report.id)}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {t('tawani.view', 'View')}
                            </a>
                          )}
                          <button
                            type="button"
                            className="tawani-link-btn"
                            onClick={() =>
                              setEditing({ id: report.id, ar: report.title_ar, en: report.title_en })
                            }
                          >
                            {t('tawani.rename', 'Rename')}
                          </button>
                          <button
                            type="button"
                            className="tawani-link-btn"
                            disabled={publish.isPending}
                            onClick={() => publish.mutate({ id: report.id, next: !report.is_published })}
                          >
                            {report.is_published
                              ? t('tawani.unpublish', 'Unpublish')
                              : t('tawani.publish', 'Publish')}
                          </button>
                          <button
                            type="button"
                            className="tawani-link-btn tawani-link-danger"
                            disabled={remove.isPending}
                            onClick={() => {
                              if (window.confirm(t('tawani.confirmDelete', 'Delete this report permanently?'))) {
                                remove.mutate(report.id);
                              }
                            }}
                          >
                            {t('tawani.delete', 'Delete')}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
