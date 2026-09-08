import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { TFunction } from 'i18next';
import {
  getAuditLogs,
  type AuditLog as AuditLogRow,
  type AuditLogFilters,
} from '../services/auditService';
import './AuditLog.css';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getActionCategory(action: string): string {
  const a = action.toUpperCase();
  if (a.startsWith('CREATE_') || a === 'LOGIN') return 'create';
  if (a.startsWith('UPDATE_') || a.startsWith('TOGGLE_') || a.startsWith('UPLOAD_')) return 'update';
  if (a.startsWith('DELETE_')) return 'delete';
  if (a === 'LOGOUT') return 'auth';
  return 'other';
}

function formatDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' }),
    time: d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const IconShield = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
);

const IconChevron = ({ open }: { open: boolean }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
    style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const IconEmpty = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
    strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
);

// ─── Constants ────────────────────────────────────────────────────────────────

const TABLE_OPTIONS = (t: TFunction) => [
  { value: 'all',                              label: t('audit.tableAll', 'All Tables') },
  { value: 'auth',                             label: t('audit.tableAuth', 'Auth') },
  { value: 'stockholders',                     label: t('audit.tableStockholders', 'Stockholders') },
  { value: 'stockholder_transactions',         label: t('audit.tableTransactions', 'Transactions') },
  { value: 'yearly_dividends',                 label: t('audit.tableDividends', 'Dividends') },
  { value: 'stock_certificates',               label: t('audit.tableCertificates', 'Certificates') },
  { value: 'stockholder_transaction_approvals',label: t('audit.tableApprovals', 'Approval Docs') },
  { value: 'contact_submissions',              label: t('audit.tableContact', 'Contact') },
  { value: 'feedback_questions',               label: t('audit.tableFeedback', 'Survey Questions') },
];

function getEventSummary(log: AuditLogRow, t: TFunction): string {
  const { action, details } = log;
  if (!details) return '';

  if (action === 'TOGGLE_STOCKHOLDER_STATUS' && details.status) {
    return t('audit.summaries.statusChanged', { status: String(details.status) });
  }
  if (details.fields && Array.isArray(details.fields)) {
    return t('audit.summaries.fieldsUpdated', { fields: details.fields.join(', ') });
  }
  if (details.email && (action === 'CREATE_ADMIN' || action === 'DELETE_ADMIN')) {
    return t('audit.summaries.targetAdmin', { email: String(details.email) });
  }
  return '';
}

function ActionIcon({ category }: { category: string }) {
  switch (category) {
    case 'create': return <span>➕</span>;
    case 'update': return <span>📝</span>;
    case 'delete': return <span>🗑️</span>;
    case 'auth':   return <span>🔑</span>;
    default:       return null;
  }
}

const PAGE_SIZE = 20;

// ─── Main component ───────────────────────────────────────────────────────────

