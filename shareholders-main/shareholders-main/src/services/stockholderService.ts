/**
 * Stockholder Service
 * Handles authentication and data fetching directly with Supabase
 */

import { supabaseClient } from './supabaseClient';
import { logger } from '../utils/logger';

/** Row from public.stockholders (excluding computed shares). */
export interface Stockholder {
  id: string;
  national_id: string;
  full_name_ar: string | null;
  full_name_en: string | null;
  email: string | null;
  phone_number: string | null;
  birth_date_hijri: string | null;
  birth_date_gregorian: string | null;
  birth_place: string | null;
  address_building: string | null;
  address_street: string | null;
  address_district: string | null;
  address_city: string | null;
  address_postal_code: string | null;
  address_additional_number: string | null;
  created_at: string | null;
  updated_at: string | null;
  /** Present when joined with transaction aggregates in admin lists */
  shares?: number;
}

export function stockholderDisplayName(
  s: Pick<Stockholder, 'full_name_en' | 'full_name_ar' | 'national_id'>,
  lang?: string
): string {
  const en = s.full_name_en?.trim();
  const ar = s.full_name_ar?.trim();
  if (lang === 'ar') return ar || en || s.national_id;
  return en || ar || s.national_id;
}

type SessionUserLike = {
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
};

export function getSessionNationalId(user: SessionUserLike | null | undefined): string | null {
  const appMetadataNationalId = typeof user?.app_metadata?.national_id === 'string'
    ? user.app_metadata.national_id.trim()
    : '';
  if (appMetadataNationalId) {
    return appMetadataNationalId;
  }

  const userMetadataNationalId = typeof user?.user_metadata?.national_id === 'string'
    ? user.user_metadata.national_id.trim()
    : '';
  return userMetadataNationalId || null;
}

/**
 * Portal user kinds. A shareholder holds shares and sees their financial data;
 * a subscriber only sees published content (announcements, news, reports).
 */
export type PortalRole = 'shareholder' | 'subscriber';

/**
 * Read the role from the session. `auth-login` stamps it, but sessions issued
 * before subscribers existed carry no role -- those are all shareholders, so
 * that is the safe default.
 */
export function getSessionRole(user: SessionUserLike | null | undefined): PortalRole {
  return user?.app_metadata?.role === 'subscriber' ? 'subscriber' : 'shareholder';
}

export interface Transaction {
  id: string;
  stockholder_id: string;
  transaction_type: 'purchase' | 'sell';
  shares: number;
  price_per_share: number | null;
  total_amount: number | null;
  transaction_date: string;
  notes: string | null;
  created_at: string;
}

/**
 * Login with National ID using Supabase Edge Function
 * The Edge Function handles user creation/lookup and returns session
 */
export const loginWithNationalId = async (nationalId: string, otpCode: string): Promise<{
  access_token: string;
  refresh_token: string;
  user: { id: string; national_id: string; role?: PortalRole };
}> => {
  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
  const functionUrl = `${SUPABASE_URL}/functions/v1/auth-login`;

  const response = await fetch(functionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ national_id: nationalId.trim(), otp_code: otpCode.trim() }),
  });

  if (!response.ok) {
    let errorMessage = 'Invalid National ID';
    try {
      const errorData = await response.json();
      const retryAfterSeconds: number | undefined = errorData.retry_after_seconds;
      if (response.status === 429 && retryAfterSeconds !== undefined && retryAfterSeconds > 0) {
        const minutes = Math.ceil(retryAfterSeconds / 60);
        errorMessage = minutes <= 1
          ? `Too many attempts. Please try again in ${retryAfterSeconds} seconds.`
          : `Too many attempts. Please try again in ${minutes} minutes.`;
      } else {
        errorMessage = errorData.message || errorMessage;
      }
    } catch {
      if (response.status === 429) {
        errorMessage = 'Too many attempts. Please try again later.';
      } else if (response.status === 403) {
        errorMessage = 'Your account has been deactivated. Please contact support.';
      } else if (response.status === 401) {
        errorMessage = 'Invalid National ID';
      } else if (response.status === 500) {
        errorMessage = 'Server error. Please try again later.';
      } else {
        errorMessage = 'Authentication failed. Please try again.';
      }
    }
    throw new Error(errorMessage);
  }

  return response.json();
};

