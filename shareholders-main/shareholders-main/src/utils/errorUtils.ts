import { TFunction } from 'i18next';

/**
 * Utility to map backend or service error messages to localized translation keys.
 * This ensures that even if the backend returns English strings, the user sees
 * the message in their preferred language.
 */
export const translateError = (message: string, t: TFunction): string => {
  if (!message) return t('errors.generic');

  const lowerMessage = message.toLowerCase();

  // Tawani agent sentinels. These are thrown as bare codes rather than prose so
  // they can be translated here -- never let one reach the UI unmapped.
  switch (message) {
    case 'TAWANI_UNREACHABLE':
      return t('errors.tawaniUnreachable');
    case 'TAWANI_NOT_CONFIGURED':
    case 'TAWANI_ERROR':
      return t('errors.tawaniError');
  }

  // Too many attempts / requests with time
  if (lowerMessage.includes('too many attempts') || lowerMessage.includes('too many requests')) {
    const secondsMatch = message.match(/(\d+) seconds/i);
    const minutesMatch = message.match(/(\d+) minutes/i);

    if (secondsMatch) {
      return t('errors.tooManyRequestsTime', { 
        count: secondsMatch[1], 
        unit: t('errors.seconds') 
      });
    }
    if (minutesMatch) {
      return t('errors.tooManyRequestsTime', { 
        count: minutesMatch[1], 
        unit: t('errors.minutes') 
      });
    }
    return t('errors.tooManyRequests');
  }

  // Deactivated account
  if (lowerMessage.includes('deactivated')) {
    return t('errors.accountDeactivated');
  }

  // Invalid National ID
  if (lowerMessage.includes('invalid national id')) {
    return t('errors.invalidNationalId');
  }

  // No account found or generic "Unable to send" which usually means inactive/not found
  if (lowerMessage.includes('no account found') || lowerMessage.includes('unable to find stockholder') || lowerMessage.includes('verify your details')) {
    return t('errors.noAccountFound');
  }
  if (lowerMessage.includes('unable to send verification code') || lowerMessage.includes('failed to send verification email')) {
    return t('errors.failedToSendOtp');
  }

  // SMS / Twilio errors
  if (lowerMessage.includes('unable to send an sms') || lowerMessage.includes('prefix is blocked') || lowerMessage.includes('fraud')) {
    return t('errors.smsFailed');
  }
  if (lowerMessage.includes('not a valid phone') || lowerMessage.includes('phone number on your account is not valid')) {
    return t('errors.invalidPhoneNumber');
  }

  // Auth / Session errors
  if (lowerMessage.includes('session expired')) {
    return t('errors.sessionExpired');
  }
  if (lowerMessage.includes('not authenticated')) {
    return t('errors.notAuthenticated');
  }
  if (lowerMessage.includes('authentication failed') || 
      lowerMessage.includes('invalid or expired verification code') ||
      lowerMessage.includes('auth session missing')) {
    return t('errors.authFailed');
  }

  // Loading data errors
  if (lowerMessage.includes('not be retrieved') || lowerMessage.includes('unable to load your information') || lowerMessage.includes('failed to load your information')) {
    return t('errors.failedToLoadInfo');
  }
  if (lowerMessage.includes('record was not found') || lowerMessage.includes('national id not found in user metadata')) {
    return t('errors.recordNotFound');
  }
  if (lowerMessage.includes('failed to identify your stockholder record')) {
    return t('errors.failedToIdentifyRecord');
  }
  if (lowerMessage.includes('access denied: stockholder record not found') || 
      lowerMessage.includes('stockholder link not found')) {
    return t('errors.accessDenied');
  }
  if (lowerMessage.includes('transaction history')) {
    return t('errors.failedToFetchHistory');
  }
  if (lowerMessage.includes('dividend data')) {
    return t('errors.failedToFetchDividends');
  }
  if (lowerMessage.includes('certificates')) {
    return t('errors.failedToFetchCertificates');
  }

  // Server errors
  if (lowerMessage.includes('server error')) {
    return t('errors.serverError');
  }

  // Fallback for specific service errors
  if (lowerMessage.includes('failed to send verification code') || lowerMessage.includes('verification requests')) {
    return t('errors.failedToSendOtp');
  }

  // If no match found, return the original message if it's not empty, 
  // otherwise a generic error.
  // Note: In production, you might want to return a generic message for unmatched errors
  // unless they are already localized (which they aren't here).
  return message;
};
