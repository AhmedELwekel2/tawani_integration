/** Share purchase/sell transactions. */

import { supabaseClient } from '../supabaseClient';
import { logAction, AUDIT_ACTIONS } from '../auditService';
import { buildOrContains } from '../postgrestFilters';
import { TRANSACTION_LIST_SELECT, mapTransactionRow } from './shared';
import type { PaginatedResult, Transaction } from './types';

export const getAllTransactions = async (): Promise<Transaction[]> => {
  const { data, error } = await supabaseClient
    .from('stockholder_transactions')
    .select(TRANSACTION_LIST_SELECT)
    .order('transaction_date', { ascending: false });

  if (error) throw new Error(error.message);
  return (data || []).map(mapTransactionRow);
};

export const getPaginatedTransactions = async (
  page: number = 1,
  pageSize: number = 20,
  searchQuery: string = ''
): Promise<PaginatedResult<Transaction>> => {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  if (searchQuery.trim()) {
    const q = searchQuery.trim();
    
    // 1. Search using the established database view which includes stockholder names and transaction ID as text
    const { data: matchedRecords, count, error: searchError } = await supabaseClient
      .from('v_stockholder_transactions_search')
      .select('id', { count: 'exact' })
      .or(buildOrContains(
        ['notes', 'id_text', 'stockholder_name_ar', 'stockholder_name_en', 'stockholder_national_id'],
        q
      ) as string)
      .order('transaction_date', { ascending: false })
      .range(from, to);
    
    if (searchError) throw new Error(searchError.message);
    
    const transactionIds = (matchedRecords || []).map(r => r.id);
    
    if (transactionIds.length === 0) {
      return { data: [], count: 0 };
    }
    
    // 2. Fetch the full transaction data including approvals for the current page of results
    const { data, error } = await supabaseClient
      .from('stockholder_transactions')
      .select(TRANSACTION_LIST_SELECT)
      .in('id', transactionIds)
      .order('transaction_date', { ascending: false });

    if (error) throw new Error(error.message);
    
    return {
      data: (data || []).map(mapTransactionRow),
      count: count || 0,
    };
  }

  // Normal paginated fetch without search
  const { data, error, count } = await supabaseClient
    .from('stockholder_transactions')
    .select(TRANSACTION_LIST_SELECT, { count: 'exact' })
    .order('transaction_date', { ascending: false })
    .range(from, to);

  if (error) throw new Error(error.message);
  
  return {
    data: (data || []).map(mapTransactionRow),
    count: count || 0,
  };
};

export const getTransactionsByStockholderId = async (stockholderId: string): Promise<Transaction[]> => {
  const { data, error } = await supabaseClient
    .from('stockholder_transactions')
    .select(TRANSACTION_LIST_SELECT)
    .eq('stockholder_id', stockholderId)
    .order('transaction_date', { ascending: false });

  if (error) throw new Error(error.message);
  return (data || []).map(mapTransactionRow);
};



type TransactionWrite = Omit<
  Transaction,
  'id' | 'created_at' | 'approval_document_storage_path' | 'approval_document_name'
>;

export const createTransaction = async (
  transaction: TransactionWrite
): Promise<Transaction> => {
  const { data, error } = await supabaseClient
    .from('stockholder_transactions')
    .insert(transaction)
    .select(TRANSACTION_LIST_SELECT)
    .single();

  if (error) throw new Error(error.message);
  const mapped = mapTransactionRow(data as Record<string, unknown>);
  logAction(AUDIT_ACTIONS.CREATE_TRANSACTION, 'stockholder_transactions', mapped.id, { type: transaction.transaction_type, shares: transaction.shares });
  return mapped;
};

export const updateTransaction = async (
  id: string,
  updates: Partial<TransactionWrite>
): Promise<Transaction> => {
  const { data, error } = await supabaseClient
    .from('stockholder_transactions')
    .update(updates)
    .eq('id', id)
    .select(TRANSACTION_LIST_SELECT)
    .single();

  if (error) throw new Error(error.message);
  logAction(AUDIT_ACTIONS.UPDATE_TRANSACTION, 'stockholder_transactions', id, { fields: Object.keys(updates) });
  return mapTransactionRow(data as Record<string, unknown>);
};

export const deleteTransaction = async (id: string): Promise<void> => {
  const { data: approval } = await supabaseClient
    .from('stockholder_transaction_approvals')
    .select('storage_path')
    .eq('transaction_id', id)
    .maybeSingle();

  if (approval?.storage_path) {
    await supabaseClient.storage.from('approval-documents').remove([approval.storage_path]);
  }

  const { error } = await supabaseClient
    .from('stockholder_transactions')
    .delete()
    .eq('id', id);

  if (error) throw new Error(error.message);
  logAction(AUDIT_ACTIONS.DELETE_TRANSACTION, 'stockholder_transactions', id);
};