/**
 * Send OTP to stockholder
 */
export const sendOtp = async (nationalId: string, lang: string = 'ar'): Promise<{ message: string; hint: string; verify_method: string }> => {
  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
  const functionUrl = `${SUPABASE_URL}/functions/v1/auth-send-otp`;

  console.log('Sending OTP request for lang:', lang);
  const response = await fetch(functionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ national_id: nationalId.trim(), lang }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || 'Failed to send verification code');
  }

  const result = await response.json();
  return {
    message: result.message,
    hint: result.hint || result.phone_hint || '',
    verify_method: result.verify_method || 'sms',
  };
};

/**
 * Get current stockholder data directly from Supabase
 * Uses RLS to ensure users can only access their own record
 */
export const getCurrentStockholder = async (): Promise<Stockholder> => {
  const { data: { user }, error: userError } = await supabaseClient.auth.getUser();

  if (userError || !user) {
    throw new Error('Not authenticated');
  }

  const nationalId = getSessionNationalId(user);
  
  if (!nationalId) {
    throw new Error('National ID not found in user metadata');
  }

  // Query by national_id - RLS policy will ensure user can only see their own record
  const { data, error } = await supabaseClient
    .from('stockholders')
    .select('*')
    .eq('national_id', nationalId)
    .maybeSingle();

  if (error) {
    logger.error('Stockholder query error:', error);
    const isDevelopment = import.meta.env.DEV;
    const errorMessage = error.message || 'Error fetching stockholder data';
    throw new Error(isDevelopment ? errorMessage : 'Unable to load your information. Please try again.');
  }

  if (!data) {
    logger.warn(`No stockholder record found for National ID: ${nationalId}`);
    throw new Error('Your stockholder record was not found. Please contact support.');
  }

  return data as Stockholder;
};

interface PaginatedResult<T> {
  data: T[];
  count: number;
}

/**
 * Get transaction history for current stockholder
 * Uses RLS to ensure users can only access their own transactions
 */
export const getTransactionHistory = async (page: number = 1, pageSize: number = 20): Promise<PaginatedResult<Transaction>> => {
  const { data: { user }, error: userError } = await supabaseClient.auth.getUser();

  if (userError || !user) {
    throw new Error('Not authenticated');
  }

  const nationalId = getSessionNationalId(user);
  
  if (!nationalId) {
    throw new Error('National ID not found in user metadata');
  }

  // First get the stockholder ID
  const { data: stockholder, error: stockholderError } = await supabaseClient
    .from('stockholders')
    .select('id')
    .eq('national_id', nationalId)
    .maybeSingle();

  if (stockholderError) {
    logger.error('Error fetching stockholder ID:', stockholderError);
    throw new Error('Failed to identify your stockholder record');
  }

  if (!stockholder) {
    logger.warn(`Stockholder link not found for National ID: ${nationalId}`);
    throw new Error('Access denied: Stockholder record not found');
  }

  // Query transactions - RLS will ensure user can only see their own transactions
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await supabaseClient
    .from('stockholder_transactions')
    .select(
      'id, stockholder_id, transaction_type, shares, price_per_share, total_amount, transaction_date, notes, created_at',
      { count: 'exact' }
    )
    .eq('stockholder_id', stockholder.id)
    .order('transaction_date', { ascending: false })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    logger.error('Transaction query error:', error);
    // Don't expose internal error details in production
    const isDevelopment = import.meta.env.DEV;
    const errorMessage = error.message || 'Failed to fetch transaction history';
    throw new Error(isDevelopment ? errorMessage : 'Unable to load transaction history. Please try again.');
  }

  return { data: (data || []) as Transaction[], count: count || 0 };
};

/**
 * Calculate total shares from transaction history
 * Purchases and transfers_in add shares, sells and transfers_out subtract shares
 */
export const calculateTotalSharesFromTransactions = (transactions: Transaction[]): number => {
  return transactions.reduce((total, transaction) => {
    switch (transaction.transaction_type) {
      case 'purchase':
        return total + transaction.shares;
      case 'sell':
        return total - transaction.shares;
      default:
        return total;
    }
  }, 0);
};

