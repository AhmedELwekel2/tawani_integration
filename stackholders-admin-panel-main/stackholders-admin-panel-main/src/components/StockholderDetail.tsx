import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import PhoneInput, { isValidPhoneNumber } from 'react-phone-number-input';
import 'react-phone-number-input/style.css';
import {
  getStockholderWithTransactions,
  StockholderWithTransactions,
  stockholderDisplayName,
  updateStockholder,
  updateStockholderStatus,
} from '../services/apiService';
import { AdminDialogPortal } from './AdminDialogPortal';
import saudiRiyalIcon from '../assets/saudi-riyal-icon.svg';
import CertificateUpload from './CertificateUpload';
import { ApprovalDocumentOpenButton } from './ApprovalDocumentOpenButton';
import { getFriendlyError } from '../utils/errorHelpers';
import './StockholderDetail.css';
import CountrySelectWithSearch from './CountrySelectWithSearch';
import './CountrySelectWithSearch.css';

interface StockholderDetailProps {
  stockholderId: string;
  onClose: () => void;
}

const PencilIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
  </svg>
);

function NationalAddressPreview({
  building, street, district, city, postal, additional,
  labels
}: {
  building: string | null; street: string | null; district: string | null;
  city: string | null; postal: string | null; additional: string | null;
  labels: { building: string; street: string; district: string; city: string; postalCode: string; additionalNo: string; noAddress: string };
}) {
  const lines: { label: string; value: string }[] = [];
  if (building) lines.push({ label: labels.building, value: building });
  if (street) lines.push({ label: labels.street, value: street });
  if (district) lines.push({ label: labels.district, value: district });
  if (city) lines.push({ label: labels.city, value: city });
  if (postal) lines.push({ label: labels.postalCode, value: postal });
  if (additional) lines.push({ label: labels.additionalNo, value: additional });
  if (lines.length === 0) {
    return <span className="info-value info-value--muted">{labels.noAddress}</span>;
  }
  return (
    <ul className="address-preview-list">
      {lines.map((row) => (
        <li key={row.label}>
          <span className="address-preview-label">{row.label}</span>
          <span className="address-preview-value">{row.value}</span>
        </li>
      ))}
    </ul>
  );
}

type EditFormState = {
  full_name_ar: string; full_name_en: string; email: string;
  birth_date_hijri: string; birth_date_gregorian: string; birth_place: string;
  address_building: string; address_street: string; address_district: string;
  address_city: string; address_postal_code: string; address_additional_number: string;
  member_since: string;
};

const emptyEditForm = (): EditFormState => ({
  full_name_ar: '', full_name_en: '', email: '',
  birth_date_hijri: '', birth_date_gregorian: '', birth_place: '',
  address_building: '', address_street: '', address_district: '',
  address_city: '', address_postal_code: '', address_additional_number: '',
  member_since: '',
});

