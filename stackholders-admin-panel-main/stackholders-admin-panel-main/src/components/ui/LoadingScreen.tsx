import React from 'react';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './LoadingScreen.css';

export const LoadingScreen: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="loading-screen" role="status" aria-live="polite">
      <motion.div
        animate={{
          scale: [1, 1.2, 1],
          opacity: [0.3, 0.5, 0.3],
          x: [0, 50, 0],
          y: [0, 30, 0],
        }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        className="loading-blob loading-blob-1"
      />
      <motion.div
        animate={{
          scale: [1, 1.3, 1],
          opacity: [0.3, 0.6, 0.3],
          x: [0, -40, 0],
          y: [0, -50, 0],
        }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
        className="loading-blob loading-blob-2"
      />

      <div className="loading-content">
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="loading-spinner-wrap"
        >
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
            className="loading-ring"
          />

          <motion.div
            animate={{ scale: [0.95, 1.05, 0.95] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
            className="loading-badge-wrap"
          >
            <div className="loading-badge">
              <Loader2 className="loading-badge-icon" style={{ animation: 'spin 1.5s linear infinite' }} />
            </div>
          </motion.div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.5 }}
          className="loading-text"
        >
          <h2 className="loading-title">{t('loading.preparingPortal')}</h2>
          <div className="loading-subtitle-row">
            <motion.span
              animate={{ opacity: [0, 1, 0] }}
              transition={{ duration: 1.5, repeat: Infinity, times: [0, 0.2, 1] }}
              className="loading-subtitle"
            >
              {t('loading.securelyLoading')}
            </motion.span>
            <span className="loading-dots">
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  animate={{ y: [0, -3, 0] }}
                  transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.1 }}
                  className="loading-dot"
                />
              ))}
            </span>
          </div>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1 }}
        className="loading-version"
      >
        {t('loading.version')}
      </motion.div>
    </div>
  );
};
