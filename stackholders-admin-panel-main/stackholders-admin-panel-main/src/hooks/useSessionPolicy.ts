/**
 * React binding for `services/sessionPolicy`.
 *
 * Deliberately polls on a short interval and re-checks on `focus` /
 * `visibilitychange` rather than arming one long `setTimeout`. Browsers throttle
 * (and on mobile, suspend) timers in background tabs, so a 60-minute timeout can
 * simply fail to fire -- which is the exact "closed the tab, came back later,
 * still logged in" case this whole change exists to fix.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ensureMarks,
  evaluateSession,
  isExpired,
  markActivity,
  WARN_BEFORE_MS,
  type ExpiredStatus,
  type SessionStatus,
} from '../services/sessionPolicy';

const POLL_INTERVAL_MS = 5_000;
/** Don't hammer localStorage on every mousemove. */
const ACTIVITY_WRITE_THROTTLE_MS = 10_000;

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'] as const;

interface UseSessionPolicyOptions {
  enabled: boolean;
  onExpire: (reason: ExpiredStatus) => void;
}

interface UseSessionPolicyResult {
  status: SessionStatus;
  /** Whole seconds left before sign-out; drives the countdown in the warning modal. */
  secondsRemaining: number;
  /**
   * True when the 12-hour cap is the binding limit. Staying signed in cannot
   * help, so the warning must not offer it.
   */
  absoluteExpiryImminent: boolean;
  /** "Stay signed in" - only meaningful for an idle warning. */
  extend: () => void;
}

export const useSessionPolicy = ({
  enabled,
  onExpire,
}: UseSessionPolicyOptions): UseSessionPolicyResult => {
  const [status, setStatus] = useState<SessionStatus>('active');
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [absoluteExpiryImminent, setAbsoluteExpiryImminent] = useState(false);

  const lastWriteRef = useRef(0);
  const expiredRef = useRef(false);
  const statusRef = useRef<SessionStatus>('active');
  // Keep the latest callback without re-arming listeners on every render.
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  const check = useCallback(() => {
    const { status: next, msRemaining, msUntilIdle, msUntilAbsolute } = evaluateSession();

    statusRef.current = next;
    setStatus(next);
    setSecondsRemaining(
      Number.isFinite(msRemaining) ? Math.max(0, Math.ceil(msRemaining / 1000)) : 0,
    );
    setAbsoluteExpiryImminent(msUntilAbsolute <= msUntilIdle);

    if (isExpired(next) && !expiredRef.current) {
      expiredRef.current = true;
      onExpireRef.current(next);
    }
  }, []);

  const extend = useCallback(() => {
    if (expiredRef.current) return;
    markActivity();
    check();
  }, [check]);

  useEffect(() => {
    if (!enabled) {
      expiredRef.current = false;
      statusRef.current = 'active';
      setStatus('active');
      return;
    }

    ensureMarks();
    check();

    const handleActivity = () => {
      // Once the warning is up, require an explicit "Stay signed in". Otherwise
      // the mouse movement toward the button would silently dismiss it and the
      // admin would never learn the session was about to end.
      if (statusRef.current === 'warning' || expiredRef.current) return;

      const now = Date.now();
      if (now - lastWriteRef.current < ACTIVITY_WRITE_THROTTLE_MS) return;
      lastWriteRef.current = now;
      markActivity(now);
    };

    // Re-check the moment the tab is looked at again -- this is what catches the
    // laptop that was closed for two hours.
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') check();
    };

    ACTIVITY_EVENTS.forEach((event) =>
      document.addEventListener(event, handleActivity, { capture: true, passive: true }),
    );
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', handleVisibility);

    const interval = window.setInterval(check, POLL_INTERVAL_MS);

    return () => {
      ACTIVITY_EVENTS.forEach((event) =>
        document.removeEventListener(event, handleActivity, { capture: true }),
      );
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.clearInterval(interval);
    };
  }, [enabled, check]);

  return { status, secondsRemaining, absoluteExpiryImminent, extend };
};

export { WARN_BEFORE_MS };
