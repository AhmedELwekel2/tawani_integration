import { supabaseClient } from './supabaseClient';
import { logger } from '../utils/logger';

interface ContactSubmission {
  name: string;
  email: string;
  phone_number?: string;
  subject: string;
  message: string;
}

/**
 * Submits a contact form to the database
 */
export const submitContactForm = async (data: ContactSubmission): Promise<void> => {
  try {
    const { error } = await supabaseClient
      .from('contact_submissions')
      .insert([
        {
          name: data.name,
          email: data.email,
          phone_number: data.phone_number,
          subject: data.subject,
          message: data.message,
          status: 'new'
        }
      ]);

    if (error) throw error;
  } catch (err) {
    logger.error('Error submitting contact form:', err);
    throw err;
  }
};
