/**
 * Audit Service
 * Writes admin actions to the audit_log table and provides read access.
 * Table schema: id (bigint), actor_id (uuid), actor_email (text),
 *               action (text), target_table (text), target_id (text?),
 *               details (jsonb?), ip_address (text?), created_at (timestamptz)
 */

import { supabaseClient } from './supabaseClient';
import { buildOrContains } from './postgrestFilters';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuditLog {
  id: number;
  actor_id: string;
  actor_email: string;
  action: string;
  target_table: string;
  target_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

export interface AuditLogFilters {
  target_table?: string;
  action?: string;
  search?: string;       // free-text on action or actor_email
  dateFrom?: string;     // ISO date string
  dateTo?: string;       // ISO date string
  page?: number;
  pageSize?: number;
}

export interface PaginatedAuditLogs {
  data: AuditLog[];
  count: number;
}

// ─── Action constants ─────────────────────────────────────────────────────────

export const AUDIT_ACTIONS = {
  // Auth
  LOGIN:                   'LOGIN',
  LOGOUT:                  'LOGOUT',
  CHANGE_PASSWORD:         'CHANGE_PASSWORD',
  // Stockholders
  CREATE_STOCKHOLDER:      'CREATE_STOCKHOLDER',
  UPDATE_STOCKHOLDER:      'UPDATE_STOCKHOLDER',
  TOGGLE_STOCKHOLDER_STATUS: 'TOGGLE_STOCKHOLDER_STATUS',
  DELETE_STOCKHOLDER:      'DELETE_STOCKHOLDER',
  // Transactions
  CREATE_TRANSACTION:      'CREATE_TRANSACTION',
  UPDATE_TRANSACTION:      'UPDATE_TRANSACTION',
  DELETE_TRANSACTION:      'DELETE_TRANSACTION',
  // Dividends
  CREATE_DIVIDEND:         'CREATE_DIVIDEND',
  UPDATE_DIVIDEND:         'UPDATE_DIVIDEND',
  DELETE_DIVIDEND:         'DELETE_DIVIDEND',
  // Certificates
  UPLOAD_CERTIFICATE:      'UPLOAD_CERTIFICATE',
  DELETE_CERTIFICATE:      'DELETE_CERTIFICATE',
  // Approval docs
  UPLOAD_APPROVAL_DOC:     'UPLOAD_APPROVAL_DOC',
  // Contact
  UPDATE_CONTACT_STATUS:   'UPDATE_CONTACT_STATUS',
  // Survey
  CREATE_SURVEY_QUESTION:  'CREATE_SURVEY_QUESTION',
  UPDATE_SURVEY_QUESTION:  'UPDATE_SURVEY_QUESTION',
  DELETE_SURVEY_QUESTION:  'DELETE_SURVEY_QUESTION',
  // Admin Management
  CREATE_ADMIN:            'CREATE_ADMIN',
  DELETE_ADMIN:            'DELETE_ADMIN',
  // Announcements
  CREATE_ANNOUNCEMENT:     'CREATE_ANNOUNCEMENT',
  UPDATE_ANNOUNCEMENT:     'UPDATE_ANNOUNCEMENT',
  DELETE_ANNOUNCEMENT:     'DELETE_ANNOUNCEMENT',
  PUBLISH_ANNOUNCEMENT:    'PUBLISH_ANNOUNCEMENT',
  UPLOAD_ANNOUNCEMENT_PDF: 'UPLOAD_ANNOUNCEMENT_PDF',
  UPLOAD_ANNOUNCEMENT_COVER: 'UPLOAD_ANNOUNCEMENT_COVER',
  SEND_ANNOUNCEMENT_NOTIFICATION: 'SEND_ANNOUNCEMENT_NOTIFICATION',
  // Subscribers
  CREATE_SUBSCRIBER:       'CREATE_SUBSCRIBER',
  UPDATE_SUBSCRIBER:       'UPDATE_SUBSCRIBER',
  TOGGLE_SUBSCRIBER_STATUS: 'TOGGLE_SUBSCRIBER_STATUS',
  DELETE_SUBSCRIBER:       'DELETE_SUBSCRIBER',
  // Tawani reports
  GENERATE_TAWANI_REPORT:  'GENERATE_TAWANI_REPORT',
  PUBLISH_TAWANI_REPORT:   'PUBLISH_TAWANI_REPORT',
  DELETE_TAWANI_REPORT:    'DELETE_TAWANI_REPORT',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

// ─── Write helper ─────────────────────────────────────────────────────────────

/**
 * Fire-and-forget audit log insertion. Never throws — failures are only
 * console.warn'd so they never break the main user flow.
 */
export const logAction = async (
  action: AuditAction | string,
  targetTable: string,
  targetId?: string | null,
  details?: Record<string, unknown>
): Promise<void> => {
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return; // not authenticated — skip

    await supabaseClient.from('audit_log').insert({
      actor_id:    user.id,
      actor_email: user.email ?? 'unknown',
      action,
      target_table: targetTable,
      target_id:   targetId ?? null,
      details:     details ?? {},
    });
  } catch (err) {
    // Never surface audit failures to the user
    console.warn('[audit] failed to write log entry:', err);
  }
};

// ─── Read helper ─────────────────────────────────────────────────────────────

export const getAuditLogs = async (
  filters: AuditLogFilters = {}
): Promise<PaginatedAuditLogs> => {
  const {
    target_table,
    action,
    search,
    dateFrom,
    dateTo,
    page = 1,
    pageSize = 20,
  } = filters;

  const from = (page - 1) * pageSize;
  const to   = from + pageSize - 1;

  let query = supabaseClient
    .from('audit_log')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (target_table && target_table !== 'all') {
    query = query.eq('target_table', target_table);
  }
  if (action && action !== 'all') {
    query = query.eq('action', action);
  }
  const auditSearchFilter = buildOrContains(['action', 'actor_email', 'target_id'], search ?? '');
  if (auditSearchFilter) {
    query = query.or(auditSearchFilter);
  }
  if (dateFrom) {
    query = query.gte('created_at', dateFrom);
  }
  if (dateTo) {
    // Include the full end day
    const end = new Date(dateTo);
    end.setDate(end.getDate() + 1);
    query = query.lt('created_at', end.toISOString());
  }

  const { data, error, count } = await query.range(from, to);
  if (error) throw new Error(error.message);

  return { data: (data as AuditLog[]) || [], count: count || 0 };
};
