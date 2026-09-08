/**
 * Read-only client for the Tawani tourism agent.
 *
 * The agent is a separate service with its own database; the portal never
 * stores reports in Supabase and never generates them. It asks the agent for
 * the published ones and links to their PDFs -- that is the whole contract.
 */

import { logger } from '../utils/logger';

const BASE_URL = (import.meta.env.VITE_TAWANI_API_URL || '').replace(/\/+$/, '');

export const isTawaniConfigured = (): boolean => BASE_URL.length > 0;

/** A tourism report the cooperative has published. */
export interface TawaniReport {
  id: string;
  report_type: 'daily' | 'weekly' | 'monthly' | 'magazine';
  title_ar: string;
  title_en: string;
  summary_ar: string | null;
  summary_en: string | null;
  pdf_file: string | null;
  generated_at: string;
  published_at: string | null;
}

/**
 * Fetch published reports. The `published_only` filter is applied by the agent,
 * so an unpublished draft is never sent to a stockholder's browser at all.
 */
export const getPublishedReports = async (signal?: AbortSignal): Promise<TawaniReport[]> => {
  if (!isTawaniConfigured()) throw new Error('TAWANI_NOT_CONFIGURED');

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/library?published_only=true&limit=100`, { signal });
  } catch (error) {
    // fetch() rejects with a bare TypeError when the service is unreachable.
    if (error instanceof TypeError) throw new Error('TAWANI_UNREACHABLE');
    throw error;
  }

  if (!response.ok) {
    logger.error('Tawani library request failed:', response.status);
    throw new Error('TAWANI_ERROR');
  }

  const data = (await response.json()) as { reports?: TawaniReport[] };
  return data.reports || [];
};

/** Direct URL to a published report's PDF, for the viewer to load. */
export const reportPdfUrl = (id: string): string => `${BASE_URL}/library/${id}/pdf`;

// ==================== NEWS ====================

/** Listing periods stockholders can browse. Generation is not exposed here. */
export type NewsPeriod = 'daily' | 'weekly' | 'monthly';

export interface NewsArticle {
  title: string | null;
  source: string | null;
  url: string | null;
  published_at: string | null;
  description: string | null;
  image: string | null;
}

export interface NewsListing {
  period: string;
  count: number;
  articles: NewsArticle[];
}

/**
 * Fetch the tourism news feed for a period.
 *
 * This is the agent's cheap path -- scrape and filter, no LLM and no PDF -- and
 * the agent caches each query, so many stockholders reading the same feed cost
 * one fetch between them.
 */
export const getNews = async (
  period: NewsPeriod,
  limit = 40,
  signal?: AbortSignal
): Promise<NewsListing> => {
  if (!isTawaniConfigured()) throw new Error('TAWANI_NOT_CONFIGURED');

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/news/${period}?limit=${limit}`, { signal });
  } catch (error) {
    if (error instanceof TypeError) throw new Error('TAWANI_UNREACHABLE');
    throw error;
  }

  if (!response.ok) {
    logger.error('Tawani news request failed:', response.status);
    throw new Error('TAWANI_ERROR');
  }

  return (await response.json()) as NewsListing;
};
