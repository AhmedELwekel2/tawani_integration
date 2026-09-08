import { TFunction } from 'i18next';

/**
 * Maps common Supabase/Database error messages to friendly translated strings.
 * @param error The original error message or object
 * @param t Translation function
 * @param fallback Alternative fallback key if no match found
 */
export const getFriendlyError = (error: unknown, t: TFunction, fallback?: string): string => {
  if (!error) return '';

  const message = error instanceof Error ? error.message : String(error);
  
  // Auth Errors
  if (message.includes('Invalid login credentials')) {
    return t('common.errors.invalidLogin');
  }
  if (message.includes('Email not confirmed')) {
    return t('common.errors.emailNotConfirmed');
  }
  if (message.includes('User not found')) {
    return t('common.errors.userNotFound');
  }
  if (message.includes('Invalid email format')) {
    return t('common.errors.invalidEmail');
  }
  if (message.includes('Email has already been taken')) {
    return t('common.errors.duplicateKey');
  }

  if (message.includes('stockholders_national_id_key') || (message.includes('stockholders') && message.includes('national_id'))) {
    return t('stockholders.addModal.errors.duplicateNationalId');
  }
  if (message.includes('stockholders_email_key') || (message.includes('stockholders') && message.includes('email'))) {
    return t('stockholders.addModal.errors.duplicateEmail', 'Email already in use');
  }
  if (message.includes('stockholders_phone_number_key') || (message.includes('stockholders') && message.includes('phone_number'))) {
    return t('stockholders.addModal.errors.duplicatePhone');
  }

  // Database Errors
  if (message.includes('duplicate key value violates unique constraint')) {
    return t('common.errors.duplicateKey');
  }
  if (message.includes('null value in column') && message.includes('violates not-null constraint')) {
    return t('common.errors.notNull');
  }
  if (message.includes('violates foreign key constraint')) {
    return t('common.errors.foreignKey');
  }
  if (message.includes('JWT expired') || message.includes('not logged in')) {
    return t('common.errors.unauthorized');
  }
  if (message.includes('permission denied') || message.includes('forbidden')) {
    return t('common.errors.forbidden');
  }

  // Network Errors
  if (message.includes('Failed to fetch') || message.includes('Network request failed') || message.includes('ERR_NAME_NOT_RESOLVED')) {
    return t('common.errors.networkError');
  }

  // Fallback
  if (fallback) return t(fallback);
  
  // If it's a generic "Error" or "Login failed" from our own code, use common.errors.unexpected
  if (message === 'Error' || message === 'Login failed' || message === 'Failed to load data') {
    return t('common.errors.unexpected');
  }

  return message;
};
