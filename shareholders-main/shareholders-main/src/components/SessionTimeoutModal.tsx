/**
 * Session Timeout Modal Component
 * Shows warning before session timeout
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './SessionTimeoutModal.css';

interface SessionTimeoutModalProps {
  isOpen: boolean;
  remainingSeconds: number;
  onStayLoggedIn: () => void;
  onLogout: () => void;
}

export const SessionTimeoutModal: React.FC<SessionTimeoutModalProps> = ({
  isOpen,
  remainingSeconds,
  onStayLoggedIn,
  onLogout,
}) => {
  const { t } = useTranslation();
  const [timeLeft, setTimeLeft] = useState(remainingSeconds);

  useEffect(() => {
    setTimeLeft(remainingSeconds);
  }, [remainingSeconds]);

  useEffect(() => {
    if (!isOpen) return;

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isOpen]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (!isOpen) return null;

  return (
    <div className="session-timeout-overlay">
      <div className="session-timeout-modal">
        <div className="session-timeout-icon">⏱️</div>
        <h2 className="session-timeout-title">{t('session.title')}</h2>
        <p className="session-timeout-message">
          {t('session.message')}
        </p>
        <div className="session-timeout-timer">
          {formatTime(timeLeft)}
        </div>
        <p className="session-timeout-submessage">
          {t('session.subMessage')}
        </p>
        <div className="session-timeout-actions">
          <button
            onClick={onStayLoggedIn}
            className="session-timeout-button session-timeout-button-primary"
          >
            {t('session.stayLoggedIn')}
          </button>
          <button
            onClick={onLogout}
            className="session-timeout-button session-timeout-button-secondary"
          >
            {t('session.logoutNow')}
          </button>
        </div>
      </div>
    </div>
  );
};
