/** Contact form submissions received from the public site. */

import { supabaseClient } from '../supabaseClient';
import { logAction, AUDIT_ACTIONS } from '../auditService';

export interface ContactSubmission {
  id: string;
  name: string;
  email: string;
  phone_number?: string;
  subject: string;
  message: string;
  status: 'new' | 'read' | 'resolved';
  created_at: string;
}

export const getContactSubmissions = async (statusFilter?: string): Promise<ContactSubmission[]> => {
  let query = supabaseClient
    .from('contact_submissions')
    .select('*')
    .order('created_at', { ascending: false });

  if (statusFilter && statusFilter !== 'all') {
    query = query.eq('status', statusFilter);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
};

export const updateSubmissionStatus = async (id: string, status: string): Promise<void> => {
  const { error } = await supabaseClient
    .from('contact_submissions')
    .update({ status })
    .eq('id', id);

  if (error) throw new Error(error.message);
  logAction(AUDIT_ACTIONS.UPDATE_CONTACT_STATUS, 'contact_submissions', id, { status });
};
