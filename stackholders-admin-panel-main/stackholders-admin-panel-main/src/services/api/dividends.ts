/** Yearly dividend records per stockholder. */

import { supabaseClient } from '../supabaseClient';
import { logAction, AUDIT_ACTIONS } from '../auditService';
// YearlyDividends lives in ./types because stockholders and dashboard need it too.
import type { YearlyDividends } from './types';

export const getAllDividends = async (): Promise<YearlyDividends[]> => {
  const { data, error } = await supabaseClient
    .from('yearly_dividends')
    .select('*')
    .order('year', { ascending: false });

  if (error) throw new Error(error.message);
  return data || [];
};



export const createDividend = async (
  row: Omit<YearlyDividends, 'id' | 'created_at' | 'updated_at'>
): Promise<YearlyDividends> => {
  const { data, error } = await supabaseClient
    .from('yearly_dividends')
    .insert(row)
    .select()
    .single();

  if (error) throw new Error(error.message);
  logAction(AUDIT_ACTIONS.CREATE_DIVIDEND, 'yearly_dividends', data.id, { year: row.year, stockholder_id: row.stockholder_id });
  return data;
};

export const updateDividend = async (
  id: string,
  updates: Partial<Omit<YearlyDividends, 'id' | 'created_at' | 'updated_at'>>
): Promise<YearlyDividends> => {
  const { data, error } = await supabaseClient
    .from('yearly_dividends')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  logAction(AUDIT_ACTIONS.UPDATE_DIVIDEND, 'yearly_dividends', id, { fields: Object.keys(updates) });
  return data;
};

export const deleteDividend = async (id: string): Promise<void> => {
  const { error } = await supabaseClient
    .from('yearly_dividends')
    .delete()
    .eq('id', id);

  if (error) throw new Error(error.message);
  logAction(AUDIT_ACTIONS.DELETE_DIVIDEND, 'yearly_dividends', id);
};
