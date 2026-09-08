import React, { useState, useEffect, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { YearlyDividends, getYearlyDividends, calculateTotalDividends } from '../services/stockholderService';
import { formatSAR } from '../utils/currency';
import SARIcon from '../assets/saudi-riyal-icon.svg?url';
import { motion, AnimatePresence } from 'framer-motion';
import { translateError } from '../utils/errorUtils';

import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, FileText, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';


const YearlyDividendsComponent: React.FC = () => {
  const { t } = useTranslation();
  const [dividendData, setDividendData] = useState<YearlyDividends[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDividendData = React.useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await getYearlyDividends();
      setDividendData(data);
    } catch (err) {
      setError(translateError(err instanceof Error ? err.message : t('dividends.failedToLoad'), t));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadDividendData();
  }, [loadDividendData]);

  const totalDividends = calculateTotalDividends(dividendData);

  const chartData = [...dividendData].sort((a, b) => a.year - b.year);
  const maxAmount = Math.max(...chartData.map(d => Number(d.amount)), 1);
  const CHART_INNER_HEIGHT_PX = 176;

  if (isLoading) {
    return (
      <div className="p-8 space-y-4">
        <div>
          <Skeleton className="h-8 w-48 mb-6 bg-slate-200" />
        </div>
        <Skeleton className="h-48 w-full rounded-2xl bg-slate-100" />
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-2xl bg-slate-100" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="p-6 rounded-2xl bg-rose-50 border border-rose-200 flex flex-col items-center text-center max-w-md w-full shadow-sm">
          <AlertCircle className="w-12 h-12 text-rose-500 mb-4" />
          <h3 className="text-xl font-semibold text-rose-800 mb-2">{t('dividends.errorTitle')}</h3>
          <p className="text-rose-600 mb-6">{error}</p>
          <Button onClick={loadDividendData} className="bg-rose-600 hover:bg-rose-700 text-white">
            <RefreshCw className="me-2 w-4 h-4" /> {t('dividends.tryAgain')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 relative">
      <div className="absolute top-0 end-0 w-32 h-32 bg-primary/5 rounded-bl-full pointer-events-none" />

      <div className="flex items-center justify-between mb-8 relative z-10">
        <h3 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center">
          {t('dividends.title')}
          <span className="ms-3 text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
            {t('dividends.years', { count: dividendData.length })}
          </span>
        </h3>
      </div>

      <div className="space-y-8 relative z-10">

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="p-6 rounded-2xl bg-gradient-to-br from-primary to-primary/80 text-white shadow-lg shadow-primary/30 overflow-hidden relative"
        >
          <div className="absolute top-0 end-0 p-4 opacity-20">
            <TrendingUp className="w-24 h-24" />
          </div>

          <div className="relative z-10">
            <p className="text-white/80 font-medium tracking-wide uppercase text-sm mb-2">{t('dividends.totalLifetime')}</p>
            <div className="flex items-baseline mb-1">
              <span className="text-4xl sm:text-5xl font-bold tracking-tight drop-shadow-md">
                {formatSAR(totalDividends)}
              </span>
              <img src={SARIcon} alt="SAR" className="w-6 h-6 ms-2 sm:ms-3 drop-shadow-md brightness-0 invert" />
            </div>
            <p className="text-white/70 text-sm mt-3 border-t border-white/20 pt-3">
              {t('dividends.totalDesc')}
            </p>
          </div>
        </motion.div>

        {chartData.length > 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, delay: 0.1 }}
            className="p-6 rounded-2xl bg-white border border-slate-200 shadow-sm"
          >
            <h4 className="text-lg font-semibold text-slate-800 mb-4 flex items-center">
              <TrendingUp className="w-5 h-5 me-2 text-primary" />
              {t('dividends.trend')}
            </h4>
            <div className="pt-2">
              <div
                className="relative flex items-end justify-between gap-2 px-1"
                style={{ height: CHART_INNER_HEIGHT_PX }}
              >
                {chartData.map((data, idx) => {
                  const amount = Number(data.amount);
                  const barHeightPx = Math.max((amount / maxAmount) * CHART_INNER_HEIGHT_PX, 4);
                  return (
                    <div
                      key={data.id}
                      className="group relative flex min-h-0 min-w-0 flex-1 flex-col items-center justify-end"
                    >
                      <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-xs text-white opacity-0 shadow-md transition-opacity group-hover:opacity-100">
                        {formatSAR(data.amount)} SAR
                      </div>
                      <div
                        className="flex w-full max-w-[52px] flex-col justify-end rounded-t-md bg-primary/10"
                        style={{ height: CHART_INNER_HEIGHT_PX }}
                      >
                        <motion.div
                          initial={{ height: 0 }}
                          animate={{ height: barHeightPx }}
                          transition={{ duration: 0.7, delay: idx * 0.05 + 0.2, type: 'spring' }}
                          className="w-full rounded-t-md bg-primary shadow-sm group-hover:bg-primary/90"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex justify-between gap-2 border-t border-slate-100 pt-3">
                {chartData.map((data) => (
                  <div
                    key={data.id}
                    className="min-w-0 flex-1 text-center text-xs font-medium text-slate-500"
                  >
                    {data.year}
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {dividendData.length === 0 ? (
          <div className="p-16 text-center text-slate-500 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white shadow-sm border border-slate-100 mb-4">
              <TrendingUp className="w-8 h-8 text-slate-300" />
            </div>
            <h4 className="text-lg font-medium text-slate-800 mb-1">{t('dividends.noData')}</h4>
            <p className="text-sm text-slate-500">{t('dividends.noDataDesc')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <h4 className="text-lg font-semibold text-slate-800 mb-4">{t('dividends.history')}</h4>
            <AnimatePresence>
              {dividendData.map((row, index) => (
                <motion.div
                  key={row.id}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: index * 0.05 + 0.3 }}
                  className="p-5 rounded-2xl bg-white hover:bg-slate-50 border border-slate-200 shadow-sm hover:shadow-md transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                >
                  <div className="flex items-center space-x-4">
                    <div className="p-3.5 rounded-xl border shadow-sm bg-primary/10 border-primary/20 text-primary">
                      <TrendingUp className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-lg font-bold text-slate-800 tracking-tight">
                        {t('dividends.yearDividends', { year: row.year })}
                      </h4>
                      {row.notes && (
                        <p className="text-sm text-slate-500 mt-0.5 flex items-center">
                          <FileText className="w-3.5 h-3.5 me-1.5 opacity-70" />
                          {row.notes}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center bg-primary/10 px-3 py-1.5 rounded-lg border border-primary/20 ms-auto sm:ms-0 self-end sm:self-auto">
                    <span className="font-bold text-primary text-lg me-2">
                      {formatSAR(row.amount)}
                    </span>
                    <img src={SARIcon} alt="SAR" className="w-4 h-4 opacity-80" style={{ filter: 'invert(48%) sepia(61%) saturate(297%) hue-rotate(101deg) brightness(88%) contrast(85%)' }} />
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}

      </div>
    </div>
  );
};

export const YearlyDividendsView = memo(YearlyDividendsComponent);
