import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import PhoneInput, { isValidPhoneNumber } from 'react-phone-number-input';
import 'react-phone-number-input/style.css';
import {
  getPaginatedStockholders,
  createStockholder,
  deleteStockholder,
  createTransaction,
  uploadCertificate,
  uploadApprovalDocument,
  Transaction,
  stockholderDisplayName,
} from '../services/apiService';
import { queryKeys } from '../services/queryClient';
import { supabaseClient } from '../services/supabaseClient';
import StockholderDetail from './StockholderDetail';
import { AdminDialogPortal } from './AdminDialogPortal';
import { getFriendlyError } from '../utils/errorHelpers';
import './Stockholders.css';
import CountrySelectWithSearch from './CountrySelectWithSearch';
import './CountrySelectWithSearch.css';

const Stockholders: React.FC = () => {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  /** Errors from mutations (delete); query errors come from `query.error`. */
  const [actionError, setActionError] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [viewingStockholderId, setViewingStockholderId] = useState<string | null>(null);
  const [addingTransactionForId, setAddingTransactionForId] = useState<string | null>(null);
  const certInputRef = useRef<HTMLInputElement>(null);
  const approvalInputRef = useRef<HTMLInputElement>(null);
  const [formData, setFormData] = useState({
    national_id: '',
    full_name_ar: '',
    full_name_en: '',
    email: '',
    birth_date_hijri: '',
    birth_date_gregorian: '',
    birth_place: '',
    address_building: '',
    address_street: '',
    address_district: '',
    address_city: '',
    address_postal_code: '',
    address_additional_number: '',
  });
  const [phoneValue, setPhoneValue] = useState<string | undefined>(undefined);
  const [phoneError, setPhoneError] = useState('');
  const [modalError, setModalError] = useState('');

  const [transactionFormData, setTransactionFormData] = useState({
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
    queryKey: queryKeys.stockholders.paginated(page, PAGE_SIZE, searchQuery),
    queryFn: () => getPaginatedStockholders(page, PAGE_SIZE, searchQuery),
    // Hold the previous page's rows while the next one loads, so the table and
    // the search box never unmount mid-typing.
    placeholderData: keepPreviousData,
  });

  const stockholders = pageResult?.data ?? [];
  const totalCount = pageResult?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const error = actionError || (queryError ? getFriendlyError(queryError, t, 'stockholders.failedToLoad') : '');

  /** Any write invalidates the stockholder lists (share totals move with transactions). */
  const invalidateStockholders = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.stockholders.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.stats });
  };

  const deleteMutation = useMutation({
    mutationFn: deleteStockholder,
    onSuccess: invalidateStockholders,
    onError: (err) => setActionError(getFriendlyError(err, t, 'stockholders.failedToDelete')),
  });

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchQuery(value);
      setPage(1);
    }, 350);
  };

  const handleSearchClear = () => {
    setSearchInput('');
    setSearchQuery('');
    setPage(1);
  };

  const emptyForm = () => ({
    national_id: '',
    full_name_ar: '',
    full_name_en: '',
    email: '',
    birth_date_hijri: '',
    birth_date_gregorian: '',
    birth_place: '',
    address_building: '',
    address_street: '',
    address_district: '',
    address_city: '',
    address_postal_code: '',
    address_additional_number: '',
  });

  const handleCreate = () => {
    setFormData(emptyForm());
    setPhoneValue(undefined);
    setPhoneError('');
    setModalError('');
    setShowModal(true);
  };

  const handleDelete = (id: string) => {
    if (!confirm(t('stockholders.deleteConfirm'))) return;
    setActionError('');
    deleteMutation.mutate(id);
  };

  const handlePhoneChange = (value: string | undefined) => {
    setPhoneValue(value);
    if (value && !isValidPhoneNumber(value)) {
      setPhoneError(t('stockholders.addModal.phoneInvalid'));
    } else {
      setPhoneError('');
    }
  };


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError('');

    if (phoneValue && !isValidPhoneNumber(phoneValue)) {
      setPhoneError(t('stockholders.addModal.phoneInvalid'));
      return;
    }

    try {
      const stockholderData = {
        national_id: formData.national_id,
        full_name_ar: formData.full_name_ar.trim() || null,
        full_name_en: formData.full_name_en.trim() || null,
        email: formData.email.trim() || null,
        phone_number: phoneValue || null,
        birth_date_hijri: formData.birth_date_hijri.trim() || null,
        birth_date_gregorian: formData.birth_date_gregorian || null,
        birth_place: formData.birth_place.trim() || null,
        address_building: formData.address_building.trim() || null,
        address_street: formData.address_street.trim() || null,
        address_district: formData.address_district.trim() || null,
        address_city: formData.address_city.trim() || null,
        address_postal_code: formData.address_postal_code.trim() || null,
        address_additional_number: formData.address_additional_number.trim() || null,
        is_active: true,
      };

      await createStockholder(stockholderData);
      setShowModal(false);
      invalidateStockholders();
    } catch (err) {
      setModalError(getFriendlyError(err, t, 'stockholders.addModal.errors.generic'));
    }
  };

  const handleAddTransaction = (stockholderId: string) => {
    setAddingTransactionForId(stockholderId);
    setTransactionFormData({
      transaction_type: 'purchase',
      shares: 0,
      price_per_share: 0,
      total_amount: 0,
      transaction_date: new Date().toISOString().split('T')[0],
      notes: '',
    });
    setSelectedFile(null);
    setSelectedApprovalFile(null);
  };

  const handleSubmitTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addingTransactionForId) return;

    try {
      const transactionData = {
        stockholder_id: addingTransactionForId,
        transaction_type: transactionFormData.transaction_type,
        shares: transactionFormData.shares,
        price_per_share: transactionFormData.price_per_share || null,
        total_amount: transactionFormData.total_amount || null,
        transaction_date: transactionFormData.transaction_date,
        notes: transactionFormData.notes || null,
      };

      setIsSaving(true);
      const newTransaction = await createTransaction(transactionData);

      if (selectedFile) {
        const { data: { user } } = await supabaseClient.auth.getUser();
        await uploadCertificate(addingTransactionForId, selectedFile, user?.email ?? undefined, newTransaction.id);
      }

      if (selectedApprovalFile) {
        await uploadApprovalDocument(addingTransactionForId, newTransaction.id, selectedApprovalFile);
      }

      setAddingTransactionForId(null);
      invalidateStockholders();
    } catch (err) {
      setModalError(getFriendlyError(err, t, 'stockholders.transactionModal.failedToCreate'));
    } finally {
      setIsSaving(false);
    }
  };

  const calculateTotal = () => {
    const shares = transactionFormData.shares || 0;
    const pricePerShare = transactionFormData.price_per_share || 0;
    setTransactionFormData({ ...transactionFormData, total_amount: shares * pricePerShare });
  };

  const getStockholderName = (stockholderId: string): string => {
    const stockholder = stockholders.find(s => s.id === stockholderId);
    return stockholder ? stockholderDisplayName(stockholder, i18n.language) : '';
  };

  const formatNumber = (num: number): string => {
    return new Intl.NumberFormat().format(num);
  };

  if (isPending) {
    return (
      <div className="loading">
        <div className="spinner"></div>
        <p>{t('stockholders.loadingStockholders')}</p>
      </div>
    );
  }

  return (
    <div className="stockholders">
      <div className="stockholders-header">
        <h1>{t('stockholders.title')}</h1>
        <button onClick={handleCreate} className="btn-primary">
          {t('stockholders.addStockholder')}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="search-bar">
        <div className="search-input-wrapper">
          <svg className="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="search"
            className="search-input"
            value={searchInput}
            onChange={handleSearchChange}
            placeholder={t('stockholders.searchPlaceholder')}
            autoComplete="off"
          />
          {searchInput && (
            <button type="button" className="search-clear" onClick={handleSearchClear} aria-label={t('common.close')}>
              ×
            </button>
          )}
        </div>
        {searchQuery && (
          <p className="search-results-hint">
            {t('stockholders.searchResults', { count: totalCount })}
          </p>
        )}
      </div>

      <div
        className={`table-container${isFetching ? ' table-container--refreshing' : ''}`}
        aria-busy={isFetching}
      >
        <table>
          <thead>
            <tr>
              <th>{t('stockholders.nationalId')}</th>
              <th>{t('stockholders.name')}</th>
              <th>{t('stockholders.email')}</th>
              <th>{t('stockholders.phone')}</th>
              <th>{t('stockholders.shares')}</th>
              <th>{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {stockholders.length === 0 ? (
              <tr>
                <td colSpan={6} className="no-data">
                  {searchQuery ? t('stockholders.noSearchResults') : t('stockholders.noFound')}
                </td>
              </tr>
            ) : (
              stockholders.map((stockholder) => (
                <tr key={stockholder.id}>
                  <td>{stockholder.national_id}</td>
                  <td>{stockholderDisplayName(stockholder, i18n.language)}</td>
                  <td>{stockholder.email || t('common.na')}</td>
                  <td dir="ltr">{stockholder.phone_number || t('common.na')}</td>
                  <td>{formatNumber(stockholder.shares || 0)}</td>
                  <td>
                    <div className="action-buttons">
                      <button
                        onClick={() => setViewingStockholderId(stockholder.id)}
                        className="btn-view"
                        title={t('stockholders.details')}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                        </svg>
                        {t('stockholders.details')}
                      </button>
                      <button
                        onClick={() => handleAddTransaction(stockholder.id)}
                        className="btn-add-stock"
                        title={t('stockholders.sharesBtn')}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                        {t('stockholders.sharesBtn')}
                      </button>
                      <button
                        onClick={() => handleDelete(stockholder.id)}
                        className="btn-delete"
                        title={t('common.delete')}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" />
                        </svg>
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
          <button 
            disabled={page === 1} 
            onClick={() => setPage(page - 1)}
            className="btn-secondary"
          >
            {t('common.previous')}
          </button>
          <span className="pagination-info">
            {t('common.page', { page, total: totalPages, count: totalCount })}
          </span>
          <button 
            disabled={page === totalPages} 
            onClick={() => setPage(page + 1)}
            className="btn-secondary"
          >
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

      {addingTransactionForId && (
        <AdminDialogPortal>
        <div className="modal-overlay admin-dialog-overlay" onClick={() => setAddingTransactionForId(null)}>
          <div className="modal-content transaction-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{t('stockholders.transactionModal.title', { name: getStockholderName(addingTransactionForId) })}</h2>
              <button type="button" onClick={() => setAddingTransactionForId(null)} className="close-btn" aria-label={t('common.close')}>×</button>
            </div>
            <form onSubmit={handleSubmitTransaction} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <div className="modal-body">
                <div className="form-group" style={{ marginBottom: '1rem' }}>
                  <label>{t('stockholders.transactionModal.type')}</label>
                  <select
                    name="transaction_type"
                    value={transactionFormData.transaction_type}
                    onChange={(e) => setTransactionFormData({ ...transactionFormData, transaction_type: e.target.value as Transaction['transaction_type'] })}
                    required
                  >
                    <option value="purchase">{t('stockholders.transactionModal.purchase')}</option>
                    <option value="sell">{t('stockholders.transactionModal.sell')}</option>
                  </select>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>{t('stockholders.transactionModal.numberOfShares')}</label>
                    <input
                      type="number"
                      name="shares"
                      value={transactionFormData.shares}
                      onChange={(e) => setTransactionFormData({ ...transactionFormData, shares: parseInt(e.target.value) || 0 })}
                      onBlur={calculateTotal}
                      autoComplete="off"
                      required
                      min="1"
                    />
                  </div>
                  <div className="form-group">
                    <label>{t('stockholders.transactionModal.transactionDate')}</label>
                    <input
                      type="date"
                      name="transaction_date"
                      value={transactionFormData.transaction_date}
                      onChange={(e) => setTransactionFormData({ ...transactionFormData, transaction_date: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>{t('stockholders.transactionModal.pricePerShare')}</label>
                    <input
                      type="number"
                      name="price_per_share"
                      step="0.01"
                      value={transactionFormData.price_per_share}
                      onChange={(e) => setTransactionFormData({ ...transactionFormData, price_per_share: parseFloat(e.target.value) || 0 })}
                      onBlur={calculateTotal}
                      autoComplete="off"
                      min="0"
                    />
                  </div>
                  <div className="form-group">
                    <label>{t('stockholders.transactionModal.totalAmount')}</label>
                    <input
                      type="number"
                      name="total_amount"
                      step="0.01"
                      value={transactionFormData.total_amount}
                      onChange={(e) => setTransactionFormData({ ...transactionFormData, total_amount: parseFloat(e.target.value) || 0 })}
                      autoComplete="off"
                      min="0"
                    />
                  </div>
                </div>

                <div className="form-group" style={{ marginBottom: '1rem' }}>
                  <label>{t('stockholders.transactionModal.notes')}</label>
                  <textarea
                    name="notes"
                    value={transactionFormData.notes}
                    onChange={(e) => setTransactionFormData({ ...transactionFormData, notes: e.target.value })}
                    rows={3}
                    placeholder={t('stockholders.transactionModal.notesPlaceholder')}
                    autoComplete="off"
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>{t('stockholders.transactionModal.certificate')}</label>
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
                    <label>{t('stockholders.transactionModal.approvalDoc')}</label>
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
                <button type="button" onClick={() => setAddingTransactionForId(null)} className="btn-secondary">
                  {t('common.cancel')}
                </button>
                <button type="submit" className="btn-primary" disabled={isSaving}>
                  {isSaving ? t('stockholders.transactionModal.processing') : t('stockholders.transactionModal.addTransaction')}
                </button>
              </div>
            </form>
          </div>
        </div>
        </AdminDialogPortal>
      )}

      {showModal && (
        <AdminDialogPortal>
        <div className="modal-overlay admin-dialog-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content stockholder-form-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{t('stockholders.addModal.title')}</h2>
              <button type="button" onClick={() => setShowModal(false)} className="close-btn" aria-label={t('common.close')}>×</button>
            </div>
            
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <div className="modal-body">
                <div className="form-row">
                  <div className="form-group">
                    <label>{t('stockholders.addModal.nationalId')}</label>
                    <input
                      type="text"
                      name="national_id"
                      value={formData.national_id}
                      onChange={(e) => setFormData({ ...formData, national_id: e.target.value })}
                      required
                      autoComplete="off"
                    />
                  </div>
                  <div className="form-group">
                    <label>{t('stockholders.addModal.fullNameAr')}</label>
                    <input
                      type="text"
                      name="full_name_ar"
                      value={formData.full_name_ar}
                      onChange={(e) => setFormData({ ...formData, full_name_ar: e.target.value })}
                      autoComplete="off"
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>{t('stockholders.addModal.fullNameEn')}</label>
                    <input
                      type="text"
                      name="full_name_en"
                      value={formData.full_name_en}
                      onChange={(e) => setFormData({ ...formData, full_name_en: e.target.value })}
                      autoComplete="name"
                    />
                  </div>
                  <div className="form-group">
                    <label>{t('stockholders.addModal.email')}</label>
                    <input
                      type="email"
                      name="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      autoComplete="email"
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>
                      {t('stockholders.addModal.phone')}
                      {phoneValue && !phoneError && (
                        <span className="phone-valid-badge">{t('stockholders.addModal.phoneValid')}</span>
                      )}
                    </label>
                    <div className={`phone-input-wrapper${phoneError ? ' phone-input--error' : ''}`} dir="ltr">
                      <PhoneInput
                        international
                        defaultCountry="SA"
                        value={phoneValue}
                        onChange={handlePhoneChange}
                        placeholder={t('stockholders.addModal.phoneEnter')}
                        countrySelectComponent={CountrySelectWithSearch}
                      />
                    </div>
                    {phoneError && (
                      <span className="phone-error-msg">⚠ {phoneError}</span>
                    )}
                  </div>
                  <div className="form-group">
                    <label>{t('stockholders.addModal.birthHijri')}</label>
                    <input
                      type="text"
                      name="birth_date_hijri"
                      value={formData.birth_date_hijri}
                      onChange={(e) => setFormData({ ...formData, birth_date_hijri: e.target.value })}
                      placeholder="DD-MM-YYYY"
                      maxLength={10}
                      autoComplete="off"
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>{t('stockholders.addModal.birthGregorian')}</label>
                    <input
                      type="date"
                      name="birth_date_gregorian"
                      value={formData.birth_date_gregorian}
                      onChange={(e) => setFormData({ ...formData, birth_date_gregorian: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label>{t('stockholders.addModal.birthPlace')}</label>
                    <input
                      type="text"
                      name="birth_place"
                      value={formData.birth_place}
                      onChange={(e) => setFormData({ ...formData, birth_place: e.target.value })}
                      autoComplete="off"
                    />
                  </div>
                </div>

                <p className="form-section-hint">{t('stockholders.addModal.addressSection')}</p>
                <div className="form-row">
                  <div className="form-group">
                    <label>{t('stockholders.addModal.building')}</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      name="address_building"
                      value={formData.address_building}
                      onChange={(e) => setFormData({ ...formData, address_building: e.target.value })}
                      maxLength={4}
                      autoComplete="off"
                    />
                  </div>
                  <div className="form-group">
                    <label>{t('stockholders.addModal.street')}</label>
                    <input
                      type="text"
                      name="address_street"
                      value={formData.address_street}
                      onChange={(e) => setFormData({ ...formData, address_street: e.target.value })}
                      autoComplete="street-address"
                    />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>{t('stockholders.addModal.district')}</label>
                    <input
                      type="text"
                      name="address_district"
                      value={formData.address_district}
                      onChange={(e) => setFormData({ ...formData, address_district: e.target.value })}
                      autoComplete="off"
                    />
                  </div>
                  <div className="form-group">
                    <label>{t('stockholders.addModal.city')}</label>
                    <input
                      type="text"
                      name="address_city"
                      value={formData.address_city}
                      onChange={(e) => setFormData({ ...formData, address_city: e.target.value })}
                      autoComplete="address-level2"
                    />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>{t('stockholders.addModal.postal')}</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      name="address_postal_code"
                      value={formData.address_postal_code}
                      onChange={(e) => setFormData({ ...formData, address_postal_code: e.target.value })}
                      maxLength={5}
                      autoComplete="postal-code"
                    />
                  </div>
                  <div className="form-group">
                    <label>{t('stockholders.addModal.additional')}</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      name="address_additional_number"
                      value={formData.address_additional_number}
                      onChange={(e) => setFormData({ ...formData, address_additional_number: e.target.value })}
                      maxLength={4}
                      autoComplete="off"
                    />
                  </div>
                </div>

                {modalError && (
                  <div className="modal-error">
                    <span className="modal-error-icon">✕</span>
                    {modalError}
                  </div>
                )}
              </div>

              <div className="modal-footer">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">
                  {t('stockholders.addModal.cancel')}
                </button>
                <button type="submit" className="btn-primary">
                  {t('stockholders.addModal.create')}
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

export default Stockholders;
