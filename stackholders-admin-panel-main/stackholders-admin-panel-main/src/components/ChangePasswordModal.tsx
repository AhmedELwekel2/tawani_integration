import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AdminDialogPortal } from './AdminDialogPortal';
import { changeOwnPassword } from '../services/authService';
import { getFriendlyError } from '../utils/errorHelpers';
import './ChangePassword.css';

interface ChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  const handleClose = () => {
    if (submitting) return;
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError('');
    setSuccess(false);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword.length < 8) {
      setError(t('changePassword.errors.weakPassword'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t('changePassword.errors.passwordMismatch'));
      return;
    }

    try {
      setSubmitting(true);
      await changeOwnPassword(currentPassword, newPassword);
      setSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message === 'CURRENT_PASSWORD_INVALID') {
        setError(t('changePassword.errors.invalidCurrentPassword'));
      } else if (message === 'NOT_AUTHENTICATED') {
        setError(t('common.errors.unauthorized'));
      } else {
        setError(getFriendlyError(err, t, 'changePassword.failed'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AdminDialogPortal>
      <div className="cp-modal-overlay admin-dialog-overlay" onClick={handleClose}>
        <div className="cp-modal" onClick={(e) => e.stopPropagation()}>
          <h2>{t('changePassword.title')}</h2>

          {error && <div className="cp-error">{error}</div>}
          {success && <div className="cp-success">{t('changePassword.success')}</div>}

          <form onSubmit={handleSubmit}>
            <label className="cp-form-label">
              {t('changePassword.currentPassword')}
              <input
                type="password"
                className="cp-form-input"
                required
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={submitting || success}
              />
            </label>

            <label className="cp-form-label">
              {t('changePassword.newPassword')}
              <input
                type="password"
                className="cp-form-input"
                required
                minLength={8}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={submitting || success}
              />
            </label>

            <label className="cp-form-label">
              {t('changePassword.confirmPassword')}
              <input
                type="password"
                className="cp-form-input"
                required
                minLength={8}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={submitting || success}
              />
            </label>

            <p className="cp-form-hint">{t('changePassword.passwordHint')}</p>

            <div className="cp-modal-actions">
              <button type="button" className="cp-btn-cancel" onClick={handleClose} disabled={submitting}>
                {success ? t('common.close') : t('common.cancel')}
              </button>
              {!success && (
                <button type="submit" className="cp-btn-submit" disabled={submitting}>
                  {submitting ? t('common.processing') : t('changePassword.submit')}
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </AdminDialogPortal>
  );
};

export default ChangePasswordModal;
