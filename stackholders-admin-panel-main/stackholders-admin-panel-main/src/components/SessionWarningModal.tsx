import React from 'react';
import { useTranslation } from 'react-i18next';
import { AdminDialogPortal } from './AdminDialogPortal';
import './SessionWarning.css';

interface SessionWarningModalProps {
  /** Whole seconds until the session ends. */
  secondsRemaining: number;
  /** True when the 12-hour cap is what's expiring -- staying signed in is not an option. */
  absolute: boolean;
  onStaySignedIn: () => void;
  onSignOutNow: () => void;
}

const formatCountdown = (totalSeconds: number): string => {
  const safe = Math.max(0, totalSeconds);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

/**
 * Shown a couple of minutes before the session policy signs the admin out, so a
 * long-running edit is never lost without warning.
 */
const SessionWarningModal: React.FC<SessionWarningModalProps> = ({
  secondsRemaining,
  absolute,
  onStaySignedIn,
  onSignOutNow,
}) => {
  const { t } = useTranslation();

  return (
    <AdminDialogPortal>
      <div className="session-warning-overlay" role="presentation">
        <div
          className="session-warning-modal"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="session-warning-title"
          aria-describedby="session-warning-body"
        >
          <h2 id="session-warning-title" className="session-warning-title">
            {t('session.warningTitle')}
          </h2>

          <p id="session-warning-body" className="session-warning-body">
            {absolute ? t('session.warningBodyAbsolute') : t('session.warningBodyIdle')}
          </p>

          <p className="session-warning-countdown" aria-live="polite">
            {formatCountdown(secondsRemaining)}
          </p>

          <div className="session-warning-actions">
            <button type="button" className="session-warning-btn-secondary" onClick={onSignOutNow}>
              {t('session.signOutNow')}
            </button>
            {!absolute && (
              <button type="button" className="session-warning-btn-primary" onClick={onStaySignedIn} autoFocus>
                {t('session.staySignedIn')}
              </button>
            )}
          </div>
        </div>
      </div>
    </AdminDialogPortal>
  );
};

export default SessionWarningModal;
