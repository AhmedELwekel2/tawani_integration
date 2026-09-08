/**
 * Production-safe logging utility
 * Only logs in development mode to avoid exposing sensitive information in production
 */

const isDevelopment = import.meta.env.DEV;

export const logger = {
  error: (...args: unknown[]): void => {
    if (isDevelopment) {
      console.error(...args);
    }
    // In production, you could send errors to an error tracking service
    // Example: Sentry, LogRocket, etc.
  },

  warn: (...args: unknown[]): void => {
    if (isDevelopment) {
      console.warn(...args);
    }
  },

  log: (...args: unknown[]): void => {
    if (isDevelopment) {
      console.log(...args);
    }
  },

  info: (...args: unknown[]): void => {
    if (isDevelopment) {
      console.info(...args);
    }
  },

  debug: (...args: unknown[]): void => {
    if (isDevelopment) {
      console.debug(...args);
    }
  },
};

