/**
 * Main App Component
 * Routes between Login and Dashboard based on authentication state
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Login } from './components/Login';
import { Dashboard } from './components/Dashboard';
import { LoadingScreen } from './components/ui/LoadingScreen';
import './App.css';

const SkipLink: React.FC = () => {
  const { t } = useTranslation();
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-white focus:rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
    >
      {t('app.skipToMain')}
    </a>
  );
};

const AppContent: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingScreen />;
  }

  return <>{isAuthenticated ? <Dashboard /> : <Login />}</>;
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <SkipLink />
      <AppContent />
    </AuthProvider>
  );
};

export default App;
