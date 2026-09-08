/** Stockholder records: listing, search, and CRUD. */

import { supabaseClient } from '../supabaseClient';
import { logAction, AUDIT_ACTIONS } from '../auditService';
import { buildOrContains } from '../postgrestFilters';
import { TRANSACTION_LIST_SELECT, calculateSharesFromTransactions, mapTransactionRow } from './shared';
import type {
  PaginatedResult,
  Stockholder,
  StockholderWithTransactions,
} from './types';

export const getAllStockholders = async (): Promise<Stockholder[]> => {
  const { data: stockholdersData, error: stockholdersError } = await supabaseClient
    .from('stockholders')
    .select('*')
    .order('created_at', { ascending: false });

  if (stockholdersError) throw new Error(stockholdersError.message);

  // Get all transactions to calculate shares
  const { data: transactionsData, error: transactionsError } = await supabaseClient
    .from('stockholder_transactions')
    .select('stockholder_id, transaction_type, shares');

  if (transactionsError) throw new Error(transactionsError.message);

  // Calculate shares for each stockholder
  const stockholdersWithShares = (stockholdersData || []).map((stockholder) => {
    const stockholderTransactions = (transactionsData || []).filter(
      (t) => t.stockholder_id === stockholder.id
    );

    return {
      ...stockholder,
      shares: calculateSharesFromTransactions(stockholderTransactions),
    };
  });

  return stockholdersWithShares;
};

export const getLookupStockholders = async (): Promise<Pick<Stockholder, 'id' | 'full_name_en' | 'full_name_ar' | 'national_id'>[]> => {
  const { data, error } = await supabaseClient
    .from('stockholders')
    .select('id, full_name_en, full_name_ar, national_id')
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return data || [];
};

export const getPaginatedStockholders = async (page: number = 1, pageSize: number = 20, search?: string): Promise<PaginatedResult<Stockholder>> => {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabaseClient
    .from('stockholders')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });

  const stockholderSearchFilter = buildOrContains(
    ['national_id', 'full_name_ar', 'full_name_en', 'email', 'phone_number'],
    search ?? ''
  );
  if (stockholderSearchFilter) {
    query = query.or(stockholderSearchFilter);
  }

  const { data: stockholdersData, error: stockholdersError, count } = await query.range(from, to);

  if (stockholdersError) throw new Error(stockholdersError.message);

  const stockholderIds = (stockholdersData || []).map((s) => s.id);

  if (stockholderIds.length === 0) {
    return { data: [], count: count || 0 };
  }

  // Get transactions for loaded stockholders
  const { data: transactionsData, error: transactionsError } = await supabaseClient
    .from('stockholder_transactions')
    .select('stockholder_id, transaction_type, shares')
    .in('stockholder_id', stockholderIds);

  if (transactionsError) throw new Error(transactionsError.message);

  // Calculate shares
  const stockholdersWithShares = (stockholdersData || []).map((stockholder) => {
    const stockholderTransactions = (transactionsData || []).filter(
      (t) => t.stockholder_id === stockholder.id
    );

    return {
      ...stockholder,
      shares: calculateSharesFromTransactions(stockholderTransactions),
    };
  });

  return { data: stockholdersWithShares, count: count || 0 };
};

export const getStockholderWithTransactions = async (id: string): Promise<StockholderWithTransactions> => {
  const { data: stockholder, error: stockholderError } = await supabaseClient
    .from('stockholders')
    .select('*')
    .eq('id', id)
    .single();

  if (stockholderError) throw new Error(stockholderError.message);

  const { data: transactions, error: transactionsError } = await supabaseClient
    .from('stockholder_transactions')
    .select(TRANSACTION_LIST_SELECT)
    .eq('stockholder_id', id)
    .order('transaction_date', { ascending: false });

  if (transactionsError) throw new Error(transactionsError.message);

  const { data: yearlyDividends, error: yearlyDividendsError } = await supabaseClient
    .from('yearly_dividends')
    .select('*')
    .eq('stockholder_id', id)
    .order('year', { ascending: false });

  if (yearlyDividendsError) throw new Error(yearlyDividendsError.message);

  return {
    ...stockholder,
    shares: calculateSharesFromTransactions(transactions || []),
    transactions: (transactions || []).map(mapTransactionRow),
    yearlyDividends: yearlyDividends || []
  };
};

export const createStockholder = async (
  stockholder: Omit<Stockholder, 'id' | 'created_at' | 'updated_at' | 'shares'>
): Promise<Stockholder> => {
  const { data, error } = await supabaseClient
    .from('stockholders')
    .insert(stockholder)
    .select()
    .single();

  if (error) throw new Error(error.message);
  logAction(AUDIT_ACTIONS.CREATE_STOCKHOLDER, 'stockholders', data.id, { national_id: stockholder.national_id });
  return data;
};

export const updateStockholder = async (
  id: string,
  updates: Partial<Omit<Stockholder, 'id' | 'updated_at' | 'shares'>>
): Promise<Stockholder> => {
  const { data, error } = await supabaseClient
    .from('stockholders')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  logAction(AUDIT_ACTIONS.UPDATE_STOCKHOLDER, 'stockholders', id, { fields: Object.keys(updates) });
  return data;
};

export const updateStockholderStatus = async (id: string, isActive: boolean): Promise<void> => {
  const { error } = await supabaseClient
    .from('stockholders')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw new Error(error.message);
  logAction(AUDIT_ACTIONS.TOGGLE_STOCKHOLDER_STATUS, 'stockholders', id, { is_active: isActive });
};

export const deleteStockholder = async (id: string): Promise<void> => {
  const { error } = await supabaseClient
    .from('stockholders')
    .delete()
    .eq('id', id);

  if (error) throw new Error(error.message);
  logAction(AUDIT_ACTIONS.DELETE_STOCKHOLDER, 'stockholders', id);
};
