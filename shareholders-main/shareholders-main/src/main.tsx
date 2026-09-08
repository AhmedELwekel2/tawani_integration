/**
 * Application Entry Point
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import './i18n';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { logger } from './utils/logger';
import './App.css';
import './assets/fonts/fonts.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found. Make sure there is a <div id="root"></div> in your HTML.');
}

try {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
} catch (error) {
  logger.error('Failed to render app:', error);
  const isDevelopment = import.meta.env.DEV;
  rootElement.innerHTML = `
    <div style="padding: 20px; font-family: system-ui; max-width: 600px; margin: 50px auto; text-align: center;">
      <h1 style="color: #dc2626;">Application Error</h1>
      <p>${isDevelopment ? 'Failed to start the application. Please check the browser console for details.' : 'The application failed to start. Please refresh the page or contact support.'}</p>
      ${isDevelopment && error instanceof Error ? `<pre style="background: #f3f4f6; padding: 15px; border-radius: 5px; overflow-x: auto; color: #dc2626; text-align: left; margin-top: 20px;">${error.message}</pre>` : ''}
    </div>
  `;
}

