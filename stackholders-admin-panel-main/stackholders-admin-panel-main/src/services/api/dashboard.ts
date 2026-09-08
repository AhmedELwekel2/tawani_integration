/** Aggregate figures for the dashboard landing view. */

import { supabaseClient } from '../supabaseClient';
import { TRANSACTION_LIST_SELECT, calculateSharesFromTransactions, mapTransactionRow } from './shared';
import type { DashboardStats } from './types';

export const getDashboardStats = async (): Promise<DashboardStats> => {
  // Get total stockholders count
  const { count: totalStockholders, error: stockholdersError } = await supabaseClient
    .from('stockholders')
    .select('*', { count: 'exact', head: true });

  if (stockholdersError) throw new Error(stockholdersError.message);

  // Calculate total shares from all transactions
  const { data: allTransactions, error: transactionsError } = await supabaseClient
    .from('stockholder_transactions')
    .select('transaction_type, shares');

  if (transactionsError) throw new Error(transactionsError.message);

  const totalShares = calculateSharesFromTransactions(allTransactions || []);

  // Get total transactions count
  const { count: totalTransactions, error: transactionsCountError } = await supabaseClient
    .from('stockholder_transactions')
    .select('*', { count: 'exact', head: true });

  if (transactionsCountError) throw new Error(transactionsCountError.message);

  // Get recent transactions
  const { data: recentTransactions, error: recentTransactionsError } = await supabaseClient
    .from('stockholder_transactions')
    .select(TRANSACTION_LIST_SELECT)
    .order('transaction_date', { ascending: false })
    .limit(10);

  if (recentTransactionsError) throw new Error(recentTransactionsError.message);

  // Get all yearly dividends
  const { data: yearlyDividends, error: yearlyDividendsError } = await supabaseClient
    .from('yearly_dividends')
    .select('*')
    .order('year', { ascending: true });

  if (yearlyDividendsError) throw new Error(yearlyDividendsError.message);

  return {
    totalStockholders: totalStockholders || 0,
    totalShares,
    totalTransactions: totalTransactions || 0,
    recentTransactions: (recentTransactions || []).map(mapTransactionRow),
    yearlyDividends: yearlyDividends || [],
  };
};