/**
 * Calculate total shares value (SAR) from transaction history.
 * Purchases add their total_amount, sells subtract it. Falls back to
 * shares × price_per_share when total_amount is missing.
 */
export const calculateTotalValueFromTransactions = (transactions: Transaction[]): number => {
  return transactions.reduce((total, transaction) => {
    const amount =
      transaction.total_amount ?? transaction.shares * (transaction.price_per_share ?? 0);
    switch (transaction.transaction_type) {
      case 'purchase':
        return total + amount;
      case 'sell':
        return total - amount;
      default:
        return total;
    }
  }, 0);
};

/**
 * Get all transaction history for current stockholder (no limit)
 * Used for calculating total shares
 */
export const getAllTransactionHistory = async (): Promise<Transaction[]> => {
  const { data: { user }, error: userError } = await supabaseClient.auth.getUser();

  if (userError || !user) {
    throw new Error('Not authenticated');
  }

  const nationalId = getSessionNationalId(user);
  
  if (!nationalId) {
    throw new Error('National ID not found in user metadata');
  }

  // First get the stockholder ID
  const { data: stockholder, error: stockholderError } = await supabaseClient
    .from('stockholders')
    .select('id')
    .eq('national_id', nationalId)
    .maybeSingle();

  if (stockholderError) {
    logger.error('Error fetching stockholder ID for totals:', stockholderError);
    throw new Error('Failed to identify your stockholder record');
  }

  if (!stockholder) {
    throw new Error('Access denied: Stockholder record not found');
  }

  // Query all transactions - RLS will ensure user can only see their own transactions
  const { data, error } = await supabaseClient
    .from('stockholder_transactions')
    .select(
      'id, stockholder_id, transaction_type, shares, price_per_share, total_amount, transaction_date, notes, created_at'
    )
    .eq('stockholder_id', stockholder.id)
    .order('transaction_date', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    logger.error('Transaction query error:', error);
    // Don't expose internal error details in production
    const isDevelopment = import.meta.env.DEV;
    const errorMessage = error.message || 'Failed to fetch transaction history';
    throw new Error(isDevelopment ? errorMessage : 'Unable to load transaction history. Please try again.');
  }

  return (data || []) as Transaction[];
};

export interface YearlyDividends {
  id: string;
  stockholder_id: string;
  year: number;
  amount: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Get yearly dividend records for the current stockholder
 */
export const getYearlyDividends = async (): Promise<YearlyDividends[]> => {
  const { data: { user }, error: userError } = await supabaseClient.auth.getUser();

  if (userError || !user) {
    throw new Error('Not authenticated');
  }

  const nationalId = getSessionNationalId(user);
  if (!nationalId) {
    throw new Error('National ID not found in user metadata');
  }

  // Get stockholder ID
  const { data: stockholder, error: stockholderError } = await supabaseClient
    .from('stockholders')
    .select('id')
    .eq('national_id', nationalId)
    .maybeSingle();

  if (stockholderError) {
    logger.error('Error fetching stockholder ID for dividends:', stockholderError);
    throw new Error('Failed to identify your stockholder record');
  }

  if (!stockholder) {
    throw new Error('Access denied: Stockholder record not found');
  }

  const { data, error } = await supabaseClient
    .from('yearly_dividends')
    .select('*')
    .eq('stockholder_id', stockholder.id)
    .order('year', { ascending: false });

  if (error) {
    logger.error('Dividends query error:', error);
    const isDevelopment = import.meta.env.DEV;
    const errorMessage = error.message || 'Failed to fetch dividend data';
    throw new Error(isDevelopment ? errorMessage : 'Unable to load dividend data. Please try again.');
  }

  return (data || []) as YearlyDividends[];
};

/**
 * Calculate total lifetime dividends from yearly dividend records
 */
export const calculateTotalDividends = (rows: YearlyDividends[]): number => {
  return rows.reduce((total, row) => total + Number(row.amount), 0);
};

export interface StockCertificate {
  id: string;
  stockholder_id: string;
  transaction_id: string | null;
  file_url: string;
  storage_path: string | null;
  file_name: string;
  uploaded_at: string;
  uploaded_by: string | null;
}

function extractCertificatePath(fileUrl: string | null | undefined): string | null {
  if (!fileUrl) {
    return null;
  }

  const marker = '/storage/v1/object/public/stock-certificates/';
  const markerIndex = fileUrl.indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }

