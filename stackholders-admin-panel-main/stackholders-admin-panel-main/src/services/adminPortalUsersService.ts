/**
 * Calls Edge Function admin-portal-users (service role) to list / create / delete portal admin accounts.
 */

import { supabaseClient } from './supabaseClient';
import { logAction, AUDIT_ACTIONS } from './auditService';

/** Roles that sign into this panel. Shareholders and subscribers do not. */
export type StaffRole = 'admin' | 'editor';

export interface PortalAdminRow {
  id: string;
  email: string;
  /** Older responses predate roles; treat a missing value as 'admin'. */
  role?: StaffRole;
}

function functionsUrl(): string {
  const base = import.meta.env.VITE_SUPABASE_URL;
  if (!base) throw new Error('VITE_SUPABASE_URL is not set');
  return `${base.replace(/\/$/, '')}/functions/v1/admin-portal-users`;
}

function publishableOrAnonKey(): string {
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!key) throw new Error('VITE_SUPABASE_ANON_KEY or VITE_SUPABASE_PUBLISHABLE_KEY is required');
  return key;
}

async function authHeaders(): Promise<HeadersInit> {
  const {
    data: { session: current },
  } = await supabaseClient.auth.getSession();
  if (!current) throw new Error('Not authenticated');

  return {
    Authorization: `Bearer ${current.access_token}`,
    apikey: publishableOrAnonKey(),
    'Content-Type': 'application/json',
  };
}

export async function listPortalAdmins(): Promise<PortalAdminRow[]> {
  const res = await fetch(functionsUrl(), { method: 'GET', headers: await authHeaders() });
  const json = (await res.json()) as { users?: PortalAdminRow[]; error?: string };
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json.users ?? [];
}

export async function createPortalAdmin(
  email: string,
  password: string,
  role: StaffRole = 'admin'
): Promise<PortalAdminRow> {
  const res = await fetch(functionsUrl(), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ email, password, role }),
  });
  const json = (await res.json()) as { user?: PortalAdminRow; error?: string };
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  if (!json.user) throw new Error('Invalid response');
  logAction(AUDIT_ACTIONS.CREATE_ADMIN, 'auth_users', json.user.id, { email, role });
  return json.user;
}

export async function deletePortalAdmin(userId: string): Promise<void> {
  const url = `${functionsUrl()}?user_id=${encodeURIComponent(userId)}`;
  const res = await fetch(url, { method: 'DELETE', headers: await authHeaders() });
  const json = (await res.json()) as { ok?: boolean; error?: string };
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  logAction(AUDIT_ACTIONS.DELETE_ADMIN, 'auth_users', userId);
}
