import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getAllTransactions,
  getAllStockholders,
  Transaction,
  Stockholder,
  stockholderDisplayName,
} from '../services/apiService';
import StockholderDetail from './StockholderDetail';
import { ApprovalDocumentOpenButton } from './ApprovalDocumentOpenButton';
import './Transactions.css';

const ApprovalDocuments: React.FC = () => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'ar' ? 'ar-SA' : 'en-US';

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [stockholders, setStockholders] = useState<Stockholder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewingStockholderId, setViewingStockholderId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const loadData = React.useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [transactionsData, stockholdersData] = await Promise.all([
        getAllTransactions(),
        getAllStockholders(),
      ]);
      
      const docsOnly = transactionsData.filter(t => t.approval_document_storage_path);
      setTransactions(docsOnly);
      setStockholders(stockholdersData);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('approvalDocs.failedToLoad'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const getStockholderName = (stockholderId: string): string => {
    const stockholder = stockholders.find((s) => s.id === stockholderId);
    return stockholder ? stockholderDisplayName(stockholder, i18n.language) : stockholderId.slice(0, 8);
  };

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString(locale);
  };

  const filteredTransactions = transactions.filter(t => {
    const matchesType = typeFilter === 'all' || t.transaction_type === typeFilter;
    const name = getStockholderName(t.stockholder_id).toLowerCase();
    const matchesSearch = name.includes(searchQuery.toLowerCase()) || 
                         (t.approval_document_name?.toLowerCase() || '').includes(searchQuery.toLowerCase());
    return matchesType && matchesSearch;
  });

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
        <p>{t('approvalDocs.loading')}</p>
      </div>
    );
  }

  return (
    <div className="transactions">
      <div className="transactions-header">
        <h1>{t('approvalDocs.title')}</h1>
        <button onClick={loadData} className="btn-secondary">
          {t('approvalDocs.refresh')}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="filters-bar" style={{ marginBottom: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <div className="filter-group">
          <label style={{ marginInlineEnd: '0.5rem', fontWeight: '500' }}>{t('approvalDocs.search')}</label>
          <input 
            type="text" 
            placeholder={t('approvalDocs.searchPlaceholder')} 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="info-input"
            style={{ width: '250px' }}
          />
        </div>
        <div className="filter-group">
          <label style={{ marginInlineEnd: '0.5rem', fontWeight: '500' }}>{t('approvalDocs.type')}</label>
          <select 
            value={typeFilter} 
            onChange={(e) => setTypeFilter(e.target.value)}
            className="info-input"
            style={{ width: '150px' }}
          >
            <option value="all">{t('approvalDocs.allTypes')}</option>
            <option value="purchase">{t('approvalDocs.purchase')}</option>
            <option value="sell">{t('approvalDocs.sell')}</option>
          </select>
        </div>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>{t('approvalDocs.date')}</th>
              <th>{t('approvalDocs.stockholder')}</th>
              <th>{t('approvalDocs.transType')}</th>
              <th>{t('approvalDocs.docName')}</th>
              <th>{t('approvalDocs.action')}</th>
            </tr>
          </thead>
          <tbody>
            {filteredTransactions.length === 0 ? (
              <tr>
                <td colSpan={5} className="no-data">
                  {t('approvalDocs.noFound')}
                </td>
              </tr>
            ) : (
              filteredTransactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td>{formatDate(transaction.transaction_date)}</td>
                  <td>
                    <button
                      onClick={() => setViewingStockholderId(transaction.stockholder_id)}
                      className="stockholder-link"
                    >
                      {getStockholderName(transaction.stockholder_id)}
                    </button>
                  </td>
                  <td>
                    <span className={`transaction-type ${transaction.transaction_type}`}>
                      {transaction.transaction_type}
                    </span>
                  </td>
                  <td>
                    <span className="doc-name">{transaction.approval_document_name || t('approvalDocs.approvalDocument')}</span>
                  </td>
                  <td>
                    <ApprovalDocumentOpenButton
                      storagePath={transaction.approval_document_storage_path!}
                      fileName={transaction.approval_document_name}
                      className="btn-edit"
                      label={t('approvalDocs.openDocument')}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {viewingStockholderId && (
        <StockholderDetail
          stockholderId={viewingStockholderId}
          onClose={() => setViewingStockholderId(null)}
        />
      )}
    </div>
  );
};

export default ApprovalDocuments;
