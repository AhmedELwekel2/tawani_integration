import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminLogin, NOT_AUTHORIZED } from '../services/authService';
import { getFriendlyError } from '../utils/errorHelpers';
import LanguageSwitcher from './LanguageSwitcher';
import './Login.css';

interface LoginProps {
  onLogin: () => void;
  /** True when the previous session was ended by the session policy. */
  sessionExpired?: boolean;
  onDismissSessionNotice?: () => void;
}

const Login: React.FC<LoginProps> = ({ onLogin, sessionExpired, onDismissSessionNotice }) => {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    onDismissSessionNotice?.();
    setLoading(true);

    try {
      await adminLogin(email, password);
      onLogin();
    } catch (err) {
      // Stay vague: someone probing the admin panel with a stockholder account
      // shouldn't be able to tell "wrong password" from "not an admin".
      if (err instanceof Error && err.message === NOT_AUTHORIZED) {
        setError(t('login.notAuthorized'));
      } else {
        setError(getFriendlyError(err, t, 'login.error'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-logo-container">
          <img src="/favicon.png" alt="Stackholders Logo" className="login-logo" />
        </div>
        
        <h1 className="login-title">{t('login.title')}</h1>

        {sessionExpired && !error && (
          <div className="login-notice" role="status">
            {t('session.expiredNotice')}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">{t('login.email')}</label>
            <input
              id="email"
              name="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('login.emailPlaceholder')}
              autoComplete="email"
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="password">{t('login.password')}</label>
            <input
              id="password"
              name="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('login.passwordPlaceholder')}
              autoComplete="current-password"
              required
            />
          </div>
          {error && <div className="error-message">{error}</div>}
          <button type="submit" disabled={loading} className="login-button">
            {loading ? t('login.submitLoading') : t('login.submit')}
          </button>
        </form>

        <div className="login-lang-container">
          <LanguageSwitcher />
        </div>
      </div>
    </div>
  );
};

export default Login;

