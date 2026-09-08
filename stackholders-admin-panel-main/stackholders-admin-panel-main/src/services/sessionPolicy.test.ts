import { beforeEach, describe, expect, it } from 'vitest';
import {
  ABSOLUTE_LIMIT_MS,
  IDLE_LIMIT_MS,
  WARN_BEFORE_MS,
  beginSession,
  clearSession,
  ensureMarks,
  evaluateSession,
  isExpired,
  markActivity,
  readMarks,
} from './sessionPolicy';

/** Minimal localStorage stand-in; jsdom is not configured for this project. */
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

const T0 = 1_700_000_000_000; // fixed epoch; every test passes `now` explicitly

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
});

describe('evaluateSession', () => {
  it('is active with no marks on record (nothing to enforce yet)', () => {
    const { status, msRemaining } = evaluateSession(T0);
    expect(status).toBe('active');
    expect(msRemaining).toBe(Infinity);
  });

  it('is active immediately after login', () => {
    beginSession(T0);
    expect(evaluateSession(T0).status).toBe('active');
  });

  it('stays active right up to the point the warning window opens', () => {
    beginSession(T0);
    const justBeforeWarning = T0 + IDLE_LIMIT_MS - WARN_BEFORE_MS - 1;
    expect(evaluateSession(justBeforeWarning).status).toBe('active');
  });

  it('is warning (not active) in the final moments before the idle cutoff', () => {
    beginSession(T0);
    expect(evaluateSession(T0 + IDLE_LIMIT_MS - 1).status).toBe('warning');
  });

  it('expires on idle exactly at the limit', () => {
    beginSession(T0);
    expect(evaluateSession(T0 + IDLE_LIMIT_MS).status).toBe('expired-idle');
  });

  it('warns shortly before the idle cutoff', () => {
    beginSession(T0);
    const justInsideWarning = T0 + IDLE_LIMIT_MS - WARN_BEFORE_MS + 1_000;
    expect(evaluateSession(justInsideWarning).status).toBe('warning');
  });

  it('activity pushes back the idle clock but not the absolute one', () => {
    beginSession(T0);
    const later = T0 + 50 * 60 * 1000;
    markActivity(later);

    // Idle window restarts from `later`...
    expect(evaluateSession(later + IDLE_LIMIT_MS - WARN_BEFORE_MS - 1).status).toBe('active');
    // ...but the absolute cap is still measured from login.
    expect(evaluateSession(T0 + ABSOLUTE_LIMIT_MS).status).toBe('expired-absolute');
  });

  it('expires on the absolute cap even while the user is active', () => {
    beginSession(T0);
    const atCap = T0 + ABSOLUTE_LIMIT_MS;
    markActivity(atCap); // still clicking away
    expect(evaluateSession(atCap).status).toBe('expired-absolute');
  });

  it('reports absolute expiry in preference to idle when both have lapsed', () => {
    beginSession(T0);
    expect(evaluateSession(T0 + ABSOLUTE_LIMIT_MS + IDLE_LIMIT_MS).status).toBe('expired-absolute');
  });

  it('expires a session resumed after the tab was closed past the idle window', () => {
    // The reported bug, in miniature: close the tab, come back much later.
    beginSession(T0);
    const twentyDaysLater = T0 + 20 * 24 * 60 * 60 * 1000;
    expect(isExpired(evaluateSession(twentyDaysLater).status)).toBe(true);
  });

  it('clamps marks dated in the future so a backwards clock jump cannot extend the session', () => {
    beginSession(T0 + 60 * 60 * 1000); // marks written "in the future"
    // Evaluated at T0, the session must read as freshly started, not as having
    // an hour of extra credit.
    const { status, msUntilIdle } = evaluateSession(T0);
    expect(status).toBe('active');
    expect(msUntilIdle).toBe(IDLE_LIMIT_MS);
  });
});

describe('marks lifecycle', () => {
  it('ensureMarks adopts a pre-existing session rather than expiring it', () => {
    expect(readMarks().startedAt).toBeNull();
    ensureMarks(T0);
    expect(readMarks()).toEqual({ startedAt: T0, lastActivityAt: T0 });
    expect(evaluateSession(T0).status).toBe('active');
  });

  it('ensureMarks leaves existing marks untouched', () => {
    beginSession(T0);
    ensureMarks(T0 + 5 * 60 * 1000);
    expect(readMarks().startedAt).toBe(T0);
  });

  it('clearSession removes both clocks', () => {
    beginSession(T0);
    clearSession();
    expect(readMarks()).toEqual({ startedAt: null, lastActivityAt: null });
  });
});

describe('isExpired', () => {
  it('classifies each status', () => {
    expect(isExpired('active')).toBe(false);
    expect(isExpired('warning')).toBe(false);
    expect(isExpired('expired-idle')).toBe(true);
    expect(isExpired('expired-absolute')).toBe(true);
  });
});
