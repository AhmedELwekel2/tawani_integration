/**
 * Subscribers (المشترك): people who receive published content but hold no shares.
 *
 * Deliberately much thinner than `stockholders` -- there is no shareholding,
 * so no transactions, dividends or certificates hang off this record. It exists
 * so a subscriber can be recognised at login (national ID + OTP to their phone)
 * and reached by announcement emails.
 */

import { supabaseClient } from '../supabaseClient';
import { logAction, AUDIT_ACTIONS } from '../auditService';
import { buildOrContains } from '../postgrestFilters';
import type { PaginatedResult } from './types';

export interface Subscriber {
  id: string;
  national_id: string;
  full_name_ar: string | null;
  full_name_en: string | null;
  email: string | null;
  phone_number: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string | null;
}

/** The fields the admin form writes. `is_active` is toggled separately. */
export interface SubscriberWrite {
  national_id: string;
  full_name_ar: string | null;
  full_name_en: string | null;
  email: string | null;
  phone_number: string | null;
}

const SEARCH_COLUMNS = ['national_id', 'full_name_ar', 'full_name_en', 'email', 'phone_number'];

export const getPaginatedSubscribers = async (
  page = 1,
  pageSize = 20,
  search?: string
): Promise<PaginatedResult<Subscriber>> => {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabaseClient
    .from('subscribers')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });

  const orFilter = search ? buildOrContains(SEARCH_COLUMNS, search) : null;
  if (orFilter) {
    query = query.or(orFilter);
  }

  const { data, error, count } = await query.range(from, to);
  if (error) throw new Error(error.message);

  return {
    data: (data as Subscriber[]) || [],
    count: count ?? 0,
  };
};

export const createSubscriber = async (row: SubscriberWrite): Promise<Subscriber> => {
  const { data, error } = await supabaseClient
    .from('subscribers')
    .insert(row)
    .select()
    .single();

  if (error) {
    // The national ID is the login identifier, so a collision is a real
    // conflict worth naming rather than a raw Postgres message.
    if (error.code === '23505') throw new Error('DUPLICATE_NATIONAL_ID');
    throw new Error(error.message);
  }

  logAction(AUDIT_ACTIONS.CREATE_SUBSCRIBER, 'subscribers', (data as Subscriber).id, {
    national_id: row.national_id,
  });
  return data as Subscriber;
};

export const updateSubscriber = async (
  id: string,
  row: Partial<SubscriberWrite>
): Promise<Subscriber> => {
  const { data, error } = await supabaseClient
    .from('subscribers')
    .update({ ...row, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    if (error.code === '23505') throw new Error('DUPLICATE_NATIONAL_ID');
    throw new Error(error.message);
  }

  logAction(AUDIT_ACTIONS.UPDATE_SUBSCRIBER, 'subscribers', id, {
    fields: Object.keys(row),
  });
  return data as Subscriber;
};

/**
 * Deactivating is the soft alternative to deleting: `auth-login` refuses an
 * inactive account, so access stops immediately without losing the record.
 */
export const setSubscriberActive = async (id: string, isActive: boolean): Promise<Subscriber> => {
  const { data, error } = await supabaseClient
    .from('subscribers')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(error.message);

  logAction(AUDIT_ACTIONS.TOGGLE_SUBSCRIBER_STATUS, 'subscribers', id, { status: isActive });
  return data as Subscriber;
};

export const deleteSubscriber = async (id: string): Promise<void> => {
  const { error } = await supabaseClient.from('subscribers').delete().eq('id', id);
  if (error) throw new Error(error.message);

  logAction(AUDIT_ACTIONS.DELETE_SUBSCRIBER, 'subscribers', id);
};