  return decodeURIComponent(fileUrl.slice(markerIndex + marker.length));
}

async function withSignedCertificateUrl(cert: StockCertificate): Promise<StockCertificate> {
  const storagePath = cert.storage_path || extractCertificatePath(cert.file_url);
  if (!storagePath) {
    return cert;
  }

  const { data, error } = await supabaseClient.storage
    .from('stock-certificates')
    .createSignedUrl(storagePath, 60 * 60);

  if (error || !data?.signedUrl) {
    logger.error('Certificate signed URL error:', error);
    return { ...cert, storage_path: storagePath };
  }

  return {
    ...cert,
    storage_path: storagePath,
    file_url: data.signedUrl,
  };
}

/**
 * Get all stock certificates for the current stockholder
 * Uses RLS to ensure users can only see their own certificates
 */
export const getStockCertificates = async (): Promise<StockCertificate[]> => {
  const { data: { user }, error: userError } = await supabaseClient.auth.getUser();

  if (userError || !user) {
    throw new Error('Not authenticated');
  }

  const nationalId = getSessionNationalId(user);
  if (!nationalId) {
    throw new Error('National ID not found in user metadata');
  }

  // Get stockholder ID
  const { data: stockholder, error: stockholderError } = await supabaseClient
    .from('stockholders')
    .select('id')
    .eq('national_id', nationalId)
    .maybeSingle();

  if (stockholderError) {
    logger.error('Error fetching stockholder ID for certificates:', stockholderError);
    throw new Error('Failed to identify your stockholder record');
  }

  if (!stockholder) {
    throw new Error('Access denied: Stockholder record not found');
  }

  const { data, error } = await supabaseClient
    .from('stock_certificates')
    .select('*')
    .eq('stockholder_id', stockholder.id)
    .order('uploaded_at', { ascending: false });

  if (error) {
    logger.error('Certificate query error:', error);
    const isDevelopment = import.meta.env.DEV;
    const errorMessage = error.message || 'Failed to fetch certificates';
    throw new Error(isDevelopment ? errorMessage : 'Unable to load your certificates. Please try again.');
  }

  return Promise.all(
    ((data || []) as StockCertificate[]).map((cert) => withSignedCertificateUrl(cert))
  );
};

// ==================== ANNOUNCEMENTS ====================

const ANNOUNCEMENT_BUCKET = 'announcement-files';

/** Published announcement visible to shareholders. Body fields are sanitized HTML to render. */
export interface Announcement {
  id: string;
  title_ar: string;
  title_en: string;
  body_ar: string | null;
  body_en: string | null;
  pdf_storage_path: string | null;
  pdf_file_name: string | null;
  cover_image_url: string | null;
  published_at: string | null;
}

/**
 * Fetch announcements. RLS ensures only published rows are returned to shareholders.
 */
export const getAnnouncements = async (): Promise<Announcement[]> => {
  const { data, error } = await supabaseClient
    .from('announcements')
    .select('id, title_ar, title_en, body_ar, body_en, pdf_storage_path, pdf_file_name, cover_image_url, published_at')
    .order('published_at', { ascending: false });

  if (error) {
    logger.error('Announcements query error:', error);
    const isDevelopment = import.meta.env.DEV;
    throw new Error(isDevelopment ? error.message : 'Unable to load announcements. Please try again.');
  }

  return (data || []) as Announcement[];
};

/** Mint a short-lived signed URL for a published announcement's PDF (private bucket). */
export const getAnnouncementPdfSignedUrl = async (storagePath: string): Promise<string> => {
  const { data, error } = await supabaseClient.storage
    .from(ANNOUNCEMENT_BUCKET)
    .createSignedUrl(storagePath, 60 * 60);

  if (error || !data?.signedUrl) {
    logger.error('Announcement PDF signed URL error:', error);
    throw new Error('Unable to open the document. Please try again.');
  }
  return data.signedUrl;
};