const StockholderDetail: React.FC<StockholderDetailProps> = ({ stockholderId, onClose }) => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'ar' ? 'ar-SA' : 'en-US';

  const [stockholder, setStockholder] = useState<StockholderWithTransactions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<EditFormState>(emptyEditForm);
  const [phoneValue, setPhoneValue] = useState<string | undefined>(undefined);
  const [phoneError, setPhoneError] = useState('');
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveError, setSaveError] = useState('');

  const [showStatusConfirm, setShowStatusConfirm] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState('');

  const loadStockholderDetails = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const data = await getStockholderWithTransactions(stockholderId);
      setStockholder(data);
    } catch (err) {
      setError(getFriendlyError(err, t, 'detail.failedToLoad'));
    } finally {
      setLoading(false);
    }
  }, [stockholderId, t]);

  useEffect(() => {
    loadStockholderDetails();
  }, [loadStockholderDetails]);

  const syncFormFromStockholder = useCallback((s: StockholderWithTransactions) => {
    setEditForm({
      full_name_ar: s.full_name_ar || '',
      full_name_en: s.full_name_en || '',
      email: s.email || '',
      birth_date_hijri: s.birth_date_hijri || '',
      birth_date_gregorian: s.birth_date_gregorian ? s.birth_date_gregorian.slice(0, 10) : '',
      birth_place: s.birth_place || '',
      address_building: s.address_building || '',
      address_street: s.address_street || '',
      address_district: s.address_district || '',
      address_city: s.address_city || '',
      address_postal_code: s.address_postal_code || '',
      address_additional_number: s.address_additional_number || '',
      member_since: s.created_at ? s.created_at.slice(0, 10) : '',
    });
    setPhoneValue(s.phone_number || undefined);
    setPhoneError('');
    setSaveError('');
  }, []);

  const startEdit = () => {
    if (stockholder) syncFormFromStockholder(stockholder);
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setPhoneError('');
    setSaveError('');
    if (stockholder) syncFormFromStockholder(stockholder);
  };

  const handlePhoneChange = (value: string | undefined) => {
    setPhoneValue(value);
    if (value && !isValidPhoneNumber(value)) {
      setPhoneError(t('detail.invalidPhone'));
    } else {
      setPhoneError('');
    }
  };

  const saveEdit = async () => {
    if (!stockholder) return;
    if (phoneValue && !isValidPhoneNumber(phoneValue)) {
      setPhoneError(t('detail.invalidPhone'));
      return;
    }
    setSaveLoading(true);
    setSaveError('');
    try {
      await updateStockholder(stockholder.id, {
        full_name_ar: editForm.full_name_ar.trim() || null,
        full_name_en: editForm.full_name_en.trim() || null,
        email: editForm.email.trim() || null,
        phone_number: phoneValue || null,
        birth_date_hijri: editForm.birth_date_hijri.trim() || null,
        birth_date_gregorian: editForm.birth_date_gregorian || null,
        birth_place: editForm.birth_place.trim() || null,
        address_building: editForm.address_building.trim() || null,
        address_street: editForm.address_street.trim() || null,
        address_district: editForm.address_district.trim() || null,
        address_city: editForm.address_city.trim() || null,
        address_postal_code: editForm.address_postal_code.trim() || null,
        address_additional_number: editForm.address_additional_number.trim() || null,
        created_at: editForm.member_since ? new Date(editForm.member_since).toISOString() : stockholder.created_at,
      });
      await loadStockholderDetails();
      setIsEditing(false);
    } catch (err) {
      setSaveError(getFriendlyError(err, t, 'detail.failedToSave'));
    } finally {
      setSaveLoading(false);
    }
  };

  const confirmStatusToggle = async () => {
    if (!stockholder) return;
    setStatusLoading(true);
    setStatusError('');
    try {
      await updateStockholderStatus(stockholder.id, !stockholder.is_active);
      await loadStockholderDetails();
      setShowStatusConfirm(false);
    } catch (err) {
      setStatusError(getFriendlyError(err, t, 'stockholders.statusUpdateFailed'));
    } finally {
      setStatusLoading(false);
    }
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

  const formatDate = (dateString: string | null): string => {
    if (!dateString) return t('common.na');
    return new Date(dateString).toLocaleDateString(locale, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  };

  const getTransactionTypeLabel = (type: string): string => {
    const labels: { [key: string]: string } = {
      purchase: t('detail.purchase'),
      sell: t('detail.sell'),
    };
    return labels[type] || type;
  };

  const getTransactionTypeColor = (type: string): string => {
    const colors: { [key: string]: string } = { purchase: 'success', sell: 'danger' };
    return colors[type] || 'default';
  };

  const addressLabels = {
    building: t('detail.building'),
    street: t('detail.street'),
    district: t('detail.district'),
    city: t('detail.city'),
    postalCode: t('detail.postalCode'),
    additionalNo: t('detail.additionalNo'),
    noAddress: t('detail.noAddress'),
  };

  if (loading) {
    return (
      <AdminDialogPortal>
        <div className="detail-overlay admin-dialog-overlay" onClick={onClose}>
          <div className="detail-content loading-state" onClick={(e) => e.stopPropagation()}>
            <div className="spinner"></div>
            <p>{t('detail.loading')}</p>
          </div>
        </div>
      </AdminDialogPortal>
    );
  }

  if (error) {
    return (
      <AdminDialogPortal>
        <div className="detail-overlay admin-dialog-overlay" onClick={onClose}>
          <div className="detail-content" onClick={(e) => e.stopPropagation()}>
            <div className="detail-header">
              <h2>{t('common.error')}</h2>
              <button onClick={onClose} className="close-btn">×</button>
            </div>
            <div className="error-message">
              <p>{error}</p>
              <button onClick={loadStockholderDetails} className="btn-primary">{t('common.retry')}</button>
            </div>
          </div>
        </div>
      </AdminDialogPortal>
    );
  }

  if (!stockholder) return null;

  return (
    <AdminDialogPortal>
      <div className="detail-overlay admin-dialog-overlay" onClick={onClose}>
      <div className="detail-content" onClick={(e) => e.stopPropagation()}>
        <div className="detail-header detail-header--with-actions">
          <div className="detail-header-title-group">
            <h2>{stockholderDisplayName(stockholder, i18n.language)}</h2>
            <span className={`status-badge status-badge--${stockholder.is_active ? 'active' : 'inactive'}`}>
              {stockholder.is_active ? t('stockholders.statusActive') : t('stockholders.statusInactive')}
            </span>
          </div>
          <div className="detail-header-actions">
            <button
              type="button"
              className={`btn-status-toggle btn-status-toggle--${stockholder.is_active ? 'deactivate' : 'activate'}`}
              onClick={() => { setShowStatusConfirm(true); setStatusError(''); }}
              disabled={statusLoading}
            >
              {stockholder.is_active ? t('stockholders.deactivate') : t('stockholders.activate')}
            </button>
            <button type="button" onClick={onClose} className="close-btn" aria-label={t('detail.close')}>×</button>
          </div>
        </div>

        {showStatusConfirm && (
          <div className="status-confirm-banner">
            <p className="status-confirm-message">
              {stockholder.is_active ? t('stockholders.deactivateConfirm') : t('stockholders.activateConfirm')}
            </p>
            {statusError && <p className="status-confirm-error">{statusError}</p>}
            <div className="status-confirm-actions">
              <button
                type="button"
                className="btn-secondary btn-compact"
                onClick={() => setShowStatusConfirm(false)}
                disabled={statusLoading}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className={`btn-compact btn-status-confirm--${stockholder.is_active ? 'deactivate' : 'activate'}`}
                onClick={confirmStatusToggle}
                disabled={statusLoading}
              >
                {statusLoading
                  ? t('common.processing')
                  : stockholder.is_active
                    ? t('stockholders.deactivate')
                    : t('stockholders.activate')}
              </button>
            </div>
          </div>
        )}

        <div className="detail-body">
          <div className={`info-card info-card--personal${isEditing ? ' info-card--editing' : ''}`}>
            <div className="info-card-header">
              <div className="info-card-header-text">
                <h3>{t('detail.personalInfo')}</h3>
                <p className="info-card-subtitle">
                  {isEditing ? t('detail.updateFields') : t('detail.readOnlySummary')}
                </p>
              </div>
              {!isEditing ? (
                <button type="button" className="btn-edit-profile" onClick={startEdit} title={t('detail.edit')} aria-label={t('detail.edit')}>
                  <PencilIcon />
                  <span>{t('detail.edit')}</span>
                </button>
              ) : (
                <div className="info-card-edit-actions">
                  <button type="button" className="btn-secondary btn-compact" onClick={cancelEdit} disabled={saveLoading}>
                    {t('detail.cancel')}
                  </button>
                  <button type="button" className="btn-primary btn-compact" onClick={saveEdit} disabled={saveLoading}>
                    {saveLoading ? t('detail.saving') : t('detail.saveChanges')}
                  </button>
                </div>
              )}
            </div>

            {saveError && <div className="detail-inline-error">{saveError}</div>}

            {!isEditing ? (
            <div className="info-grid info-grid--view">
              <div className="info-section-heading">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginInlineEnd: '0.625rem' }}>
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                {t('detail.identification')}
              </div>
              <div className="info-item">
                <span className="info-label">{t('detail.nationalId')}</span>
                <span className="info-value info-value--mono">{stockholder.national_id}</span>
              </div>
              <div className="info-item">
                <span className="info-label">{t('detail.fullNameAr')}</span>
                <span className={`info-value${!stockholder.full_name_ar ? ' info-value--muted' : ''}`}>
                  {stockholder.full_name_ar || '—'}
                </span>
              </div>
              <div className="info-item">
                <span className="info-label">{t('detail.fullNameEn')}</span>
                <span className={`info-value${!stockholder.full_name_en ? ' info-value--muted' : ''}`}>
                  {stockholder.full_name_en || '—'}
                </span>
              </div>

              <div className="info-section-heading">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginInlineEnd: '0.625rem' }}>
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
                {t('detail.contact')}
              </div>
              <div className="info-item info-item--wide">
                <span className="info-label">{t('detail.email')}</span>
                <span className={`info-value${!stockholder.email ? ' info-value--muted' : ''}`}>
                  {stockholder.email || '—'}
                </span>
              </div>
              <div className="info-item info-item--wide">
                <span className="info-label">{t('detail.phone')}</span>
                <span 
                  className={`info-value${!stockholder.phone_number ? ' info-value--muted' : ''}`} 
                  dir="ltr"
                >
                  {stockholder.phone_number || '—'}
                </span>
              </div>

              <div className="info-section-heading">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginInlineEnd: '0.625rem' }}>
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                {t('detail.birthDetails')}
              </div>
              <div className="info-item">
                <span className="info-label">{t('detail.birthHijri')}</span>
                <span className={`info-value${!stockholder.birth_date_hijri ? ' info-value--muted' : ''}`}>
                  {stockholder.birth_date_hijri || '—'}
                </span>
              </div>
              <div className="info-item">
                <span className="info-label">{t('detail.birthGregorian')}</span>
                <span className={`info-value${!stockholder.birth_date_gregorian ? ' info-value--muted' : ''}`}>
                  {stockholder.birth_date_gregorian ? formatDate(stockholder.birth_date_gregorian) : '—'}
                </span>
              </div>
              <div className="info-item">
                <span className="info-label">{t('detail.birthPlace')}</span>
                <span className={`info-value${!stockholder.birth_place ? ' info-value--muted' : ''}`}>
                  {stockholder.birth_place || '—'}
                </span>
              </div>

              <div className="info-section-heading">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginInlineEnd: '0.625rem' }}>
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
                </svg>
                {t('detail.nationalAddress')}
              </div>
              <div className="info-item info-item--wide info-item--address">
                <NationalAddressPreview
                  building={stockholder.address_building}
                  street={stockholder.address_street}
                  district={stockholder.address_district}
                  city={stockholder.address_city}
                  postal={stockholder.address_postal_code}
                  additional={stockholder.address_additional_number}
                  labels={addressLabels}
                />
              </div>

              <div className="info-section-heading">{t('detail.membership')}</div>
              <div className="member-stats">
                <div className="member-stat member-stat--primary">
                  <span className="member-stat-label">{t('detail.totalShares')}</span>
                  <span className="member-stat-value">{formatNumber(stockholder.shares || 0)}</span>
                </div>
                <div className="member-stat">
                  <span className="member-stat-label">{t('detail.memberSince')}</span>
                  <span className="member-stat-value">{formatDate(stockholder.created_at)}</span>
                </div>
              </div>
            </div>
            ) : (
            <div className="info-grid info-grid--edit">
              <div className="info-edit-section-title">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginInlineEnd: '0.5rem' }}>
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                {t('detail.personalInfo')}
              </div>
              <div className="info-item">
                <label htmlFor="edit-national-id">{t('detail.nationalId')}</label>
                <span id="edit-national-id" className="info-value info-value--readonly info-value--mono">{stockholder.national_id}</span>
              </div>
              <div className="info-item">
                <label htmlFor="edit-full_name_ar">{t('detail.fullNameAr')}</label>
                <input id="edit-full_name_ar" className="info-input" value={editForm.full_name_ar} onChange={(e) => setEditForm({ ...editForm, full_name_ar: e.target.value })} autoComplete="off" />
              </div>
              <div className="info-item">
                <label htmlFor="edit-full_name_en">{t('detail.fullNameEn')}</label>
                <input id="edit-full_name_en" className="info-input" value={editForm.full_name_en} onChange={(e) => setEditForm({ ...editForm, full_name_en: e.target.value })} autoComplete="name" />
              </div>
              <div className="info-item info-item--wide">
                <label htmlFor="edit-email">{t('detail.email')}</label>
                <input id="edit-email" type="email" className="info-input" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} autoComplete="email" />
              </div>
              <div className="info-item info-item--wide">
                <label>{t('detail.phone')}</label>
                <div className={`phone-input-wrap${phoneError ? ' phone-input-wrap--error' : ''}`}>
                    <PhoneInput international defaultCountry="SA" value={phoneValue} onChange={handlePhoneChange} countrySelectComponent={CountrySelectWithSearch} />
                </div>
                {phoneError && <span className="field-hint field-hint--error">{phoneError}</span>}
              </div>
              <div className="info-edit-section-title info-edit-section-title--spaced">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginInlineEnd: '0.5rem' }}>
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                {t('detail.birthDetails')}
              </div>
              <div className="info-item">
                <label htmlFor="edit-hijri">{t('detail.birthHijri')}</label>
                <input id="edit-hijri" className="info-input" placeholder="DD-MM-YYYY" maxLength={10} value={editForm.birth_date_hijri} onChange={(e) => setEditForm({ ...editForm, birth_date_hijri: e.target.value })} />
              </div>
              <div className="info-item">
                <label htmlFor="edit-greg">{t('detail.birthGregorian')}</label>
                <input id="edit-greg" type="date" className="info-input" value={editForm.birth_date_gregorian} onChange={(e) => setEditForm({ ...editForm, birth_date_gregorian: e.target.value })} />
              </div>
              <div className="info-item">
                <label htmlFor="edit-birth-place">{t('detail.birthPlace')}</label>
                <input id="edit-birth-place" className="info-input" value={editForm.birth_place} onChange={(e) => setEditForm({ ...editForm, birth_place: e.target.value })} />
              </div>
              <div className="info-edit-section-title info-edit-section-title--spaced">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginInlineEnd: '0.5rem' }}>
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
                </svg>
                {t('detail.nationalAddress')}
              </div>
              <div className="info-item">
                <label htmlFor="edit-ab">{t('detail.buildingNo')}</label>
                <input id="edit-ab" className="info-input" inputMode="numeric" maxLength={4} value={editForm.address_building} onChange={(e) => setEditForm({ ...editForm, address_building: e.target.value })} />
              </div>
              <div className="info-item">
                <label htmlFor="edit-street">{t('detail.street')}</label>
                <input id="edit-street" className="info-input" value={editForm.address_street} onChange={(e) => setEditForm({ ...editForm, address_street: e.target.value })} />
              </div>
              <div className="info-item">
                <label htmlFor="edit-dist">{t('detail.district')}</label>
                <input id="edit-dist" className="info-input" value={editForm.address_district} onChange={(e) => setEditForm({ ...editForm, address_district: e.target.value })} />
              </div>
              <div className="info-item">
                <label htmlFor="edit-city">{t('detail.city')}</label>
                <input id="edit-city" className="info-input" value={editForm.address_city} onChange={(e) => setEditForm({ ...editForm, address_city: e.target.value })} />
              </div>
              <div className="info-item">
                <label htmlFor="edit-postal">{t('detail.postal')}</label>
                <input id="edit-postal" className="info-input" inputMode="numeric" maxLength={5} value={editForm.address_postal_code} onChange={(e) => setEditForm({ ...editForm, address_postal_code: e.target.value })} />
              </div>
              <div className="info-item">
                <label htmlFor="edit-add">{t('detail.additional')}</label>
                <input id="edit-add" className="info-input" inputMode="numeric" maxLength={4} value={editForm.address_additional_number} onChange={(e) => setEditForm({ ...editForm, address_additional_number: e.target.value })} />
              </div>
              <div className="info-edit-section-title info-edit-section-title--spaced">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginInlineEnd: '0.5rem' }}>
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                </svg>
                {t('detail.membershipReadOnly')}
              </div>
              <div className="info-item">
                <label>{t('detail.totalShares')}</label>
                <span className="info-value info-value--readonly highlight">{formatNumber(stockholder.shares || 0)}</span>
              </div>
              <div className="info-item">
                <label htmlFor="edit-member-since">{t('detail.memberSince')}</label>
                <input id="edit-member-since" type="date" className="info-input" value={editForm.member_since} onChange={(e) => setEditForm({ ...editForm, member_since: e.target.value })} />
              </div>
            </div>
            )}
          </div>

          <div className="transactions-card">
            <h3>{t('detail.transactionHistory')}</h3>
            {!stockholder.transactions || stockholder.transactions.length === 0 ? (
              <div className="no-transactions">
                <p>{t('detail.noTransactions')}</p>
              </div>
            ) : (
              <div className="transactions-list">
                {stockholder.transactions.map((transaction) => (
                  <div key={transaction.id} className="transaction-item">
                    <div className="transaction-main">
                      <div className="transaction-info">
                        <span className={`transaction-badge ${getTransactionTypeColor(transaction.transaction_type)}`}>
                          {getTransactionTypeLabel(transaction.transaction_type)}
                        </span>
                        <span className="transaction-date">{formatDate(transaction.transaction_date)}</span>
                      </div>
                      <div className="transaction-amount">
                        <span className="shares-label">{t('detail.shares')}</span>
                        <span className="shares-value">{formatNumber(transaction.shares)}</span>
                      </div>
                    </div>
                    
                    <div className="transaction-details">
                      {transaction.price_per_share !== null && (
                        <div className="detail-item">
                          <span className="detail-label">{t('detail.pricePerShare')}</span>
                          <span className="detail-value">{formatCurrency(transaction.price_per_share)}</span>
                        </div>
                      )}
                      {transaction.total_amount !== null && (
                        <div className="detail-item">
                          <span className="detail-label">{t('detail.totalAmount')}</span>
                          <span className="detail-value">{formatCurrency(transaction.total_amount)}</span>
                        </div>
                      )}
                      {transaction.notes && (
                        <div className="detail-item notes">
                          <span className="detail-label">{t('detail.notes')}</span>
                          <span className="detail-value">{transaction.notes}</span>
                        </div>
                      )}
                      {transaction.approval_document_storage_path && (
                        <div className="detail-item">
                          <span className="detail-label">{t('detail.approvalDoc')}</span>
                          <ApprovalDocumentOpenButton
                            storagePath={transaction.approval_document_storage_path}
                            fileName={transaction.approval_document_name}
                            className="doc-link-inline"
                            label={t('detail.viewDocument')}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="transactions-card" style={{ marginTop: '2rem' }}>
            <h3>{t('detail.yearlyDividends')}</h3>
            {!stockholder.yearlyDividends || stockholder.yearlyDividends.length === 0 ? (
              <div className="no-transactions">
                <p>{t('detail.noDividends')}</p>
              </div>
            ) : (
              <div className="transactions-list">
                {stockholder.yearlyDividends.map((row) => (
                  <div key={row.id} className="transaction-item" style={{ borderInlineStartColor: '#3b82f6' }}>
                    <div className="transaction-main">
                      <div className="transaction-info">
                        <span className="transaction-badge" style={{ backgroundColor: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }}>
                          {row.year}
                        </span>
                        <span className="transaction-date">{t('detail.updatedOn')} {formatDate(row.updated_at || row.created_at)}</span>
                      </div>
                      <div className="transaction-amount">
                        <span className="shares-value" style={{ color: '#0f172a' }}>{formatCurrency(row.amount)}</span>
                      </div>
                    </div>
                    
                    {row.notes && (
                      <div className="transaction-details">
                        <div className="detail-item notes">
                          <span className="detail-label">{t('detail.notes')}</span>
                          <span className="detail-value">{row.notes}</span>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <CertificateUpload stockholderId={stockholder.id} />
        </div>

        <div className="detail-footer">
          <button type="button" onClick={onClose} className="btn-secondary">{t('detail.close')}</button>
        </div>
      </div>
    </div>
    </AdminDialogPortal>
  );
};

export default StockholderDetail;
