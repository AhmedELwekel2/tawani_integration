import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { 
  getAllDividends, 
  getAllStockholders,
  createDividend,
  updateDividend,
  deleteDividend,
  YearlyDividends,
  stockholderDisplayName,
} from '../services/apiService';
import saudiRiyalIcon from '../assets/saudi-riyal-icon.svg';
import { AdminDialogPortal } from './AdminDialogPortal';
import StockholderSelect from './StockholderSelect';
import { getFriendlyError } from '../utils/errorHelpers';
import { queryKeys } from '../services/queryClient';
import './DividendsManager.css';

const DividendsManager: React.FC = () => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'ar' ? 'ar-SA' : 'en-US';

  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState('');

  const { data: dividends = [], isPending: loading, error: dividendsError } = useQuery({
    queryKey: queryKeys.dividends.all,
    queryFn: getAllDividends,
  });

  const { data: stockholders = [], error: stockholdersError } = useQuery({
    queryKey: queryKeys.stockholders.all,
    queryFn: getAllStockholders,
  });

  const loadError = dividendsError ?? stockholdersError;
  const error = actionError || (loadError ? getFriendlyError(loadError, t, 'dividends.failedToLoad') : '');

  const loadData = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.dividends.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.stats });
  };
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<YearlyDividends | null>(null);
  const [formData, setFormData] = useState({
    stockholder_id: '',
    year: new Date().getFullYear(),
    amount: '',
    notes: ''
  });
  const [submitting, setSubmitting] = useState(false);

  const getStockholderName = (id: string) => {
    const stockholder = stockholders.find(s => s.id === id);
    return stockholder ? stockholderDisplayName(stockholder, i18n.language) : t('dividends.unknown');
  };

  const handleOpenForm = (row?: YearlyDividends) => {
    if (row) {
      setEditingRow(row);
      setFormData({
        stockholder_id: row.stockholder_id,
        year: row.year,
        amount: row.amount.toString(),
        notes: row.notes || ''
      });
    } else {
      setEditingRow(null);
      setFormData({
        stockholder_id: stockholders.length > 0 ? stockholders[0].id : '',
        year: new Date().getFullYear(),
        amount: '',
        notes: ''
      });
    }
    setIsFormOpen(true);
  };

  const handleCloseForm = () => {
    setIsFormOpen(false);
    setEditingRow(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      setActionError('');
      
      const payload = {
        stockholder_id: formData.stockholder_id,
        year: parseInt(formData.year.toString()),
        amount: parseFloat(formData.amount),
        notes: formData.notes
      };

      if (editingRow) {
        await updateDividend(editingRow.id, payload);
      } else {
        await createDividend(payload);
      }
      
      handleCloseForm();
      loadData();
    } catch (err) {
      setActionError(getFriendlyError(err, t, 'dividends.failedToSave'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm(t('dividends.deleteConfirm'))) {
      try {
        setActionError('');
        await deleteDividend(id);
        loadData();
      } catch (err) {
        setActionError(getFriendlyError(err, t, 'dividends.failedToDelete'));
      }
    }
  };

  const formatCurrency = (num: number): JSX.Element => {
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

  const formatDateTime = (dateString: string): string => {
    return new Date(dateString).toLocaleString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading && dividends.length === 0) {
    return (
      <div className="dividends-manager-loading">
        <div className="spinner"></div>
        <p>{t('dividends.loading')}</p>
      </div>
    );
  }

  return (
    <div className="dividends-manager">
      <div className="dividends-manager-header">
        <div>
          <h1>{t('dividends.title')}</h1>
          <p className="subtitle">{t('dividends.subtitle')}</p>
        </div>
        <button className="btn-primary" onClick={() => handleOpenForm()}>
          {t('dividends.addRecord')}
        </button>
      </div>

      {error && (
        <div className="error-banner">
          <p>{error}</p>
          <button onClick={() => setActionError('')} className="close-btn">×</button>
        </div>
      )}

      {isFormOpen && (
        <AdminDialogPortal>
        <div className="modal-overlay admin-dialog-overlay" onClick={handleCloseForm}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingRow ? t('dividends.modal.editTitle') : t('dividends.modal.addTitle')}</h2>
              <button onClick={handleCloseForm} className="close-btn">×</button>
            </div>
            
            <form onSubmit={handleSubmit} className="dividends-form">
              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label htmlFor="stockholder_id">{t('dividends.modal.stockholder')}</label>
                <StockholderSelect
                  stockholders={stockholders}
                  selectedId={formData.stockholder_id}
                  onChange={(id) => setFormData({ ...formData, stockholder_id: id })}
                  disabled={!!editingRow}
                  required
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="year">{t('dividends.modal.year')}</label>
                  <input 
                    type="number" 
                    id="year"
                    name="year"
                    value={formData.year}
                    onChange={(e) => setFormData({...formData, year: Number(e.target.value)})}
                    required
                    min="2000"
                    max="2100"
                    autoComplete="off"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="amount">{t('dividends.modal.amount')}</label>
                  <input 
                    type="number" 
                    id="amount"
                    name="amount"
                    value={formData.amount}
                    onChange={(e) => setFormData({...formData, amount: e.target.value})}
                    required
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    autoComplete="off"
                  />
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="notes">{t('dividends.modal.notes')}</label>
                <textarea 
                  id="notes"
                  name="notes"
                  value={formData.notes}
                  onChange={(e) => setFormData({...formData, notes: e.target.value})}
                  placeholder={t('dividends.modal.notesPlaceholder')}
                  rows={3}
                  autoComplete="off"
                />
              </div>

              <div className="form-actions">
                <button type="button" className="btn-secondary" onClick={handleCloseForm}>
                  {t('dividends.modal.cancel')}
                </button>
                <button type="submit" className="btn-primary" disabled={submitting}>
                  {submitting ? t('dividends.modal.saving') : t('dividends.modal.save')}
                </button>
              </div>
            </form>
          </div>
        </div>
        </AdminDialogPortal>
      )}

      <div className="dividends-table-container">
        {dividends.length === 0 ? (
          <div className="no-data">
            <p>{t('dividends.noRecords')}</p>
          </div>
        ) : (
          <table className="modern-table">
            <thead>
              <tr>
                <th>{t('dividends.year')}</th>
                <th>{t('dividends.stockholder')}</th>
                <th>{t('dividends.amount')}</th>
                <th>{t('dividends.notes')}</th>
                <th>{t('dividends.lastUpdated')}</th>
                <th>{t('dividends.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {dividends.map(record => (
                <tr key={record.id}>
                  <td>
                    <span className="year-badge">{record.year}</span>
                  </td>
                  <td>
                    <span className="stockholder-name" title={record.stockholder_id}>
                      {getStockholderName(record.stockholder_id)}
                    </span>
                  </td>
                  <td className="amount-cell">
                    {formatCurrency(record.amount)}
                  </td>
                  <td className="notes-cell">
                    {record.notes ? (
                      <span className="truncate-text" title={record.notes}>
                        {record.notes}
                      </span>
                    ) : (
                      <span className="text-muted">-</span>
                    )}
                  </td>
                  <td className="date-cell">
                    {formatDateTime(record.updated_at || record.created_at)}
                  </td>
                  <td className="actions-cell">
                    <button 
                      className="btn-icon edit" 
                      onClick={() => handleOpenForm(record)}
                      title={t('common.edit')}
                    >
                      ✏️
                    </button>
                    <button 
                      className="btn-icon delete" 
                      onClick={() => handleDelete(record.id)}
                      title={t('common.delete')}
                    >
                      🗑️
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default DividendsManager;
