import React, { useEffect, useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { getStockCertificates, StockCertificate as ICertificate, getAllTransactionHistory, Transaction } from '../services/stockholderService';
import { motion } from 'framer-motion';
import { Award, Download, ExternalLink, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { translateError } from '../utils/errorUtils';
import './StockCertificate.css';


const isImageUrl = (url: string) => /\.(png|jpe?g|gif|webp|svg|bmp)(\?.*)?$/i.test(url);
const isPdfUrl = (url: string) => /\.pdf(\?.*)?$/i.test(url);

const TransactionLabel: React.FC<{ cert: ICertificate; transactions: Transaction[] }> = ({ cert, transactions }) => {
  const { t } = useTranslation();
  const tx = transactions.find(t => t.id === cert.transaction_id);
  if (!tx) return <span className="cert-tx-label">{t('certificate.generalCert')}</span>;
  const typeMap: Record<string, string> = {
    purchase: t('certificate.purchase'),
    sell: t('certificate.sell'),
  };
  return (
    <span className="cert-tx-label">
      {typeMap[tx.transaction_type] || tx.transaction_type}
      {' — '}
      {new Intl.NumberFormat().format(tx.shares)} {t('certificate.shares')}
      {' — '}
      {new Date(tx.transaction_date).toLocaleDateString()}
    </span>
  );
};

const StockCertificateComponent: React.FC = () => {
  const { t } = useTranslation();
  const [certificates, setCertificates] = useState<ICertificate[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const [certs, txns] = await Promise.all([
          getStockCertificates(),
          getAllTransactionHistory(),
        ]);
        setCertificates(certs);
        setTransactions(txns);
      } catch (err) {
        setError(translateError(err instanceof Error ? err.message : t('certificate.failedToLoad'), t));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [t]);

  if (loading) {
    return (
      <div className="cert-loading-state">
        <Loader2 className="w-10 h-10 text-primary animate-spin" />
        <p>{t('certificate.loading')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="cert-error-state">
        <AlertCircle className="w-10 h-10 text-rose-500" />
        <p>{error}</p>
        <Button onClick={() => window.location.reload()} variant="outline">{t('certificate.tryAgain')}</Button>
      </div>
    );
  }

  if (certificates.length === 0) {
    return (
      <div className="cert-empty-state">
        <div className="cert-empty-icon">
          <Award className="w-12 h-12 text-primary/30" />
        </div>
        <h3>{t('certificate.noCerts')}</h3>
        <p>{t('certificate.noCertsDesc')}</p>
      </div>
    );
  }

  return (
    <div className="cert-list-container">
      {certificates.map((cert, idx) => (
        <motion.div
          key={cert.id}
          className="cert-card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: idx * 0.08 }}
        >
          <div className="cert-card-header">
            <div className="cert-card-meta">
              <Award className="w-5 h-5 text-primary flex-shrink-0" />
              <TransactionLabel cert={cert} transactions={transactions} />
            </div>
            <span className="cert-card-date">
              {new Date(cert.uploaded_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
            </span>
          </div>

          <div className="cert-file-preview">
            {isImageUrl(cert.file_url) ? (
              <img
                src={cert.file_url}
                alt={cert.file_name}
                className="cert-img-preview"
              />
            ) : isPdfUrl(cert.file_url) ? (
              <iframe
                src={`${cert.file_url}#toolbar=0&navpanes=0&scrollbar=0&view=Fit`}
                title={cert.file_name}
                className="cert-pdf-preview"
              />
            ) : (
              <div className="cert-file-icon-box">
                <span className="cert-file-icon">📄</span>
                <span>{cert.file_name}</span>
              </div>
            )}
          </div>

          <div className="cert-card-actions">
            <a href={cert.file_url} target="_blank" rel="noopener noreferrer" className="no-underline">
              <Button variant="outline" size="sm" className="rounded-full border-primary/20 hover:bg-primary/5 hover:text-primary">
                <ExternalLink className="w-3.5 h-3.5 me-1.5" /> {t('certificate.view')}
              </Button>
            </a>
            <a href={`${cert.file_url}?download=`} download={cert.file_name} className="no-underline">
              <Button size="sm" className="rounded-full bg-primary hover:bg-primary/90 text-white shadow-sm shadow-primary/20">
                <Download className="w-3.5 h-3.5 me-1.5" /> {t('certificate.download')}
              </Button>
            </a>
          </div>
        </motion.div>
      ))}
    </div>
  );
};

export const StockCertificate = memo(StockCertificateComponent);
