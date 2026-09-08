import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { TFunction } from 'i18next';
import {
  getCertificatesByStockholderId,
  uploadCertificate,
  deleteCertificate,
  getTransactionsByStockholderId,
  StockCertificate,
  Transaction,
  uploadApprovalDocument,
  deleteApprovalDocument,
  getApprovalDocumentSignedUrl,
  getCertificateSignedUrl,
} from '../services/apiService';
import { supabaseClient } from '../services/supabaseClient';
import './CertificateUpload.css';

interface CertificateUploadProps {
  stockholderId: string;
}

const getTransactionLabel = (t: Transaction, tFn: TFunction, locale: string) => {
  const label = t.transaction_type === 'purchase'
    ? tFn('certificates.purchaseLabel')
    : tFn('certificates.sellLabel');

  const sharesLabel = tFn('certificates.sharesLabel');
  const formattedShares = new Intl.NumberFormat(locale).format(t.shares);
  const formattedDate = new Date(t.transaction_date).toLocaleDateString(locale);

  return `${label} — ${formattedShares} ${sharesLabel} — ${formattedDate}`;
};

const CertificateUpload: React.FC<CertificateUploadProps> = ({ stockholderId }) => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'ar' ? 'ar-SA' : 'en-US';

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [certificates, setCertificates] = useState<StockCertificate[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null); // transactionId:type
  const [error, setError] = useState<string | null>(null);

  const certInputRef = useRef<HTMLInputElement>(null);
  const approvalInputRef = useRef<HTMLInputElement>(null);
  const pendingTxId = useRef<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [txns, certs] = await Promise.all([
        getTransactionsByStockholderId(stockholderId),
        getCertificatesByStockholderId(stockholderId),
      ]);
      setTransactions(txns);
      setCertificates(certs);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('certificates.failedToLoad'));
    } finally {
      setLoading(false);
    }
  }, [stockholderId, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const triggerUploadCert = (transactionId: string) => {
    pendingTxId.current = transactionId;
    certInputRef.current?.click();
  };

  const triggerUploadApproval = (transactionId: string) => {
    pendingTxId.current = transactionId;
    approvalInputRef.current?.click();
  };

  const handleCertChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const transactionId = pendingTxId.current;
    if (!file || !transactionId) return;

    event.target.value = '';

    try {
      setUploadingFor(`${transactionId}:cert`);
      setError(null);
      const { data: { user } } = await supabaseClient.auth.getUser();
      const newCert = await uploadCertificate(stockholderId, file, user?.email ?? undefined, transactionId);

      setCertificates(prev => {
        const filtered = prev.filter(c => c.transaction_id !== transactionId);
        return [newCert, ...filtered];
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('certificates.uploadFailed'));
    } finally {
      setUploadingFor(null);
      pendingTxId.current = null;
    }
  };

  const handleApprovalChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const transactionId = pendingTxId.current;
    if (!file || !transactionId) return;

    event.target.value = '';

    try {
      setUploadingFor(`${transactionId}:approval`);
      setError(null);

      const { storagePath, name } = await uploadApprovalDocument(stockholderId, transactionId, file);

      setTransactions(prev => prev.map(tx =>
        tx.id === transactionId
          ? { ...tx, approval_document_storage_path: storagePath, approval_document_name: name }
          : tx
      ));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('certificates.uploadFailed'));
    } finally {
      setUploadingFor(null);
      pendingTxId.current = null;
    }
  };

  const handleDeleteCert = async (cert: StockCertificate) => {
    if (!window.confirm(t('certificates.deleteConfirm'))) return;
    try {
      const busyId = cert.transaction_id ? `${cert.transaction_id}:cert` : cert.id;
      setUploadingFor(busyId);
      setError(null);
      await deleteCertificate(cert.id, cert);
      setCertificates(prev => prev.filter(c => c.id !== cert.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('certificates.deleteFailed'));
    } finally {
      setUploadingFor(null);
    }
  };

  const handleDeleteApproval = async (tx: Transaction) => {
    if (!window.confirm(t('certificates.deleteConfirm'))) return;
    if (!tx.approval_document_storage_path) return;

    try {
      setUploadingFor(`${tx.id}:approval`);
      setError(null);
      await deleteApprovalDocument(tx.id, tx.approval_document_storage_path);

      setTransactions(prev => prev.map(item =>
        item.id === tx.id
          ? { ...item, approval_document_storage_path: null, approval_document_name: null }
          : item
      ));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('certificates.deleteFailed'));
    } finally {
      setUploadingFor(null);
    }
  };

  const handleOpenApproval = async (storagePath: string) => {
    try {
      const url = await getApprovalDocumentSignedUrl(storagePath);
      window.open(url, '_blank');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('certificates.failedToLoad'));
    }
  };

  /**
   * Certificates live in a private bucket, so there is no durable href to link
   * to -- mint a short-lived signed URL at click time.
   */
  const handleOpenCertificate = async (cert: StockCertificate) => {
    try {
      const url = await getCertificateSignedUrl(cert);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('certificates.failedToLoad'));
    }
  };

  if (loading) return <div className="cert-loading">{t('certificates.loading')}</div>;

  return (
    <div className="certificate-upload-card">
      <div className="card-header">
        <h3>{t('certificates.title')}</h3>
        <span className="cert-subtitle">{t('certificates.subtitle')}</span>
      </div>

      {error && <div className="cert-error">{error}</div>}

      {/* Hidden file inputs */}
      <input
        ref={certInputRef}
        type="file"
        accept=".pdf,image/*"
        style={{ display: 'none' }}
        onChange={handleCertChange}
      />
      <input
        ref={approvalInputRef}
        type="file"
        accept=".pdf,image/*"
        style={{ display: 'none' }}
        onChange={handleApprovalChange}
      />

      <div className="card-body">
        {transactions.length === 0 ? (
          <p className="cert-empty">{t('certificates.noTransactions')}</p>
        ) : (
          <table className="cert-table">
            <thead>
              <tr>
                <th>{t('certificates.transaction')}</th>
                <th>{t('certificates.certificate')}</th>
                <th>{t('certificates.approvalDoc')}</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map(tx => {
                const cert = certificates.find(c => c.transaction_id === tx.id) ?? null;
                const isCertBusy = uploadingFor === `${tx.id}:cert`;
                const isApprovalBusy = uploadingFor === `${tx.id}:approval`;

                return (
                  <tr key={tx.id}>
                    <td>{getTransactionLabel(tx, t, locale)}</td>

                    {/* Certificate Column */}
                    <td>
                      <div className="cert-column-content">
                        {cert ? (
                          <button
                            type="button"
                            className="cert-file-link-btn"
                            onClick={() => handleOpenCertificate(cert)}
                          >
                            📄 {cert.file_name}
                          </button>
                        ) : (
                          <span className="cert-none">{t('certificates.noCertificate')}</span>
                        )}
                        <div className="cert-row-actions">
                          <button
                            className="btn-upload-sm"
                            onClick={() => triggerUploadCert(tx.id)}
                            disabled={isCertBusy || isApprovalBusy}
                          >
                            {isCertBusy ? t('certificates.uploading') : cert ? t('certificates.replace') : t('certificates.upload')}
                          </button>
                          {cert && (
                            <button
                              className="btn-delete-sm"
                              onClick={() => handleDeleteCert(cert)}
                              disabled={isCertBusy || isApprovalBusy}
                            >
                              {t('certificates.delete')}
                            </button>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Approval Document Column */}
                    <td>
                      <div className="cert-column-content">
                        {tx.approval_document_storage_path ? (
                          <button
                            type="button"
                            onClick={() => handleOpenApproval(tx.approval_document_storage_path!)}
                            className="cert-file-link-btn"
                          >
                            📄 {tx.approval_document_name || t('certificates.approvalDoc')}
                          </button>
                        ) : (
                          <span className="cert-none">{t('certificates.noApprovalDoc')}</span>
                        )}
                        <div className="cert-row-actions">
                          <button
                            className="btn-upload-sm"
                            onClick={() => triggerUploadApproval(tx.id)}
                            disabled={isCertBusy || isApprovalBusy}
                          >
                            {isApprovalBusy ? t('certificates.uploading') : tx.approval_document_storage_path ? t('certificates.replace') : t('certificates.upload')}
                          </button>
                          {tx.approval_document_storage_path && (
                            <button
                              className="btn-delete-sm"
                              onClick={() => handleDeleteApproval(tx)}
                              disabled={isCertBusy || isApprovalBusy}
                            >
                              {t('certificates.delete')}
                            </button>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {/* Unlinked / Legacy Certificates */}
              {certificates.filter(c => !c.transaction_id).length > 0 && (
                <>
                  <tr className="cert-section-divider">
                    <td colSpan={3}>{t('certificates.unlinkedTitle')}</td>
                  </tr>
                  {certificates.filter(c => !c.transaction_id).map(cert => {
                    const isBusy = uploadingFor === cert.id;
                    return (
                      <tr key={cert.id} className="cert-unlinked-row">
                        <td><span className="cert-label-tag">{t('certificates.unlinkedTag')}</span></td>
                        <td>
                          <button
                            type="button"
                            className="cert-file-link-btn"
                            onClick={() => handleOpenCertificate(cert)}
                          >
                            📄 {cert.file_name}
                          </button>
                        </td>
                        <td>
                          <button
                            className="btn-delete-sm"
                            onClick={() => handleDeleteCert(cert)}
                            disabled={isBusy}
                          >
                            {isBusy ? t('certificates.deleting') : t('certificates.delete')}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default CertificateUpload;
