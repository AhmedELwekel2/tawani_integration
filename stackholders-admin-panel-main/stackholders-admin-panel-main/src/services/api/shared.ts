/**
 * Internal helpers shared by the domain modules. Not part of the public API
 * surface -- the barrel (`src/services/apiService.ts`) does not re-export these.
 */

import type { Transaction } from './types';

/**
 * Transactions are always fetched with their approval document embedded, so the
 * list and detail views can show the document without a second round trip.
 */
export const TRANSACTION_LIST_SELECT =
  '*, stockholder_transaction_approvals ( storage_path, file_name )';

type ApprovalEmbed = { storage_path: string; file_name: string | null } | null;

/**
 * PostgREST returns an embedded to-one relation as an object or a single-element
 * array depending on how it infers cardinality. Normalise both.
 */
function unwrapApprovalEmbed(
  raw: ApprovalEmbed | ApprovalEmbed[] | undefined
): ApprovalEmbed {
  if (raw == null) return null;
  return Array.isArray(raw) ? raw[0] ?? null : raw;
}

/** Flatten the embedded approval row into the flat Transaction shape the UI uses. */
export function mapTransactionRow(row: Record<string, unknown>): Transaction {
  const approval = unwrapApprovalEmbed(
    row.stockholder_transaction_approvals as ApprovalEmbed | ApprovalEmbed[] | undefined
  );
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { stockholder_transaction_approvals: _, ...rest } = row;
  return {
    ...(rest as Omit<
      Transaction,
      'approval_document_storage_path' | 'approval_document_name'
    >),
    approval_document_storage_path: approval?.storage_path ?? null,
    approval_document_name: approval?.file_name ?? null,
  };
}

/**
 * Calculate total shares from transactions.
 * `purchase` adds shares, `sell` subtracts them.
 */
export const calculateSharesFromTransactions = (
  transactions: Array<{ transaction_type: string; shares: number }>
): number => {
  return transactions.reduce((sum, transaction) => {
    if (transaction.transaction_type === 'purchase') {
      return sum + transaction.shares;
    } else if (transaction.transaction_type === 'sell') {
      return sum - transaction.shares;
    }
    return sum;
  }, 0);
};