export default function AuditLog() {
  const { t } = useTranslation();

  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Filters
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [targetTable, setTargetTable] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const filters: AuditLogFilters = {
        page,
        pageSize: PAGE_SIZE,
        target_table: targetTable,
        search: searchQuery || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      };
      const result = await getAuditLogs(filters);
      setLogs(result.data);
      setTotalCount(result.count);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  }, [page, searchQuery, targetTable, dateFrom, dateTo]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const clearFilters = () => {
    setSearchInput('');
    setSearchQuery('');
    setTargetTable('all');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchQuery(value);
      setPage(1);
    }, 350);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSearchQuery(searchInput);
    setPage(1);
  };

  const toggleDetails = (id: number) => {
    setExpandedId((prev: number | null) => (prev === id ? null : id));
  };

  // Pagination pages to show
  const pageNumbers = (() => {
    const delta = 2;
    const range: number[] = [];
    for (let i = Math.max(1, page - delta); i <= Math.min(totalPages, page + delta); i++) {
      range.push(i);
    }
    return range;
  })();

  return (
    <div className="audit-log-page">

      {/* Header */}
      <div className="audit-log-header">
        <div className="audit-log-header-icon">
          <IconShield />
        </div>
        <div className="audit-log-header-text">
          <h1>{t('nav.auditLog', 'Audit Log')}</h1>
          <p>{t('audit.subtitle', 'Track every admin action across the portal')}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="audit-filters-card">
        <div className="audit-filter-group" style={{ flex: 2.5, minWidth: 240 }}>
          <label htmlFor="audit-search">{t('common.search', 'Search')}</label>
          <form className="search-input-wrapper" onSubmit={handleSearchSubmit}>
            <svg className="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              id="audit-search"
              type="search"
              placeholder={t('audit.searchPlaceholder', 'Email, action, or ID…')}
              value={searchInput}
              onChange={handleSearchChange}
              autoComplete="off"
            />
            {searchInput && (
              <button type="button" className="search-clear" onClick={() => { setSearchInput(''); setSearchQuery(''); setPage(1); }} aria-label={t('common.close')}>
                ×
              </button>
            )}
          </form>
        </div>

        <div className="audit-filter-group">
          <label htmlFor="audit-table-filter">{t('audit.table', 'Table')}</label>
          <select
            id="audit-table-filter"
            value={targetTable}
            onChange={e => { setTargetTable(e.target.value); setPage(1); }}
          >
            {TABLE_OPTIONS(t).map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div className="audit-filter-group">
          <label htmlFor="audit-date-from">{t('dividends.modal.from', 'From')}</label>
          <input
            id="audit-date-from"
            type="date"
            value={dateFrom}
            onChange={e => { setDateFrom(e.target.value); setPage(1); }}
          />
        </div>

        <div className="audit-filter-group">
          <label htmlFor="audit-date-to">{t('dividends.modal.to', 'To')}</label>
          <input
            id="audit-date-to"
            type="date"
            value={dateTo}
            onChange={e => { setDateTo(e.target.value); setPage(1); }}
          />
        </div>

        <button className="audit-filter-clear" type="button" onClick={clearFilters} title={t('audit.clearFilters')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
          {t('audit.clearFilters', 'Clear filters')}
        </button>
      </div>

      {/* Table */}
      <div className="audit-table-card">
        <div className="audit-table-meta">
          <span className="audit-table-meta-count">
            {loading
              ? t('audit.loading', 'Loading...')
              : t('audit.eventsFound', { count: totalCount.toLocaleString() })
            }
          </span>
        </div>

        {error && (
          <div style={{ padding: '1.5rem', color: '#b91c1c', fontSize: '0.85rem' }}>
            ⚠️ {error}
          </div>
        )}

        {!error && (
          <div className="audit-table-wrapper">
            <table className="audit-table">
              <thead>
                <tr>
                  <th>{t('audit.timestamp', 'Timestamp')}</th>
                  <th>{t('audit.admin', 'Admin')}</th>
                  <th>{t('audit.action', 'Action')}</th>
                  <th>{t('audit.module', 'Module')}</th>
                  <th>{t('audit.details', 'Details')}</th>
                </tr>
              </thead>
              <tbody>
                {loading && Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 6 }).map((__, j) => (
                      <td key={j}>
                        <div style={{
                          height: 14,
                          borderRadius: 4,
                          background: 'linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%)',
                          backgroundSize: '200% 100%',
                          animation: 'shimmer 1.5s infinite',
                          width: j === 0 ? 100 : j === 1 ? 140 : j === 2 ? 120 : 80,
                        }} />
                      </td>
                    ))}
                  </tr>
                ))}

                {!loading && logs.length === 0 && (
                  <tr>
                    <td colSpan={6}>
                      <div className="audit-empty-state">
                        <div className="audit-empty-state-icon"><IconEmpty /></div>
                        <h3>{t('audit.noEvents', 'No events found')}</h3>
                        <p>{t('audit.tryAdjusting', 'Try adjusting your filters or perform some admin actions to generate logs.')}</p>
                      </div>
                    </td>
                  </tr>
                )}

                {!loading && logs.map((log: AuditLogRow) => {
                  const { date, time } = formatDateTime(log.created_at);
                  const category = getActionCategory(log.action);
                  const hasDetails = log.details && Object.keys(log.details).length > 0;
                  const isExpanded = expandedId === log.id;
                  const actionLabel = t(`audit.actions.${log.action}`, log.action) as string;
                  return (
                    <>
                      <tr key={log.id}>
                        <td>
                          <div className="audit-table-time">{date}</div>
                          <div className="audit-table-time" style={{ opacity: 0.6 }}>{time}</div>
                        </td>
                        <td>
                          <div className="audit-actor-email" title={log.actor_email}>
                            {log.actor_email}
                          </div>
                        </td>
                        <td>
                          <div className="audit-action-container">
                            <ActionIcon category={category} />
                            <span className={`audit-action-badge ${category}`}>
                              {actionLabel}
                            </span>
                          </div>
                          <div className="audit-event-summary">
                            {getEventSummary(log, t)}
                          </div>
                        </td>
                        <td>
                          <span className="audit-entity-type">
                            {TABLE_OPTIONS(t).find(o => o.value === log.target_table)?.label || log.target_table}
                          </span>
                          <div className="audit-target-id" title={log.target_id ?? ''}>
                            {log.target_id ? `#${log.target_id.slice(-6)}` : ''}
                          </div>
                        </td>
                        <td>
                          {hasDetails ? (
                            <button
                              className="audit-details-btn"
                              onClick={() => toggleDetails(log.id)}
                            >
                              <IconChevron open={isExpanded} />
                              {isExpanded ? t('audit.hideDetails', 'Hide') : t('audit.viewDetails', 'Technical')}
                            </button>
                          ) : (
                            <span style={{ color: '#cbd5e1', fontSize: '0.75rem' }}>—</span>
                          )}
                        </td>
                      </tr>
                      {isExpanded && hasDetails && (
                        <tr key={`${log.id}-expand`} className="audit-details-expand-row">
                          <td colSpan={5}>
                            <pre className="audit-details-json">
                              {JSON.stringify(log.details, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div className="audit-pagination">
            <span className="audit-pagination-info">
              Page {page} of {totalPages}
            </span>
            <div className="audit-pagination-controls">
              <button
                className="audit-page-btn"
                onClick={() => setPage(1)}
                disabled={page === 1}
                title="First page"
              >«</button>
              <button
                className="audit-page-btn"
                onClick={() => setPage((p: number) => Math.max(1, p - 1))}
                disabled={page === 1}
                title="Previous page"
              >‹</button>

              {pageNumbers.map(n => (
                <button
                  key={n}
                  className={`audit-page-btn${n === page ? ' active' : ''}`}
                  onClick={() => setPage(n)}
                >{n}</button>
              ))}

              <button
                className="audit-page-btn"
                onClick={() => setPage((p: number) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                title="Next page"
              >›</button>
              <button
                className="audit-page-btn"
                onClick={() => setPage(totalPages)}
                disabled={page === totalPages}
                title="Last page"
              >»</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
