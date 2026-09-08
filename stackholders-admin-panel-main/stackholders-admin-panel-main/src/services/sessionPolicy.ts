/**
 * Admin session lifetime policy.
 *
 * Why this exists: the Supabase client persists a session and refreshes it
 * forever. Before this module an admin could log in, close the tab, and still be
 * signed in weeks later -- a 19-day-old live session was observed in production.
 *
 * Policy: 60 minutes idle, 12 hours absolute, surviving a tab close within both
 * windows.
 *
 * This module is the *user-facing* half: it produces the warning and the tidy
 * sign-out. It is not the security boundary -- anyone holding the token could
 * skip it. `public.is_portal_admin()` enforces the same windows server-side
 * against `auth.sessions`, with a slightly wider grace (75 min) so that this
 * timer always fires first and the user gets a warning instead of a dead UI.
 *
 * Kept free of React so the rules can be unit-tested directly.
 */

export const IDLE_LIMIT_MS = 60 * 60 * 1000; // 60 minutes
export const ABSOLUTE_LIMIT_MS = 12 * 60 * 60 * 1000; // 12 hours
export const WARN_BEFORE_MS = 2 * 60 * 1000; // warn 2 minutes out

const STARTED_AT_KEY = 'jtgc-admin.session.startedAt';
const LAST_ACTIVITY_KEY = 'jtgc-admin.session.lastActivityAt';

export type SessionStatus = 'active' | 'warning' | 'expired-idle' | 'expired-absolute';

export interface SessionEvaluation {
  status: SessionStatus;
  /** ms until the idle cutoff; Infinity when there is no session on record. */
  msUntilIdle: number;
  /** ms until the absolute cutoff; Infinity when there is no session on record. */
  msUntilAbsolute: number;
  /** ms until the session ends for whichever reason comes first. */
  msRemaining: number;
}

interface SessionMarks {
  startedAt: number | null;
  lastActivityAt: number | null;
}

const readNumber = (key: string): number | null => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) ? value : null;
  } catch {
    // Private-mode / blocked storage: treat as "no marks on record".
    return null;
  }
};

const writeNumber = (key: string, value: number): void => {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* storage unavailable - the server-side window still applies */
  }
};

export const readMarks = (): SessionMarks => ({
  startedAt: readNumber(STARTED_AT_KEY),
  lastActivityAt: readNumber(LAST_ACTIVITY_KEY),
});

/** Call on a fresh login. Starts both clocks. */
export const beginSession = (now: number = Date.now()): void => {
  writeNumber(STARTED_AT_KEY, now);
  writeNumber(LAST_ACTIVITY_KEY, now);
};

/** Call on genuine user activity. Only moves the idle clock, never the absolute one. */
export const markActivity = (now: number = Date.now()): void => {
  writeNumber(LAST_ACTIVITY_KEY, now);
};

export const clearSession = (): void => {
  try {
    localStorage.removeItem(STARTED_AT_KEY);
    localStorage.removeItem(LAST_ACTIVITY_KEY);
  } catch {
    /* nothing to clear */
  }
};

/**
 * Adopt an existing session that predates this module (or whose marks were lost).
 * Treated as starting now rather than as expired, so shipping this change does
 * not eject an admin mid-task. The server-side check still bounds the real session.
 */
export const ensureMarks = (now: number = Date.now()): void => {
  const { startedAt, lastActivityAt } = readMarks();
  if (startedAt === null || lastActivityAt === null) beginSession(now);
};

/**
 * Decide where the session stands. Pure: pass `now` in tests.
 *
 * A clock that jumps backwards (NTP correction, manual change) would otherwise
 * read as "activity in the future" and extend the session indefinitely, so
 * future-dated marks are clamped to `now`.
 */
export const evaluateSession = (now: number = Date.now()): SessionEvaluation => {
  const { startedAt, lastActivityAt } = readMarks();

  if (startedAt === null || lastActivityAt === null) {
    return {
      status: 'active',
      msUntilIdle: Infinity,
      msUntilAbsolute: Infinity,
      msRemaining: Infinity,
    };
  }

  const started = Math.min(startedAt, now);
  const lastActivity = Math.min(lastActivityAt, now);

  const msUntilIdle = IDLE_LIMIT_MS - (now - lastActivity);
  const msUntilAbsolute = ABSOLUTE_LIMIT_MS - (now - started);
  const msRemaining = Math.min(msUntilIdle, msUntilAbsolute);

  let status: SessionStatus;
  if (msUntilAbsolute <= 0) status = 'expired-absolute';
  else if (msUntilIdle <= 0) status = 'expired-idle';
  else if (msRemaining <= WARN_BEFORE_MS) status = 'warning';
  else status = 'active';

  return { status, msUntilIdle, msUntilAbsolute, msRemaining };
};

export type ExpiredStatus = Extract<SessionStatus, 'expired-idle' | 'expired-absolute'>;

export const isExpired = (status: SessionStatus): status is ExpiredStatus =>
  status === 'expired-idle' || status === 'expired-absolute';
