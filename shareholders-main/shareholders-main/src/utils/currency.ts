/**
 * Currency formatting utilities for SAR (Saudi Riyal)
 */



/**
 * Format amount as Saudi Riyal (SAR)
 * Returns formatted number without currency suffix (icon will be shown separately)
 */
export const formatSAR = (amount: number | null): string => {
  if (amount === null) return 'N/A';
  return amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};



/**
 * Format number with thousand separators
 */
export const formatNumber = (num: number): string => {
  return new Intl.NumberFormat('en-US').format(num);
};

