/**
 * Supabase client configuration for Admin Dashboard
 * Frontend client for authentication and database operations
 */

import { createClient, SupabaseClient, SupabaseClientOptions } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

/**
 * Storage slot for the admin session.
 *
 * Deliberately NOT the supabase-js default (`sb-<ref>-auth-token`): the
 * stockholder portal talks to the same Supabase project and would otherwise
 * share this slot on any shared origin, letting one app's session be picked up
 * by the other. Changing this key also has the useful side effect of orphaning
 * every session issued before this release, forcing a clean re-login.
 */
export const ADMIN_AUTH_STORAGE_KEY = 'jtgc-admin-auth';

/**
 * Session lifetime is enforced in three places, and all three are required:
 *   1. `sessionPolicy` in the browser  - 60 min idle / 12 h absolute, with a warning.
 *   2. `public.is_portal_admin()` in Postgres - the same windows, but authoritative;
 *      a stolen refresh token cannot talk its way past it.
 *   3. this client - explicit options rather than inherited defaults.
 *
 * Project-wide Supabase Auth session settings are intentionally left alone: they
 * would also apply to the stockholder portal and the shipped Flutter app, which
 * expect long-lived sessions and have no auth-state listeners to recover with.
 */
const AUTH_OPTIONS: SupabaseClientOptions<'public'>['auth'] = {
  // Survive a tab close, within the idle/absolute windows enforced above.
  persistSession: true,
  storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  storageKey: ADMIN_AUTH_STORAGE_KEY,
  autoRefreshToken: true,
  // This SPA has no OAuth/magic-link callback; leaving this on only invites
  // the client to try parsing tokens out of arbitrary URL fragments.
  detectSessionInUrl: false,
};

// Validate environment variables in production
if (import.meta.env.PROD) {
  if (!SUPABASE_URL) {
    throw new Error('VITE_SUPABASE_URL is required in production');
  }
  if (!SUPABASE_ANON_KEY && !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error('VITE_SUPABASE_ANON_KEY or VITE_SUPABASE_PUBLISHABLE_KEY is required in production');
  }
}

/**
 * Supabase client for authentication and database operations
 * Uses publishable key (new format) or anon key (legacy)
 */
export const supabaseClient: SupabaseClient = (() => {
  if (!SUPABASE_URL) {
    const errorMsg = 
      'VITE_SUPABASE_URL is not set. Please create a .env file in the root directory with:\n' +
      'VITE_SUPABASE_URL=your_supabase_project_url\n' +
      'VITE_SUPABASE_ANON_KEY=your_supabase_anon_key';
    
    if (import.meta.env.DEV) {
      console.error('❌ Configuration Error:', errorMsg);
      // Still create client but it will fail with clear error on use
      return createClient('https://placeholder.supabase.co', 'placeholder-key', { auth: AUTH_OPTIONS });
    }
    throw new Error(errorMsg);
  }

  const key = SUPABASE_PUBLISHABLE_KEY || SUPABASE_ANON_KEY;
  if (!key) {
    const errorMsg = 
      'VITE_SUPABASE_ANON_KEY or VITE_SUPABASE_PUBLISHABLE_KEY is not set.\n' +
      'Please add one of these to your .env file:\n' +
      'VITE_SUPABASE_ANON_KEY=your_supabase_anon_key\n' +
      'or\n' +
      'VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key';
    
    if (import.meta.env.DEV) {
      console.error('❌ Configuration Error:', errorMsg);
      // Still create client but it will fail with clear error on use
      return createClient(SUPABASE_URL, 'placeholder-key', { auth: AUTH_OPTIONS });
    }
    throw new Error(errorMsg);
  }

  return createClient(SUPABASE_URL, key, { auth: AUTH_OPTIONS });
})();

/**
 * A throwaway client that shares no storage with the signed-in session.
 *
 * `signInWithPassword` on the main client replaces the live session, which
 * silently resets the absolute-lifetime clock. Password re-verification needs a
 * sign-in that leaves the real session untouched -- see `changeOwnPassword`.
 */
export const createScratchClient = (): SupabaseClient =>
  createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY || SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

