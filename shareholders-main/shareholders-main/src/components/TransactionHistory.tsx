import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Transaction } from '../services/stockholderService';
import { formatSAR, formatNumber } from '../utils/currency';
import SARIcon from '../assets/saudi-riyal-icon.svg?url';
import { motion, AnimatePresence } from 'framer-motion';

import { Skeleton } from '@/components/ui/skeleton';
import { FileText, ArrowUpRight, ArrowDownLeft } from 'lucide-react';

interface TransactionHistoryProps {
  transactions: Transaction[];
  isLoading?: boolean;
  page?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;
}

const prefersReducedMotion = typeof window !== 'undefined'
  ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
  : false;

const TransactionHistoryComponent: React.FC<TransactionHistoryProps> = ({
  transactions,
  isLoading,
  page,
  totalPages,
  onPageChange
}) => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'ar' ? 'ar-SA' : 'en-US';

  const formatDate = (dateString: string): string => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString(locale, {
        year: 'numeric', month: 'short', day: 'numeric',
      });
    } catch {
      return dateString;
    }
  };

  const getTransactionTypeConfig = (type: string) => {
    switch (type) {
      case 'purchase': return { label: t('transactions.purchase'), icon: ArrowDownLeft, className: 'bg-primary/10 text-primary border-primary/20 hover:bg-primary/20', iconColor: 'text-primary' };
      case 'sell': return { label: t('transactions.sale'), icon: ArrowUpRight, className: 'bg-rose-100 text-rose-800 border-rose-200 hover:bg-rose-200', iconColor: 'text-rose-600' };
      default: return { label: type, icon: FileText, className: 'bg-slate-100 text-slate-800 border-slate-200 hover:bg-slate-200', iconColor: 'text-slate-600' };
    }
  };

  if (isLoading) {
    return (
      <div className="p-8 space-y-4">
        <div>
          <Skeleton className="h-8 w-48 mb-6 bg-slate-200" />
        </div>
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-2xl bg-slate-100" />
        ))}
      </div>
    );
  }

  if (!transactions || transactions.length === 0) {
    return (
      <div className="p-16 text-center text-slate-500 bg-slate-50/50 rounded-2xl m-4 border border-dashed border-slate-200">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-white shadow-sm border border-slate-100 mb-6">
          <FileText className="w-10 h-10 text-slate-300" />
        </div>
        <h4 className="text-xl font-medium text-slate-800 mb-2">{t('transactions.noTransactions')}</h4>
        <p className="text-slate-500">{t('transactions.noTransactionsDesc')}</p>
      </div>
    );
  }

  return (
    <div className="p-8 relative">
      <div className="absolute top-0 end-0 w-32 h-32 bg-blue-50/50 rounded-bl-full pointer-events-none" />

      <div className="flex items-center justify-between mb-8 relative z-10">
        <h3 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center">
          {t('transactions.title')}
          <span className="ms-3 text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
            {t('transactions.records', { count: transactions.length })}
          </span>
        </h3>
      </div>

      <div className="space-y-4 relative z-10">
        <AnimatePresence>
          {transactions.map((transaction, index) => {
            const config = getTransactionTypeConfig(transaction.transaction_type);
            const TypeIcon = config.icon;

            return (
              <motion.div
                key={transaction.id}
                initial={prefersReducedMotion ? false : { opacity: 0, y: 20 }}
                animate={prefersReducedMotion ? false : { opacity: 1, y: 0 }}
                transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.2, delay: index * 0.03 }}
                className="group p-5 rounded-2xl bg-white hover:bg-slate-50 border border-slate-200 shadow-sm hover:shadow-md transition-all flex flex-col gap-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 w-full">
                  <div className="flex items-start space-x-4">
                    <div className={`p-4 rounded-xl shrink-0 border shadow-sm ${config.className}`}>
                      <TypeIcon className={`w-6 h-6 ${config.iconColor}`} />
                    </div>
                    <div className="pt-1">
                      <h4 className="text-lg font-bold text-slate-800 tracking-tight flex items-center">
                        {config.label}
                      </h4>
                      <p className="text-sm font-medium text-slate-500 mt-1">
                        {formatDate(transaction.transaction_date)}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col items-end min-w-[200px]">
                    <div className="mb-3">
                      <span className="text-xl font-bold text-slate-800 bg-slate-100 px-3 py-1 rounded-lg border border-slate-200">
                        {t('transactions.shares', { count: formatNumber(transaction.shares) })}
                      </span>
                    </div>

                    <div className="flex flex-col items-end space-y-1.5 w-full">
                      {transaction.price_per_share && (
                        <div className="flex items-center justify-end text-sm w-full">
                          <span className="text-slate-500 font-medium me-3">{t('transactions.pricePerShare')}</span>
                          <span className="font-semibold text-slate-700 flex items-center min-w-[80px] justify-end">
                            {formatSAR(transaction.price_per_share)}
                            <img src={SARIcon} alt="SAR" className="w-3.5 h-3.5 ms-1.5 opacity-60" />
                          </span>
                        </div>
                      )}
                      {transaction.total_amount && (
                        <div className="flex items-center justify-end text-sm w-full">
                          <span className="text-slate-500 font-medium me-3">{t('transactions.total')}</span>
                          <span className="font-bold text-secondary flex items-center bg-secondary/10 px-2 py-0.5 rounded-md border border-secondary/20 min-w-[80px] justify-end">
                            {formatSAR(transaction.total_amount)}
                            <img src={SARIcon} alt="SAR" className="w-4 h-4 ms-1.5 opacity-80" />
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {transaction.notes && (
                  <div className="w-full pt-4 border-t border-slate-100 text-sm italic flex items-start text-slate-500">
                    <span className="font-medium me-2 not-italic text-slate-400">{t('transactions.note')}</span>
                    {transaction.notes}
                  </div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {page !== undefined && totalPages !== undefined && totalPages > 1 && onPageChange && (
        <div className="mt-8 flex items-center justify-between border-t border-slate-200 pt-6 relative z-10">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page === 1}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
          >
            {t('transactions.previous')}
          </button>
          <span className="text-sm font-medium text-slate-600">
            {t('transactions.page', { page, total: totalPages })}
          </span>
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page === totalPages}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
          >
            {t('transactions.next')}
          </button>
        </div>
      )}
    </div>
  );
};

export const TransactionHistory = memo(TransactionHistoryComponent);
