/**
 * Shared row shapes for the admin API layer.
 *
 * Types referenced by more than one domain module live here rather than in the
 * module that "owns" them, so the domain modules never have to import each other
 * (e.g. StockholderWithTransactions needs YearlyDividends, and dashboard needs
 * both). Domain-specific types stay next to their queries.
 */

export interface PaginatedResult<T> {
  data: T[];
  count: number;
}

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
  created_at: string;
  updated_at: string | null;
  is_active: boolean;
  shares?: number; // Calculated from transactions
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
  /** Object path in approval-documents bucket; use signed URL to open */
  approval_document_storage_path: string | null;
  approval_document_name: string | null;
}

export interface YearlyDividends {
  id: string;
  stockholder_id: string;
  year: number;
  amount: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface StockholderWithTransactions extends Stockholder {
  transactions?: Transaction[];
  yearlyDividends?: YearlyDividends[];
}

export interface DashboardStats {
  totalStockholders: number;
  totalShares: number;
  totalTransactions: number;
  recentTransactions: Transaction[];
  yearlyDividends: YearlyDividends[];
}
