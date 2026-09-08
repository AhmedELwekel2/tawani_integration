import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  listPortalAdmins,
  createPortalAdmin,
  deletePortalAdmin,
  PortalAdminRow,
  StaffRole,
} from '../services/adminPortalUsersService';
import { supabaseClient } from '../services/supabaseClient';
import './Transactions.css';
import './ContactSubmissions.css';
import './AdminUsers.css';

const AdminUsers: React.FC = () => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<PortalAdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<StaffRole>('admin');
  const [submitting, setSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [users, { data: userData }] = await Promise.all([
        listPortalAdmins(),
        supabaseClient.auth.getUser(),
      ]);
      setRows(users);
      setCurrentUserId(userData.user?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('adminUsers.failedToLoad'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      setError('');
      await createPortalAdmin(newEmail.trim(), newPassword, newRole);
      setShowModal(false);
      setNewEmail('');
      setNewPassword('');
      setNewRole('admin');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('adminUsers.failedToCreate'));
    } finally {
      setSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    try {
      setSubmitting(true);
      setError('');
      await deletePortalAdmin(deleteId);
      setDeleteId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('adminUsers.failedToDelete'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && rows.length === 0) {
    return (
      <div className="loading">
        <div className="spinner" />
        <p>{t('adminUsers.loading')}</p>
      </div>
    );
  }

  return (
    <div className="admin-users-view">
      <div className="admin-view-header">
        <h1>{t('adminUsers.title')}</h1>
        <div className="admin-users-header-actions">
          <button type="button" className="btn-refresh" onClick={() => load()} disabled={loading}>
            {t('common.refresh')}
          </button>
          <button type="button" className="btn-primary-add" onClick={() => setShowModal(true)}>
            {t('adminUsers.addAdmin')}
          </button>
        </div>
      </div>

      <p className="admin-users-hint">{t('adminUsers.hint')}</p>

      {error && <div className="error-banner">{error}</div>}

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>{t('adminUsers.email')}</th>
              <th>{t('adminUsers.role', 'Role')}</th>
              <th>{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={3} className="no-data-cell">
                  {t('adminUsers.noAdmins')}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <span className="admin-email">{row.email}</span>
                    {row.id === currentUserId && (
                      <span className="you-badge">{t('adminUsers.you')}</span>
                    )}
                  </td>
                  <td>
                    {/* Accounts created before roles existed report none; they
                        are admins, which is how the API treats them too. */}
                    {(row.role ?? 'admin') === 'editor'
                      ? t('adminUsers.roleEditorShort', 'Editor')
                      : t('adminUsers.roleAdminShort', 'Admin')}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn-danger-outline"
                      disabled={row.id === currentUserId || submitting}
                      onClick={() => setDeleteId(row.id)}
                    >
                      {t('common.delete')}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="modal-overlay admin-dialog-overlay" onClick={() => !submitting && setShowModal(false)}>
          <div className="modal-content admin-users-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{t('adminUsers.modalTitle')}</h2>
            <form onSubmit={handleCreate}>
              <label className="form-label">
                {t('adminUsers.email')}
                <input
                  type="email"
                  required
                  autoComplete="off"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="form-input"
                />
              </label>
              <label className="form-label">
                {t('adminUsers.password')}
                <input
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="form-input"
                />
              </label>
              <p className="form-hint">{t('adminUsers.passwordHint')}</p>
              <label className="form-label">
                {t('adminUsers.role', 'Role')}
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as StaffRole)}
                  className="form-input"
                >
                  <option value="admin">{t('adminUsers.roleAdmin', 'Admin — full access')}</option>
                  <option value="editor">
                    {t('adminUsers.roleEditor', 'Editor — content only')}
                  </option>
                </select>
              </label>
              <p className="form-hint">
                {t(
                  'adminUsers.roleHint',
                  'Editors can generate and publish news, reports and announcements. They cannot see stockholder data.'
                )}
              </p>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowModal(false)} disabled={submitting}>
                  {t('common.cancel')}
                </button>
                <button type="submit" className="btn-submit" disabled={submitting}>
                  {submitting ? t('common.processing') : t('common.create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteId && (
        <div className="modal-overlay admin-dialog-overlay" onClick={() => !submitting && setDeleteId(null)}>
          <div className="modal-content admin-users-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{t('adminUsers.deleteConfirmTitle')}</h2>
            <p className="delete-confirm-text">{t('adminUsers.deleteConfirm')}</p>
            <div className="modal-actions">
              <button type="button" className="btn-cancel" onClick={() => setDeleteId(null)} disabled={submitting}>
                {t('common.cancel')}
              </button>
              <button type="button" className="btn-danger" onClick={confirmDelete} disabled={submitting}>
                {submitting ? t('common.processing') : t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminUsers;
