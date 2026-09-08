import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  getContactSubmissions, 
  updateSubmissionStatus, 
  ContactSubmission 
} from '../services/apiService';
import './ContactSubmissions.css';

const ContactSubmissions: React.FC = () => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'ar' ? 'ar-SA' : 'en-US';

  const [submissions, setSubmissions] = useState<ContactSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'new' | 'read' | 'resolved'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadSubmissions = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const data = await getContactSubmissions(statusFilter);
      setSubmissions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('contact.failedToLoad'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, t]);

  useEffect(() => {
    loadSubmissions();
  }, [loadSubmissions]);

  const handleStatusChange = async (id: string, newStatus: string) => {
    try {
      await updateSubmissionStatus(id, newStatus);
      await loadSubmissions();
    } catch {
      alert(t('contact.failedToUpdate'));
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
    const submission = submissions.find(s => s.id === id);
    if (submission?.status === 'new' && expandedId !== id) {
      handleStatusChange(id, 'read');
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(locale, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading && submissions.length === 0) {
    return (
      <div className="loading">
        <div className="spinner"></div>
        <p>{t('contact.loading')}</p>
      </div>
    );
  }

  return (
    <div className="contact-submissions">
      <div className="admin-view-header">
        <h1>{t('contact.title')}</h1>
        <div className="filter-bar">
          <label>{t('contact.filterStatus')}</label>
          <select 
            value={statusFilter} 
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'new' | 'read' | 'resolved')}
            className="filter-select"
          >
            <option value="all">{t('contact.allSubmissions')}</option>
            <option value="new">{t('contact.statusNew')}</option>
            <option value="read">{t('contact.statusRead')}</option>
            <option value="resolved">{t('contact.statusResolved')}</option>
          </select>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="submissions-list">
        {submissions.length === 0 ? (
          <div className="no-data-card">
            {t('contact.noFound')}
          </div>
        ) : (
          submissions.map((sub) => (
            <div 
              key={sub.id} 
              className={`submission-card ${sub.status} ${expandedId === sub.id ? 'expanded' : ''}`}
              onClick={() => toggleExpand(sub.id)}
            >
              <div className="submission-summary">
                <div className="sub-header">
                  <span className={`status-badge ${sub.status}`}>{sub.status}</span>
                  <span className="sub-date">{formatDate(sub.created_at)}</span>
                </div>
                <div className="sub-info">
                  <h3>{sub.subject}</h3>
                  <p className="sub-meta">
                    {t('contact.from')} <strong>{sub.name}</strong> ({sub.email}) 
                    {sub.phone_number && <span className="sub-phone" dir="ltr"> • {sub.phone_number}</span>}
                  </p>
                </div>
                <div className="sub-actions">
                  <button className="btn-expand">
                    {expandedId === sub.id ? t('contact.close') : t('contact.viewMessage')}
                  </button>
                </div>
              </div>

              {expandedId === sub.id && (
                <div className="submission-detail" onClick={(e) => e.stopPropagation()}>
                  <div className="contact-detail-grid">
                    <div className="contact-detail-item">
                      <label>{t('contact.contactInfo')}</label>
                      <p>
                        <strong>{sub.name}</strong><br />
                        {sub.email}<br />
                        {sub.phone_number ? <strong dir="ltr">{sub.phone_number}</strong> : <em>{t('contact.noPhone')}</em>}
                      </p>
                    </div>
                    <div className="message-content">
                      <label>{t('contact.message')}</label>
                      <p>{sub.message}</p>
                    </div>
                  </div>
                  <div className="contact-detail-footer">
                    <label>{t('contact.updateStatus')}</label>
                    <div className="status-buttons">
                      <button 
                        className={`btn-status read ${sub.status === 'read' ? 'active' : ''}`}
                        onClick={() => handleStatusChange(sub.id, 'read')}
                      >
                        {t('contact.markAsRead')}
                      </button>
                      <button 
                        className={`btn-status resolved ${sub.status === 'resolved' ? 'active' : ''}`}
                        onClick={() => handleStatusChange(sub.id, 'resolved')}
                      >
                        {t('contact.markResolved')}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default ContactSubmissions;
