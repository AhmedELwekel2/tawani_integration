import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import DOMPurify from 'dompurify';
import {
  getAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  setAnnouncementPublished,
  deleteAnnouncement,
  uploadAnnouncementPdf,
  removeAnnouncementPdf,
  uploadAnnouncementCover,
  removeAnnouncementCover,
  getAnnouncementPdfSignedUrl,
  sendAnnouncementNotifications,
  Announcement,
} from '../services/apiService';
import { AdminDialogPortal } from './AdminDialogPortal';
import RichTextEditor from './RichTextEditor';
import { getFriendlyError } from '../utils/errorHelpers';
import './Announcements.css';

const sanitizeBody = (html: string): string | null => {
  const clean = DOMPurify.sanitize(html || '', { USE_PROFILES: { html: true } });
  const textOnly = clean.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
  return textOnly.length === 0 ? null : clean;
};

const emptyForm = { title_ar: '', title_en: '', body_ar: '', body_en: '' };

const Announcements: React.FC = () => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'ar' ? 'ar-SA' : 'en-US';

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<Announcement | null>(null);
  const [formData, setFormData] = useState(emptyForm);
  const [pendingPdf, setPendingPdf] = useState<File | null>(null);
  const [removeExistingPdf, setRemoveExistingPdf] = useState(false);
  const [pendingCover, setPendingCover] = useState<File | null>(null);
  const [removeExistingCover, setRemoveExistingCover] = useState(false);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const pdfInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!pendingCover) {
      setCoverPreview(null);
      return;
    }
    const url = URL.createObjectURL(pendingCover);
    setCoverPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingCover]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const data = await getAnnouncements();
      setAnnouncements(data);
    } catch (err) {
      setError(getFriendlyError(err, t, 'announcements.failedToLoad'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const formatDateTime = (dateString: string): string =>
    new Date(dateString).toLocaleString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const handleOpenForm = (row?: Announcement) => {
    if (row) {
      setEditingRow(row);
      setFormData({
        title_ar: row.title_ar,
        title_en: row.title_en,
        body_ar: row.body_ar || '',
        body_en: row.body_en || '',
      });
    } else {
      setEditingRow(null);
      setFormData(emptyForm);
    }
    setPendingPdf(null);
    setRemoveExistingPdf(false);
    setPendingCover(null);
    setRemoveExistingCover(false);
    setIsFormOpen(true);
  };

  const handleCloseForm = () => {
    setIsFormOpen(false);
    setEditingRow(null);
    setPendingPdf(null);
    setRemoveExistingPdf(false);
    setPendingCover(null);
    setRemoveExistingCover(false);
  };

  const handlePdfChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.type !== 'application/pdf') {
      setError(t('announcements.pdfOnly'));
      return;
    }
    setPendingPdf(file);
    setRemoveExistingPdf(false);
  };

  const handleCoverChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError(t('announcements.imageOnly'));
      return;
    }
    setPendingCover(file);
    setRemoveExistingCover(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title_ar.trim() || !formData.title_en.trim()) {
      setError(t('announcements.titlesRequired'));
      return;
    }
    try {
      setSubmitting(true);
      setError('');

      const payload = {
        title_ar: formData.title_ar.trim(),
        title_en: formData.title_en.trim(),
        body_ar: sanitizeBody(formData.body_ar),
        body_en: sanitizeBody(formData.body_en),
      };

      const saved = editingRow
        ? await updateAnnouncement(editingRow.id, payload)
        : await createAnnouncement(payload);

      if (removeExistingPdf && editingRow?.pdf_storage_path && !pendingPdf) {
        await removeAnnouncementPdf(saved.id, editingRow.pdf_storage_path);
      }
      if (pendingPdf) {
        await uploadAnnouncementPdf(saved.id, pendingPdf, editingRow?.pdf_storage_path ?? null);
      }

      if (removeExistingCover && editingRow?.cover_image_path && !pendingCover) {
        await removeAnnouncementCover(saved.id, editingRow.cover_image_path);
      }
      if (pendingCover) {
        await uploadAnnouncementCover(saved.id, pendingCover, editingRow?.cover_image_path ?? null);
      }

      handleCloseForm();
      await loadData();
    } catch (err) {
      setError(getFriendlyError(err, t, 'announcements.failedToSave'));
    } finally {
      setSubmitting(false);
    }
  };

  const handlePublishToggle = async (row: Announcement) => {
    try {
      setBusyId(row.id);
      setError('');
      await setAnnouncementPublished(row.id, !row.is_published);
      await loadData();
    } catch (err) {
      setError(getFriendlyError(err, t, 'announcements.failedToSave'));
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (row: Announcement) => {
    if (!window.confirm(t('announcements.deleteConfirm'))) return;
    try {
      setBusyId(row.id);
      setError('');
      await deleteAnnouncement(row.id);
      await loadData();
    } catch (err) {
      setError(getFriendlyError(err, t, 'announcements.failedToDelete'));
    } finally {
      setBusyId(null);
    }
  };

  const handlePreviewPdf = async (row: Announcement) => {
    if (!row.pdf_storage_path) return;
    try {
      const url = await getAnnouncementPdfSignedUrl(row.pdf_storage_path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(getFriendlyError(err, t, 'announcements.failedToLoad'));
    }
  };

  const handleSend = async (row: Announcement) => {
    const alreadySent = !!row.notification_sent_at;
    const message = alreadySent
      ? t('announcements.confirmResend', {
          count: row.notification_recipient_count ?? 0,
          date: formatDateTime(row.notification_sent_at!),
        })
      : t('announcements.confirmSend');
    if (!window.confirm(message)) return;

    try {
      setSendingId(row.id);
      setError('');
      setSuccess('');
      const result = await sendAnnouncementNotifications(row.id);
      setSuccess(t('announcements.sendSuccess', { count: result.sent }));
      await loadData();
    } catch (err) {
      setError(getFriendlyError(err, t, 'announcements.failedToSend'));
    } finally {
      setSendingId(null);
    }
  };

  if (loading && announcements.length === 0) {
    return (
      <div className="announcements-loading">
        <div className="spinner"></div>
        <p>{t('announcements.loading')}</p>
      </div>
    );
  }

  return (
    <div className="announcements-manager">
      <div className="announcements-manager-header">
        <div>
          <h1>{t('announcements.title')}</h1>
          <p className="subtitle">{t('announcements.subtitle')}</p>
        </div>
        <button className="btn-primary" onClick={() => handleOpenForm()}>
          {t('announcements.newButton')}
        </button>
      </div>

      {error && (
        <div className="error-banner">
          <p>{error}</p>
          <button onClick={() => setError('')} className="close-btn">×</button>
        </div>
      )}
      {success && (
        <div className="success-banner">
          <p>{success}</p>
          <button onClick={() => setSuccess('')} className="close-btn">×</button>
        </div>
      )}

      {isFormOpen && (
        <AdminDialogPortal>
          <div className="modal-overlay admin-dialog-overlay" onClick={handleCloseForm}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>{editingRow ? t('announcements.editTitle') : t('announcements.addTitle')}</h2>
                <button onClick={handleCloseForm} className="close-btn">×</button>
              </div>

              <form onSubmit={handleSubmit} className="announcement-form">
                <div className="form-group">
                  <label htmlFor="title_ar">{t('announcements.titleAr')}</label>
                  <input
                    type="text"
                    id="title_ar"
                    dir="rtl"
                    value={formData.title_ar}
                    onChange={(e) => setFormData({ ...formData, title_ar: e.target.value })}
                    required
                    autoComplete="off"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="title_en">{t('announcements.titleEn')}</label>
                  <input
                    type="text"
                    id="title_en"
                    dir="ltr"
                    value={formData.title_en}
                    onChange={(e) => setFormData({ ...formData, title_en: e.target.value })}
                    required
                    autoComplete="off"
                  />
                </div>

                <div className="form-group">
                  <label>{t('announcements.bodyAr')}</label>
                  <RichTextEditor
                    value={formData.body_ar}
                    onChange={(html) => setFormData((prev) => ({ ...prev, body_ar: html }))}
                    dir="rtl"
                  />
                </div>

                <div className="form-group">
                  <label>{t('announcements.bodyEn')}</label>
                  <RichTextEditor
                    value={formData.body_en}
                    onChange={(html) => setFormData((prev) => ({ ...prev, body_en: html }))}
                    dir="ltr"
                  />
                </div>

                <div className="form-group">
                  <label>{t('announcements.coverOptional')}</label>
                  <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={handleCoverChange}
                  />
                  <div className="ann-cover-field">
                    {(coverPreview || (editingRow?.cover_image_url && !removeExistingCover)) && (
                      <img
                        className="ann-cover-preview"
                        src={coverPreview || editingRow?.cover_image_url || ''}
                        alt=""
                      />
                    )}
                    <div className="ann-cover-actions">
                      <button type="button" className="btn-secondary" onClick={() => coverInputRef.current?.click()}>
                        {pendingCover || (editingRow?.cover_image_url && !removeExistingCover)
                          ? t('announcements.replaceCover')
                          : t('announcements.uploadCover')}
                      </button>
                      {pendingCover ? (
                        <button type="button" className="btn-sm" onClick={() => setPendingCover(null)}>
                          {t('common.cancel')}
                        </button>
                      ) : editingRow?.cover_image_url && !removeExistingCover ? (
                        <button type="button" className="btn-sm danger" onClick={() => setRemoveExistingCover(true)}>
                          {t('announcements.removeCover')}
                        </button>
                      ) : removeExistingCover ? (
                        <span className="ann-pdf-current">{t('announcements.coverWillBeRemoved')}</span>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="form-group">
                  <label>{t('announcements.pdfOptional')}</label>
                  <input
                    ref={pdfInputRef}
                    type="file"
                    accept="application/pdf"
                    style={{ display: 'none' }}
                    onChange={handlePdfChange}
                  />
                  <div className="ann-pdf-field">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => pdfInputRef.current?.click()}
                    >
                      {pendingPdf || (editingRow?.pdf_file_name && !removeExistingPdf)
                        ? t('announcements.replacePdf')
                        : t('announcements.uploadPdf')}
                    </button>

                    {pendingPdf ? (
                      <span className="ann-pdf-current">
                        📎 {pendingPdf.name}
                        <button type="button" className="btn-sm" onClick={() => setPendingPdf(null)}>
                          {t('common.cancel')}
                        </button>
                      </span>
                    ) : editingRow?.pdf_file_name && !removeExistingPdf ? (
                      <span className="ann-pdf-current">
                        📎 {editingRow.pdf_file_name}
                        <button type="button" className="btn-sm danger" onClick={() => setRemoveExistingPdf(true)}>
                          {t('announcements.removePdf')}
                        </button>
                      </span>
                    ) : removeExistingPdf ? (
                      <span className="ann-pdf-current">{t('announcements.pdfWillBeRemoved')}</span>
                    ) : (
                      <span className="ann-pdf-current">{t('common.noFileChosen')}</span>
                    )}
                  </div>
                </div>

                <div className="form-actions">
                  <button type="button" className="btn-secondary" onClick={handleCloseForm}>
                    {t('common.cancel')}
                  </button>
                  <button type="submit" className="btn-primary" disabled={submitting}>
                    {submitting ? t('common.saving') : t('common.save')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </AdminDialogPortal>
      )}

      <div className="announcements-table-container">
        {announcements.length === 0 ? (
          <div className="no-data">
            <p>{t('announcements.noRecords')}</p>
          </div>
        ) : (
          <table className="modern-table">
            <thead>
              <tr>
                <th>{t('announcements.colTitle')}</th>
                <th>{t('announcements.colStatus')}</th>
                <th>{t('announcements.colPdf')}</th>
                <th>{t('announcements.colNotification')}</th>
                <th>{t('announcements.colUpdated')}</th>
                <th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {announcements.map((row) => {
                const isBusy = busyId === row.id;
                const isSending = sendingId === row.id;
                return (
                  <tr key={row.id}>
                    <td className="ann-title-cell">
                      <div className="ann-title-with-thumb">
                        {row.cover_image_url && (
                          <img className="ann-list-thumb" src={row.cover_image_url} alt="" />
                        )}
                        <span>{i18n.language === 'ar' ? row.title_ar : row.title_en}</span>
                      </div>
                    </td>
                    <td>
                      <span className={`ann-badge ${row.is_published ? 'published' : 'draft'}`}>
                        {row.is_published ? t('announcements.published') : t('announcements.draft')}
                      </span>
                    </td>
                    <td>
                      {row.pdf_storage_path ? (
                        <button type="button" className="ann-pdf-tag btn-sm" onClick={() => handlePreviewPdf(row)}>
                          📎 {t('announcements.viewPdf')}
                        </button>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td>
                      {row.notification_sent_at ? (
                        <span className="ann-notify-status sent">
                          {t('announcements.sentStatus', {
                            count: row.notification_recipient_count ?? 0,
                            date: formatDateTime(row.notification_sent_at),
                          })}
                        </span>
                      ) : (
                        <span className="ann-notify-status">{t('announcements.notSent')}</span>
                      )}
                    </td>
                    <td className="ann-date-cell">{formatDateTime(row.updated_at || row.created_at)}</td>
                    <td>
                      <div className="ann-actions">
                        <button className="btn-sm" disabled={isBusy} onClick={() => handleOpenForm(row)}>
                          {t('common.edit')}
                        </button>
                        <button className="btn-sm" disabled={isBusy} onClick={() => handlePublishToggle(row)}>
                          {row.is_published ? t('announcements.unpublish') : t('announcements.publish')}
                        </button>
                        <button
                          className="btn-sm send"
                          disabled={!row.is_published || isSending}
                          title={!row.is_published ? t('announcements.publishFirst') : ''}
                          onClick={() => handleSend(row)}
                        >
                          {isSending ? t('announcements.sending') : t('announcements.sendNotification')}
                        </button>
                        <button className="btn-sm danger" disabled={isBusy} onClick={() => handleDelete(row)}>
                          {t('common.delete')}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default Announcements;
