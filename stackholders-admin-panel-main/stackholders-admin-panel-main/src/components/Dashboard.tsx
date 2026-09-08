import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getDashboardStats,
  getAllStockholders,
  getAllTransactions,
  stockholderDisplayName,
} from '../services/apiService';
import saudiRiyalIcon from '../assets/saudi-riyal-icon.svg';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { getFriendlyError } from '../utils/errorHelpers';
import { queryKeys } from '../services/queryClient';
import './Dashboard.css';

interface TransactionTypeData {
  name: string;
  value: number;
  originalName: string;
  [key: string]: string | number;
}

interface TopStockholderData {
  name: string;
  shares: number;
  [key: string]: string | number;
}

const Dashboard: React.FC = () => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'ar' ? 'ar-SA' : 'en-US';

  const {
    data: stats = null,
    isPending: loading,
    error: statsError,
    refetch: loadStats,
  } = useQuery({
    queryKey: queryKeys.dashboard.stats,
    queryFn: getDashboardStats,
  });

  // Charts read the full transaction/stockholder lists; kept as its own query so
  // a slow chart fetch never blocks the headline figures.
  const { data: chartSource } = useQuery({
    queryKey: ['dashboard', 'charts'] as const,
    queryFn: async () => {
      const [transactions, stockholders] = await Promise.all([
        getAllTransactions(),
        getAllStockholders(),
      ]);
      return { transactions, stockholders };
    },
  });

  const rawStockholders = React.useMemo(() => chartSource?.stockholders ?? [], [chartSource]);
  const error = statsError ? getFriendlyError(statsError, t, 'dashboard.failedToLoad') : '';

  const stockholdersMap = useMemo(() => {
    const map = new Map<string, string>();
    rawStockholders.forEach(s => map.set(s.id, stockholderDisplayName(s, i18n.language)));
    return map;
  }, [rawStockholders, i18n.language]);

  const topStockholdersData = useMemo<TopStockholderData[]>(() => {
    return [...rawStockholders]
      .sort((a, b) => (b.shares || 0) - (a.shares || 0))
      .slice(0, 5)
      .map(s => ({
        name: stockholderDisplayName(s, i18n.language).slice(0, 24),
        shares: s.shares || 0
      }));
  }, [rawStockholders, i18n.language]);

  const transactionTypeData: TransactionTypeData[] = useMemo(() => {
    const typeCount: { [key: string]: number } = {};
    (chartSource?.transactions ?? []).forEach((tx) => {
      typeCount[tx.transaction_type] = (typeCount[tx.transaction_type] || 0) + 1;
    });
    return Object.entries(typeCount).map(([name, value]) => ({
      name: t(`transactions.${name}`),
      value,
      originalName: name,
    }));
  }, [chartSource, t]);

  const getStockholderName = (stockholderId: string): string => {
    return stockholdersMap.get(stockholderId) || stockholderId.slice(0, 8) + '...';
  };

  const formatNumber = (num: number): string => {
    return new Intl.NumberFormat(locale).format(num);
  };

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatCurrency = (num: number | null): JSX.Element => {
    if (num === null) return <span>{t('common.na')}</span>;
    const formatted = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
    return (
      <span className="currency-amount">
        {formatted}
        <img src={saudiRiyalIcon} alt="SAR" className="currency-icon" />
      </span>
    );
  };

  const COLORS = {
    purchase: 'var(--success)',
    sell: 'var(--error)',
  };

  if (loading) {
    return (
      <div className="dashboard-loading">
        <div className="spinner"></div>
        <p>{t('common.loading')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard-error">
        <p>{error}</p>
        <button onClick={() => loadStats()} className="retry-btn">{t('common.retry')}</button>
      </div>
    );
  }

  if (!stats) {
    return null;
  }

  const totalLifetimeDividends = stats?.yearlyDividends.reduce((sum, row) => sum + (Number(row.amount) || 0), 0) || 0;

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>{t('dashboard.title')}</h1>
        <p className="dashboard-subtitle">{t('dashboard.subtitle')}</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card stat-card-primary">
          <div className="stat-icon-wrapper">
            <span className="stat-icon">👥</span>
          </div>
          <div className="stat-content">
            <p className="stat-label">{t('dashboard.totalStockholders')}</p>
            <p className="stat-value">{formatNumber(stats.totalStockholders)}</p>
            <p className="stat-description">{t('dashboard.activeStockholders')}</p>
          </div>
        </div>

        <div className="stat-card stat-card-success">
          <div className="stat-icon-wrapper">
            <span className="stat-icon">📈</span>
          </div>
          <div className="stat-content">
            <p className="stat-label">{t('dashboard.totalShares')}</p>
            <p className="stat-value">{formatNumber(stats.totalShares)}</p>
            <p className="stat-description">{t('dashboard.outstandingShares')}</p>
          </div>
        </div>

        <div className="stat-card stat-card-info">
          <div className="stat-icon-wrapper">
            <span className="stat-icon">💼</span>
          </div>
          <div className="stat-content">
            <p className="stat-label">{t('dashboard.totalTransactions')}</p>
            <p className="stat-value">{formatNumber(stats.totalTransactions)}</p>
            <p className="stat-description">{t('dashboard.allTimeTransactions')}</p>
          </div>
        </div>
        
        <div className="stat-card stat-card-warning">
          <div className="stat-icon-wrapper">
            <span className="stat-icon">💰</span>
          </div>
          <div className="stat-content">
            <p className="stat-label">{t('dashboard.totalDividends')}</p>
            <p className="stat-value">
              {totalLifetimeDividends.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              <img src={saudiRiyalIcon} alt="SAR" className="currency-icon" style={{ marginInlineStart: '8px', opacity: 0.8 }} />
            </p>
            <p className="stat-description">{t('dashboard.totalPayouts')}</p>
          </div>
        </div>
      </div>

      <div className="charts-grid">
        <div className="chart-card">
          <div className="chart-header">
            <h2>{t('dashboard.transactionTypes')}</h2>
            <p className="chart-subtitle">{t('dashboard.distributionByType')}</p>
          </div>
          <div className="chart-container">
            {transactionTypeData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={transactionTypeData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
                    outerRadius={100}
                    fill="var(--indigo-500)"
                    dataKey="value"
                  >
                    {transactionTypeData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[entry.originalName as keyof typeof COLORS] || 'var(--slate-500)'} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="no-data">{t('dashboard.noTransactionData')}</p>
            )}
          </div>
        </div>

        <div className="chart-card">
          <div className="chart-header">
            <h2>{t('dashboard.topStockholders')}</h2>
            <p className="chart-subtitle">{t('dashboard.byShareCount')}</p>
          </div>
          <div className="chart-container">
            {topStockholdersData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={topStockholdersData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="shares" fill="var(--primary)" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="no-data">{t('dashboard.noStockholderData')}</p>
            )}
          </div>
        </div>
      </div>

      <div className="recent-transactions-card">
        <div className="section-header">
          <h2>{t('dashboard.recentTransactions')}</h2>
          <p className="section-subtitle">{t('dashboard.latest10')}</p>
        </div>
        {stats.recentTransactions.length === 0 ? (
          <p className="no-data">{t('dashboard.noTransactionsFound')}</p>
        ) : (
          <div className="transactions-table-wrapper">
            <table className="modern-table">
              <thead>
                <tr>
                  <th>{t('dashboard.date')}</th>
                  <th>{t('dashboard.type')}</th>
                  <th>{t('dashboard.shares')}</th>
                  <th>{t('dashboard.pricePerShare')}</th>
                  <th>{t('dashboard.totalAmount')}</th>
                  <th>{t('dashboard.stockholder')}</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentTransactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <td>
                      <span className="date-badge">{formatDate(transaction.transaction_date)}</span>
                    </td>
                    <td>
                      <span className={`transaction-badge ${transaction.transaction_type}`}>
                        {t(`transactions.${transaction.transaction_type}`)}
                      </span>
                    </td>
                    <td>
                      <strong>{formatNumber(transaction.shares)}</strong>
                    </td>
                    <td>{formatCurrency(transaction.price_per_share)}</td>
                    <td>{formatCurrency(transaction.total_amount)}</td>
                    <td className="stockholder-name">
                      <span className="name-badge">{getStockholderName(transaction.stockholder_id)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
