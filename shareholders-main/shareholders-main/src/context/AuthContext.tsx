/**
 * Authentication Context
 * Manages Supabase session state and authentication flow
 */

import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { supabaseClient, setSupabaseSession, clearSupabaseSession, getAccessToken } from '../services/supabaseClient';
import {
  loginWithNationalId,
  getCurrentStockholder,
  getSessionNationalId,
  getSessionRole,
  PortalRole,
  Stockholder,
  sendOtp as stockholderServiceSendOtp,
} from '../services/stockholderService';
import { useSessionTimeout } from '../hooks/useSessionTimeout';
import { SessionTimeoutModal } from '../components/SessionTimeoutModal';
import { logger } from '../utils/logger';
import { useTranslation } from 'react-i18next';
import { translateError } from '../utils/errorUtils';

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  isActionLoading: boolean;
  user: { id: string; national_id: string } | null;
  /**
   * Which kind of portal user this is. A subscriber has no shareholding, so
   * `stockholder` stays null for them and the shareholding views are hidden.
   */
  role: PortalRole;
  /** Set only for a subscriber; their row id, for attributing feedback. */
  subscriberId: string | null;
  stockholder: Stockholder | null;
  login: (nationalId: string, otpCode: string) => Promise<void>;
  sendOtp: (nationalId: string, lang: string) => Promise<{ message: string; hint: string; verify_method: string }>;
  logout: () => void;
  refreshStockholder: () => Promise<void>;
  error: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const { t } = useTranslation();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isActionLoading, setIsActionLoading] = useState<boolean>(false);
  const [user, setUser] = useState<{ id: string; national_id: string } | null>(null);
  const [role, setRole] = useState<PortalRole>('shareholder');
  const [subscriberId, setSubscriberId] = useState<string | null>(null);
  const [stockholder, setStockholder] = useState<Stockholder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTimeoutWarning, setShowTimeoutWarning] = useState<boolean>(false);
  const [timeoutRemainingSeconds, setTimeoutRemainingSeconds] = useState<number>(0);

  /**
   * Fetch stockholder data directly from Supabase
   */
  const fetchStockholder = useCallback(async (retries = 3, delay = 500): Promise<void> => {
    let lastError: unknown;
    for (let i = 0; i < retries; i++) {
      try {
        const data = await getCurrentStockholder();
        setStockholder(data);
        setError(null);
        return; // Success!
      } catch (err) {
        lastError = err;
        logger.warn(`Fetch stockholder attempt ${i + 1} failed:`, err);
        if (i < retries - 1) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    // All retries failed
    logger.error('Failed to fetch stockholder after all retries:', lastError);
    const isDevelopment = import.meta.env.DEV;
    const errorMessage = lastError instanceof Error ? lastError.message : 'Unable to load your information. Please try again.';
    setError(translateError(isDevelopment ? errorMessage : 'Unable to load your information. Please try again.', t));
  }, [t]);

  /**
   * Check if user has valid session
   */
  const checkSession = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);

      const token = getAccessToken();
      if (!token) {
        // Check if Supabase has a session from storage
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) {
          setIsAuthenticated(false);
          setIsLoading(false);
          return;
        }
      }

      // Get current user (Supabase will use token from storage)
      const { data: { user: supabaseUser }, error: userError } = await supabaseClient.auth.getUser();

      if (userError || !supabaseUser) {
        clearSupabaseSession();
        setIsAuthenticated(false);
        setIsLoading(false);
        return;
      }

      // Set user and fetch stockholder data
      setUser({
        id: supabaseUser.id,
        national_id: getSessionNationalId(supabaseUser) || '',
      });

      // A subscriber has no row in `stockholders`, so fetching one would fail
      // for a perfectly valid session. Read the role first and skip the fetch.
      const sessionRole = getSessionRole(supabaseUser);
      setRole(sessionRole);
      if (sessionRole === 'shareholder') {
        setSubscriberId(null);
        await fetchStockholder();
      } else {
        const id = supabaseUser.app_metadata?.subscriber_id;
        setSubscriberId(typeof id === 'string' ? id : null);
        setStockholder(null);
      }

      setIsAuthenticated(true);
    } catch (err) {
      logger.error('Session check failed:', err);
      clearSupabaseSession();
      setIsAuthenticated(false);
      // Don't expose internal error details in production
      const isDevelopment = import.meta.env.DEV;
      setError(translateError(isDevelopment && err instanceof Error ? err.message : 'Session expired. Please log in again.', t));
    } finally {
      setIsLoading(false);
    }
  }, [fetchStockholder, t]);

  /**
   * Check existing session on mount
   */
  useEffect(() => {
    checkSession();
  }, [checkSession]);

  /**
   * Login with National ID
   */
  const login = async (nationalId: string, otpCode: string): Promise<void> => {
    try {
      setIsActionLoading(true);
      setError(null);

      // Authenticate via Supabase Edge Function
      const response = await loginWithNationalId(nationalId, otpCode);

      // Store session
      await setSupabaseSession(response.access_token, response.refresh_token);

      // Update state
      setUser(response.user);

      // The edge function reports which directory the national ID came from.
      const loginRole: PortalRole = response.user?.role === 'subscriber' ? 'subscriber' : 'shareholder';
      setRole(loginRole);
      if (loginRole === 'shareholder') {
        setSubscriberId(null);
        await fetchStockholder();
      } else {
        // Read back from the freshly-set session, since the login response
        // carries the auth user id rather than the subscriber row id.
        const { data: { user: signedIn } } = await supabaseClient.auth.getUser();
        const id = signedIn?.app_metadata?.subscriber_id;
        setSubscriberId(typeof id === 'string' ? id : null);
        setStockholder(null);
      }

      // ONLY THEN transition UI
      setIsAuthenticated(true);
      setShowTimeoutWarning(false); // Clear any existing warning
      
      // Reset session timeout (will happen automatically when enabled changes, but explicit reset ensures clean state)
    } catch (err) {
      logger.error('Login failed:', err);
      // Use the service's user-friendly message directly (service handles sanitization)
      const errorMessage = err instanceof Error
        ? err.message
        : 'Login failed. Please check your National ID.';
      setError(translateError(errorMessage, t));
      throw err;
    } finally {
      setIsActionLoading(false);
    }
  };

  /**
   * Send OTP to stockholder
   */
  const sendOtp = async (nationalId: string, lang: string): Promise<{ message: string; hint: string; verify_method: string }> => {
    try {
      setIsActionLoading(true);
      setError(null);
      const response = await stockholderServiceSendOtp(nationalId, lang);
      return response;
    } catch (err) {
      logger.error('Failed to send OTP:', err);
      // Use the service's user-friendly message directly (service handles sanitization)
      const errorMessage = err instanceof Error
        ? err.message
        : 'Failed to send verification code. Please check your National ID.';
      setError(translateError(errorMessage, t));
      throw err;
    } finally {
      setIsActionLoading(false);
    }
  };

  /**
   * Logout
   */
  const logout = (): void => {
    clearSupabaseSession();
    setIsAuthenticated(false);
    setUser(null);
    setRole('shareholder');
    setSubscriberId(null);
    setStockholder(null);
    setError(null);
    setShowTimeoutWarning(false);
  };

  /**
   * Handle session timeout
   */
  const handleTimeout = (): void => {
    logout();
  };

  /**
   * Handle session timeout warning
   */
  const handleTimeoutWarning = (remainingSeconds: number): void => {
    setTimeoutRemainingSeconds(remainingSeconds);
    setShowTimeoutWarning(true);
  };

  /**
   * Session timeout hook
   */
  const sessionTimeout = useSessionTimeout({
    timeoutMinutes: 30, // 30 minutes total timeout
    warningMinutes: 5, // Show warning 5 minutes before timeout
    onTimeout: handleTimeout,
    onWarning: handleTimeoutWarning,
    enabled: isAuthenticated, // Only enable when authenticated
  });

  /**
   * Stay logged in - reset timeout
   */
  const handleStayLoggedIn = (): void => {
    setShowTimeoutWarning(false);
    sessionTimeout.resetTimeout();
  };

  /**
   * Refresh stockholder data
   */
  const refreshStockholder = async (): Promise<void> => {
    // Nothing to refresh for a subscriber, and asking would only error.
    if (role !== 'shareholder') return;
    await fetchStockholder();
  };

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        isLoading,
        isActionLoading,
        user,
        role,
        subscriberId,
        stockholder,
        login,
        sendOtp,
        logout,
        refreshStockholder,
        error,
      }}
    >
      {children}
      <SessionTimeoutModal
        isOpen={showTimeoutWarning}
        remainingSeconds={timeoutRemainingSeconds}
        onStayLoggedIn={handleStayLoggedIn}
        onLogout={logout}
      />
    </AuthContext.Provider>
  );
};

