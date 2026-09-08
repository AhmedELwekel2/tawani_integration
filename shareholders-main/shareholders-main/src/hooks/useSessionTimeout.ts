/**
 * Session Timeout Hook
 * Tracks user inactivity and manages session timeout
 */

import { useEffect, useRef, useCallback } from 'react';

interface UseSessionTimeoutOptions {
  timeoutMinutes?: number; // Total timeout in minutes (default: 30)
  warningMinutes?: number; // Show warning before timeout (default: 5)
  onTimeout: () => void;
  onWarning?: (remainingSeconds: number) => void;
  enabled?: boolean;
}

const STORAGE_KEY = 'session_last_activity';

export const useSessionTimeout = ({
  timeoutMinutes = 30,
  warningMinutes = 5,
  onTimeout,
  onWarning,
  enabled = true,
}: UseSessionTimeoutOptions) => {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const warningTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const warningShownRef = useRef<boolean>(false);

  const resetTimeout = useCallback(() => {
    if (!enabled) return;

    // Clear existing timeouts
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    if (warningTimeoutRef.current) {
      clearTimeout(warningTimeoutRef.current);
    }

    // Reset warning flag
    warningShownRef.current = false;

    // Update last activity time in localStorage
    const now = Date.now();
    localStorage.setItem(STORAGE_KEY, now.toString());

    const timeoutMs = timeoutMinutes * 60 * 1000;
    const warningMs = warningMinutes * 60 * 1000;
    const warningTime = timeoutMs - warningMs;

    // Set warning timeout
    warningTimeoutRef.current = setTimeout(() => {
      if (onWarning) {
        warningShownRef.current = true;
        const remainingSeconds = warningMinutes * 60;
        onWarning(remainingSeconds);
      }
    }, warningTime);

    // Set main timeout
    timeoutRef.current = setTimeout(() => {
      onTimeout();
    }, timeoutMs);
  }, [timeoutMinutes, warningMinutes, onTimeout, onWarning, enabled]);

  const handleActivity = useCallback(() => {
    resetTimeout();
  }, [resetTimeout]);

  // Check if session has already expired when hook mounts or gets enabled
  useEffect(() => {
    if (!enabled) return;

    const lastActivityStr = localStorage.getItem(STORAGE_KEY);
    if (lastActivityStr) {
      const lastActivity = parseInt(lastActivityStr, 10);
      const elapsed = Date.now() - lastActivity;
      const timeoutMs = timeoutMinutes * 60 * 1000;
      
      if (elapsed > timeoutMs) {
        // Session already expired while away (e.g. closed tab)
        localStorage.removeItem(STORAGE_KEY);
        onTimeout();
        return;
      }
    } else {
      // Initialize if it doesn't exist
      localStorage.setItem(STORAGE_KEY, Date.now().toString());
    }

    resetTimeout();

    // Track user activity events
    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
    
    events.forEach((event) => {
      document.addEventListener(event, handleActivity, true);
    });

    // Cleanup
    return () => {
      events.forEach((event) => {
        document.removeEventListener(event, handleActivity, true);
      });
      
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (warningTimeoutRef.current) {
        clearTimeout(warningTimeoutRef.current);
      }
    };
  }, [enabled, resetTimeout, handleActivity, timeoutMinutes, onTimeout]);

  return {
    resetTimeout,
    getRemainingTime: () => {
      const lastActivity = parseInt(localStorage.getItem(STORAGE_KEY) || String(Date.now()), 10);
      const elapsed = Date.now() - lastActivity;
      const remaining = timeoutMinutes * 60 * 1000 - elapsed;
      return Math.max(0, Math.floor(remaining / 1000)); // Return seconds
    },
  };
};

