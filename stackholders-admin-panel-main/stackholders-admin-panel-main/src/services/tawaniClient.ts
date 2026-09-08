/**
 * HTTP client for the Tawani tourism news agent (FastAPI + LangGraph).
 *
 * The agent is a self-contained service with its own database: it generates the
 * reports, stores them, and decides which are published. Nothing about a report
 * is mirrored into our Supabase project -- this module is the only bridge, and
 * it is read/write over HTTP.
 *
 * Timing differs wildly by endpoint: `/news/*` and `/library*` return in
 * seconds, while `POST /reports/*` runs a scrape + LLM + PDF pipeline that the
 * agent's own docs quote at one to six minutes.
 */

const BASE_URL = (import.meta.env.VITE_TAWANI_API_URL || '').replace(/\/+$/, '');

/** Sent on mutating calls. The agent only enforces it when TAWANI_ADMIN_KEY is set there. */
const ADMIN_KEY = import.meta.env.VITE_TAWANI_ADMIN_KEY || '';

export type TawaniReportType = 'daily' | 'weekly' | 'monthly' | 'magazine';

/** News listing periods. `magazine` has no listing counterpart. */
export type TawaniNewsPeriod = 'daily' | 'weekly' | 'monthly';

export interface TawaniArticle {
  title: string | null;
  source: string | null;
  url: string | null;
  published_at: string | null;
  description: string | null;
  image: string | null;
}

export interface TawaniNewsListing {
  period: string;
  days: number;
  category: string | null;
  count: number;
  articles: TawaniArticle[];
}

/** A report row in the agent's own store. */
export interface TawaniReport {
  id: string;
  report_type: TawaniReportType;
  title_ar: string;
  title_en: string;
  summary_ar: string | null;
  summary_en: string | null;
  pdf_file: string | null;
  article_count: number | null;
  enhanced_count: number | null;
  generated_at: string;
  is_published: boolean;
  published_at: string | null;
}

/** Response from a generation run; the agent has already stored the report. */
export interface TawaniGenerateResult {
  status: string;
  id: string;
  report: TawaniReport;
  article_count: number | null;
  enhanced_count: number | null;
  download_url: string;
}

export class TawaniNotConfiguredError extends Error {
  constructor() {
    super('TAWANI_NOT_CONFIGURED');
    this.name = 'TawaniNotConfiguredError';
  }
}

export const isTawaniConfigured = (): boolean => BASE_URL.length > 0;

/**
 * The agent reports its own errors as FastAPI `detail`, in Arabic. Surface that
 * text rather than a generic HTTP message -- it is what the operator needs.
 */
const readError = async (response: Response): Promise<string> => {
  try {
    const body = await response.json();
    const detail = (body as { detail?: unknown })?.detail;
    if (typeof detail === 'string' && detail.trim()) return detail;
  } catch {
    /* not JSON -- fall through to the status line */
  }
  return `${response.status} ${response.statusText}`.trim();
};

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Abort after this long. Reports need minutes; everything else should not. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

const request = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  if (!isTawaniConfigured()) throw new TawaniNotConfiguredError();

  const { method = 'GET', body, timeoutMs = 60_000, signal } = options;

  // Two independent reasons to give up: our own ceiling, and the caller
  // navigating away. `AbortSignal.any` keeps both live without leaking either.
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new Error('TAWANI_TIMEOUT')), timeoutMs);
  const composed = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (ADMIN_KEY && method !== 'GET') headers['X-Tawani-Admin-Key'] = ADMIN_KEY;

  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: Object.keys(headers).length ? headers : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: composed,
    });

    if (!response.ok) throw new Error(await readError(response));
    return (await response.json()) as T;
  } catch (error) {
    // A timeout and a user cancellation both arrive as AbortError; only the
    // former is worth an error message about the service being slow.
    if (error instanceof DOMException && error.name === 'AbortError') {
      if (timeout.signal.aborted) throw new Error('TAWANI_TIMEOUT');
      throw error;
    }
    // fetch() rejects with a bare TypeError when the service is simply down.
    if (error instanceof TypeError) throw new Error('TAWANI_UNREACHABLE');
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

export interface TawaniHealth {
  status: string;
  llm: { bedrock: boolean; azure: boolean };
  model: string | null;
}

/** Cheap liveness probe; also reports which LLM providers are actually wired up. */
export const getTawaniHealth = (signal?: AbortSignal): Promise<TawaniHealth> =>
  request<TawaniHealth>('/health', { timeoutMs: 10_000, signal });

export interface NewsQuery {
  days?: number;
  category?: string;
  limit?: number;
}

/** Fast path: fetch + recency/relevance filter only. No LLM, no PDF. */
export const getTawaniNews = (
  period: TawaniNewsPeriod,
  query: NewsQuery = {},
  signal?: AbortSignal
): Promise<TawaniNewsListing> => {
  const params = new URLSearchParams();
  if (query.days != null) params.set('days', String(query.days));
  if (query.category) params.set('category', query.category);
  if (query.limit != null) params.set('limit', String(query.limit));

  const qs = params.toString();
  // Scraping a few dozen sources is slow even without the LLM.
  return request<TawaniNewsListing>(`/news/${period}${qs ? `?${qs}` : ''}`, {
    timeoutMs: 180_000,
    signal,
  });
};

/** Ceiling for a full pipeline run. The agent's own docs quote 1-6 minutes. */
const REPORT_TIMEOUT_MS = 12 * 60_000;

/**
 * Run a full report pipeline. The agent stores the result itself, as an
 * unpublished draft -- generating never changes what stockholders can see.
 */
export const generateTawaniReport = (
  type: TawaniReportType,
  body: { category?: string } = {},
  signal?: AbortSignal
): Promise<TawaniGenerateResult> =>
  request<TawaniGenerateResult>(`/reports/${type}?format=file`, {
    method: 'POST',
    // `category` only means anything to the daily pipeline; the others ignore it.
    body: type === 'daily' && body.category ? { category: body.category } : {},
    timeoutMs: REPORT_TIMEOUT_MS,
    signal,
  });

// --------------------------------------------------------------------------- //
// Report library
// --------------------------------------------------------------------------- //

export const listTawaniReports = async (
  publishedOnly = false,
  signal?: AbortSignal
): Promise<TawaniReport[]> => {
  const data = await request<{ count: number; reports: TawaniReport[] }>(
    `/library?published_only=${publishedOnly}&limit=200`,
    { signal }
  );
  return data.reports;
};

export const updateTawaniReport = (
  id: string,
  patch: { is_published?: boolean; title_ar?: string; title_en?: string }
): Promise<TawaniReport> =>
  request<TawaniReport>(`/library/${id}`, { method: 'PATCH', body: patch });

export const deleteTawaniReport = (id: string): Promise<{ status: string }> =>
  request<{ status: string }>(`/library/${id}`, { method: 'DELETE' });

/**
 * Direct URL to a stored report's PDF. Returned rather than fetched so it can be
 * opened in a tab or handed to a viewer without buffering the file in memory.
 */
export const tawaniReportPdfUrl = (id: string): string => `${BASE_URL}/library/${id}/pdf`;
