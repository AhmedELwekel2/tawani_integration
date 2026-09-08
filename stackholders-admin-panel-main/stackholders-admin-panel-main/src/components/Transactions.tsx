import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getPaginatedTransactions,
  getLookupStockholders,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  uploadCertificate,
  uploadApprovalDocument,
  Transaction,
  stockholderDisplayName,
} from '../services/apiService';
import { queryKeys } from '../services/queryClient';
import { supabaseClient } from '../services/supabaseClient';
import { ApprovalDocumentOpenButton } from './ApprovalDocumentOpenButton';
import StockholderDetail from './StockholderDetail';
import StockholderSelect from './StockholderSelect';
import { AdminDialogPortal } from './AdminDialogPortal';
import { getFriendlyError } from '../utils/errorHelpers';
import UISelect from './UISelect';
import saudiRiyalIcon from '../assets/saudi-riyal-icon.svg';
import './Transactions.css';
import './Stockholders.css'; // Reuse search bar styles

const Transactions: React.FC = () => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'ar' ? 'ar-SA' : 'en-US';

  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState('');
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [viewingStockholderId, setViewingStockholderId] = useState<string | null>(null);
  const certInputRef = useRef<HTMLInputElement>(null);
  const approvalInputRef = useRef<HTMLInputElement>(null);
  const [formData, setFormData] = useState({
    stockholder_id: '',
    transaction_type: 'purchase' as Transaction['transaction_type'],
    shares: 0,
    price_per_share: 0,
    total_amount: 0,
    transaction_date: new Date().toISOString().split('T')[0],
    notes: '',
  });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedApprovalFile, setSelectedApprovalFile] = useState<File | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const PAGE_SIZE = 20;

  const {
    data: pageResult,
    isPending,
    isFetching,
    error: queryError,
  } = useQuery({
    queryKey: queryKeys.transactions.paginated(page, PAGE_SIZE, searchQuery),
    queryFn: () => getPaginatedTransactions(page, PAGE_SIZE, searchQuery),
    placeholderData: keepPreviousData,
  });

  // Its own query: the stockholder picker does not change when you page or
  // search, so it used to be re-fetched on every keystroke for nothing.
  const { data: stockholders = [], error: lookupError } = useQuery({
    queryKey: queryKeys.stockholders.lookup(),
    queryFn: getLookupStockholders,
    staleTime: 5 * 60_000,
  });

  const transactions = pageResult?.data ?? [];
  const totalCount = pageResult?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const loadError = queryError ?? lookupError;
  const error = actionError || (loadError ? getFriendlyError(loadError, t, 'transactions.failedToLoad') : '');

  /** True while the typed term is still debouncing, or its fetch is in flight. */
  const isSearching = isFetching || searchInput.trim() !== searchQuery;

  const invalidateTransactions = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.stockholders.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.stats });
  };

  const handleCreate = () => {
    setEditingTransaction(null);
    setFormData({
      stockholder_id: '',
      transaction_type: 'purchase',
      shares: 0,
      price_per_share: 0,
      total_amount: 0,
      transaction_date: new Date().toISOString().split('T')[0],
      notes: '',
    });
    setSelectedFile(null);
    setSelectedApprovalFile(null);
    setShowModal(true);
  };

  const handleEdit = (transaction: Transaction) => {
    setEditingTransaction(transaction);
    setFormData({
      stockholder_id: transaction.stockholder_id,
      transaction_type: transaction.transaction_type,
      shares: transaction.shares,
      price_per_share: transaction.price_per_share || 0,
      total_amount: transaction.total_amount || 0,
      transaction_date: transaction.transaction_date.split('T')[0],
      notes: transaction.notes || '',
    });
    setSelectedFile(null);
    setSelectedApprovalFile(null);
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('transactions.deleteConfirm'))) return;
    try {
      setActionError('');
      await deleteTransaction(id);
      invalidateTransactions();
    } catch (err) {
      setActionError(getFriendlyError(err, t, 'transactions.failedToDelete'));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSaving(true);
      const transactionData: Partial<Transaction> = {
        stockholder_id: formData.stockholder_id,
        transaction_type: formData.transaction_type,
        shares: formData.shares,
        price_per_share: formData.price_per_share || null,
        total_amount: formData.total_amount || null,
        transaction_date: formData.transaction_date,
        notes: formData.notes || null,
      };

      let transactionId = '';

      if (editingTransaction) {
        await updateTransaction(editingTransaction.id, transactionData);
        transactionId = editingTransaction.id;
      } else {
        const newTransaction = await createTransaction(transactionData as Parameters<typeof createTransaction>[0]);
        transactionId = newTransaction.id;
      }

      const { data: { user } } = await supabaseClient.auth.getUser();
      const adminEmail = user?.email ?? undefined;

      if (selectedFile) {
        await uploadCertificate(formData.stockholder_id, selectedFile, adminEmail, transactionId);
      }

      if (selectedApprovalFile) {
        await uploadApprovalDocument(formData.stockholder_id, transactionId, selectedApprovalFile);
      }

      setShowModal(false);
      invalidateTransactions();
    } catch (err) {
      setActionError(getFriendlyError(err, t, 'transactions.modal.failedToSave'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchInput(value);
    
    // Clear any existing debounce
    if (debounceRef.current) clearTimeout(debounceRef.current);
    
    if (value.trim() !== searchQuery) {
      debounceRef.current = setTimeout(() => {
        setSearchQuery(value);
        setPage(1);
      }, 350);
    }
  };

  const handleSearchClear = () => {
    setSearchInput('');
    setSearchQuery('');
    setPage(1);
  };

  const getStockholderName = (stockholderId: string): string => {
    const stockholder = stockholders.find((s) => s.id === stockholderId);
    return stockholder ? stockholderDisplayName(stockholder, i18n.language) : stockholderId.slice(0, 8);
  };

  const formatNumber = (num: number | null): string => {
    if (num === null) return t('common.na');
    return new Intl.NumberFormat(locale).format(num);
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

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString(locale);
  };

  if (isPending) {
    return (
      <div className="loading">
        <div className="spinner"></div>
        <p>{t('transactions.loading')}</p>
      </div>
    );
  }

  return (
    <div className="transactions">
      <div className="transactions-header">
        <h1>{t('transactions.title')}</h1>
        <button onClick={handleCreate} className="btn-primary">
          {t('transactions.addTransaction')}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="search-bar" style={{ marginBottom: '1.5rem', background: 'transparent', padding: 0 }}>
        <div className="search-input-wrapper">
          <svg className="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="search"
            className="search-input"
            value={searchInput}
            onChange={handleSearchChange}
            placeholder={t('transactions.searchPlaceholder')}
            autoComplete="off"
          />
          {isSearching ? (
            <div className="search-loading-spinner" />
          ) : searchInput && (
            <button type="button" className="search-clear" onClick={handleSearchClear} aria-label={t('common.close')}>
              ×
            </button>
          )}
        </div>
      </div>

      <div className={`table-container ${isSearching ? 'searching' : ''}`}>
        <table>
          <thead>
            <tr>
              <th>{t('transactions.id')}</th>
              <th>{t('transactions.date')}</th>
              <th>{t('transactions.type')}</th>
              <th className="stockholder-cell">{t('transactions.stockholder')}</th>
              <th className="number-cell">{t('transactions.shares')}</th>
              <th className="number-cell">{t('transactions.pricePerShare')}</th>
              <th className="number-cell">{t('transactions.totalAmount')}</th>
              <th>{t('transactions.approval')}</th>
              <th>{t('transactions.notes')}</th>
              <th>{t('transactions.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {transactions.length === 0 ? (
              <tr>
                <td colSpan={10} className="no-data">
                  {t('transactions.noFound')}
                </td>
              </tr>
            ) : (
              transactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td>
                    <span className="transaction-id-badge" title={transaction.id}>
                      {transaction.id.slice(-6).toUpperCase()}
                    </span>
                  </td>
                  <td>{formatDate(transaction.transaction_date)}</td>
                  <td>
                    <span className={`transaction-type ${transaction.transaction_type}`}>
                      {t(`transactions.${transaction.transaction_type}`)}
                    </span>
                  </td>
                  <td className="stockholder-cell">
                    <button
                      onClick={() => setViewingStockholderId(transaction.stockholder_id)}
                      className="stockholder-link"
                      title={t('transactions.viewStockholder')}
                    >
                      {getStockholderName(transaction.stockholder_id)}
                    </button>
                  </td>
                  <td className="number-cell">{formatNumber(transaction.shares)}</td>
                  <td className="number-cell">{formatCurrency(transaction.price_per_share)}</td>
                  <td className="number-cell">{formatCurrency(transaction.total_amount)}</td>
                  <td>
                    {transaction.approval_document_storage_path ? (
                      <ApprovalDocumentOpenButton
                        storagePath={transaction.approval_document_storage_path}
                        fileName={transaction.approval_document_name}
                        className="document-link"
                        label={t('transactions.viewDoc')}
                      />
                    ) : (
                      <span className="no-document">—</span>
                    )}
                  </td>
                  <td className="notes-cell">{transaction.notes || t('common.na')}</td>
                  <td>
                    <div className="action-buttons">
                      <button onClick={() => handleEdit(transaction)} className="btn-edit">
                        {t('transactions.edit')}
                      </button>
                      <button onClick={() => handleDelete(transaction.id)} className="btn-delete">
                        {t('transactions.delete')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!isFetching && totalPages > 1 && (
        <div className="pagination">
          <button disabled={page === 1} onClick={() => setPage(page - 1)} className="btn-secondary">
            {t('common.previous')}
          </button>
          <span className="pagination-info">
            {t('common.page', { page, total: totalPages, count: totalCount })}
          </span>
          <button disabled={page === totalPages} onClick={() => setPage(page + 1)} className="btn-secondary">
            {t('common.next')}
          </button>
        </div>
      )}

      {viewingStockholderId && (
        <StockholderDetail
          stockholderId={viewingStockholderId}
          onClose={() => setViewingStockholderId(null)}
        />
      )}

      {showModal && (
        <AdminDialogPortal>
          <div className="modal-overlay admin-dialog-overlay" onClick={() => setShowModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>{editingTransaction ? t('transactions.modal.editTitle') : t('transactions.modal.addTitle')}</h2>
                <button type="button" onClick={() => setShowModal(false)} className="modal-close-btn" aria-label={t('common.close')}>&times;</button>
              </div>
              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                <div className="modal-body">
                  <div className="form-group" style={{ marginBottom: '1rem' }}>
                    <label>{t('transactions.modal.stockholder')}</label>
                    <StockholderSelect
                      stockholders={stockholders}
                      selectedId={formData.stockholder_id}
                      onChange={(id) => setFormData({ ...formData, stockholder_id: id })}
                      disabled={!!editingTransaction}
                      required
                    />
                  </div>

                  <div className="form-group" style={{ marginBottom: '1rem' }}>
                    <label>{t('transactions.modal.transactionType')}</label>
                    <UISelect
                      value={formData.transaction_type}
                      options={[
                        { value: 'purchase', label: t('transactions.modal.purchase') },
                        { value: 'sell', label: t('transactions.modal.sell') },
                      ]}
                      onChange={(val) =>
                        setFormData({
                          ...formData,
                          transaction_type: val as Transaction['transaction_type'],
                        })
                      }
                    />
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label>{t('transactions.modal.shares')}</label>
                      <input
                        type="number"
                        value={formData.shares}
                        onChange={(e) => setFormData({ ...formData, shares: parseInt(e.target.value) || 0 })}
                        required
                        min="1"
                      />
                    </div>
                    <div className="form-group">
                      <label>{t('transactions.modal.date')}</label>
                      <input
                        type="date"
                        value={formData.transaction_date}
                        onChange={(e) => setFormData({ ...formData, transaction_date: e.target.value })}
                        required
                      />
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label>{t('transactions.modal.pricePerShare')}</label>
                      <input
                        type="number"
                        step="0.01"
                        value={formData.price_per_share}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            price_per_share: parseFloat(e.target.value) || 0,
                            total_amount: (parseFloat(e.target.value) || 0) * formData.shares,
                          })
                        }
                        min="0"
                      />
                    </div>
                    <div className="form-group">
                      <label>{t('transactions.modal.totalAmount')}</label>
                      <input
                        type="number"
                        step="0.01"
                        value={formData.total_amount}
                        onChange={(e) => setFormData({ ...formData, total_amount: parseFloat(e.target.value) || 0 })}
                        min="0"
                      />
                    </div>
                  </div>

                  <div className="form-group" style={{ marginBottom: '1rem' }}>
                    <label>{t('transactions.modal.notes')}</label>
                    <textarea
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      rows={3}
                      placeholder={t('transactions.modal.notesPlaceholder')}
                    />
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label>{t('transactions.modal.certificate')}</label>
                      <div className="custom-file-input-wrapper">
                        <input
                          ref={certInputRef}
                          type="file"
                          accept=".pdf,image/*"
                          onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                          style={{ display: 'none' }}
                        />
                        <div className="custom-file-input-box" onClick={() => certInputRef.current?.click()}>
                          <span className="file-display-name">
                            {selectedFile ? selectedFile.name : t('common.noFileChosen')}
                          </span>
                          <button type="button" className="file-browse-btn">{t('common.chooseFile')}</button>
                        </div>
                      </div>
                    </div>
                    <div className="form-group">
                      <label>{t('transactions.modal.approvalDoc')}</label>
                      <div className="custom-file-input-wrapper">
                        <input
                          ref={approvalInputRef}
                          type="file"
                          accept=".pdf,image/*"
                          onChange={(e) => setSelectedApprovalFile(e.target.files?.[0] || null)}
                          style={{ display: 'none' }}
                        />
                        <div className="custom-file-input-box" onClick={() => approvalInputRef.current?.click()}>
                          <span className="file-display-name">
                            {selectedApprovalFile ? selectedApprovalFile.name : t('common.noFileChosen')}
                          </span>
                          <button type="button" className="file-browse-btn">{t('common.chooseFile')}</button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="modal-footer">
                  <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">
                    {t('transactions.modal.cancel')}
                  </button>
                  <button type="submit" className="btn-primary" disabled={isSaving}>
                    {isSaving ? t('transactions.modal.processing') : (editingTransaction ? t('transactions.modal.update') : t('transactions.modal.create'))}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </AdminDialogPortal>
      )}
    </div>
  );
};

export default Transactions;
