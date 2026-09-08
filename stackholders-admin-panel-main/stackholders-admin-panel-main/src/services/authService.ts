/**
 * Supabase Authentication Service
 * Handles user authentication using Supabase Auth
 */

import { supabaseClient, createScratchClient } from './supabaseClient';
import type { User } from '@supabase/supabase-js';
import { logAction, AUDIT_ACTIONS } from './auditService';
import { beginSession, clearSession } from './sessionPolicy';

/** The two roles that may sign into this panel. */
export type StaffRole = 'admin' | 'editor';

interface AdminUser {
  id: string;
  email: string;
  name?: string;
  role: StaffRole;
}

/**
 * Thrown when a valid Supabase user signs in here but is not a portal admin.
 * Mapped to a deliberately vague message in the UI -- a stockholder probing the
 * admin panel should not learn whether their credentials were correct.
 */
export const NOT_AUTHORIZED = 'NOT_AUTHORIZED';

/**
 * Admin identity is the `portal_admin` claim in the JWT's app_metadata. There is
 * no admins table. The stockholder portal and the mobile app authenticate against
 * this same Supabase project, so "has a session" says nothing about whether the
 * user belongs here.
 */
const hasPortalAdminClaim = (user: User | null): boolean =>
  user?.app_metadata?.portal_admin === true;

/**
 * Which staff role a session carries, or null if it has no business here.
 *
 * An editor is deliberately NOT given `portal_admin`, so the database's
 * `is_portal_admin()` policies keep them out of shareholder tables regardless of
 * what the UI does. This function is only about which tabs to render.
 */
export const getStaffRole = (user: User | null): StaffRole | null => {
  if (hasPortalAdminClaim(user)) return 'admin';
  if (user?.app_metadata?.role === 'editor') return 'editor';
  return null;
};

/**
 * Sign in with email and password using Supabase Auth
 */
export const adminLogin = async (email: string, password: string): Promise<AdminUser> => {
  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      // Check if it's a configuration error
      if (error.message?.includes('Failed to fetch') || error.message?.includes('ERR_NAME_NOT_RESOLVED')) {
        throw new Error(
          'Cannot connect to Supabase. Please check your .env file:\n' +
          '1. Create a .env file in the root directory\n' +
          '2. Add: VITE_SUPABASE_URL=your_supabase_url\n' +
          '3. Add: VITE_SUPABASE_ANON_KEY=your_anon_key\n' +
          '4. Restart the development server'
        );
      }
      throw new Error(error.message || 'Invalid credentials');
    }

    if (!data.user) {
      throw new Error('Login failed');
    }

    // Authenticated is not authorised. Admins and editors belong here; a
    // shareholder or subscriber does not, so drop the session we just created
    // rather than let them sit on an admin-panel session at all.
    const role = getStaffRole(data.user);
    if (!role) {
      await supabaseClient.auth.signOut();
      clearSession();
      throw new Error(NOT_AUTHORIZED);
    }

    const adminUser = {
      id: data.user.id,
      email: data.user.email || email,
      name: data.user.user_metadata?.name || data.user.user_metadata?.full_name,
      role,
    };
    beginSession();
    logAction(AUDIT_ACTIONS.LOGIN, 'auth', data.user.id, { email: adminUser.email, role });
    return adminUser;
  } catch (error) {
    // Re-throw with better context if it's a network/config error
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new Error(
        'Cannot connect to Supabase. Please check:\n' +
        '1. Your .env file has VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY\n' +
        '2. The Supabase project URL is correct\n' +
        '3. You have restarted the dev server after adding .env'
      );
    }
    throw error;
  }
};



/**
 * Whether the current user may use the admin panel.
 *
 * Uses `getUser()`, not `getSession()`. `getSession()` reads localStorage and
 * will happily hand back (and silently refresh) a stale session without ever
 * asking the server -- that is precisely how a 20-day-old session kept passing
 * the old `isAuthenticated()` check. `getUser()` validates against Supabase and
 * returns the authoritative claims.
 */
export const isPortalAdmin = async (): Promise<boolean> => {
  return (await getCurrentStaffRole()) !== null;
};

/**
 * The signed-in user's staff role, server-validated, or null if they may not use
 * the panel. Drives which tabs App renders.
 */
export const getCurrentStaffRole = async (): Promise<StaffRole | null> => {
  const { data, error } = await supabaseClient.auth.getUser();
  if (error || !data.user) return null;
  return getStaffRole(data.user);
};

/**
 * Logout
 *
 * Audit first: once `signOut()` has run there is no JWT left, and the audit_log
 * INSERT policy requires one.
 */
export const adminLogout = async (): Promise<void> => {
  try {
    await logAction(AUDIT_ACTIONS.LOGOUT, 'auth');
  } catch {
    /* never block sign-out on audit */
  }
  clearSession();
  const { error } = await supabaseClient.auth.signOut();
  if (error) {
    throw new Error(error.message || 'Logout failed');
  }
};

/**
 * Sign out without the audit write, for policy-driven terminations where the
 * session may already be server-side invalid.
 */
export const forceSignOut = async (): Promise<void> => {
  clearSession();
  try {
    await supabaseClient.auth.signOut();
  } catch {
    /* the session is going away regardless */
  }
};

/**
 * Listen to auth state changes
 */
export const onAuthStateChange = (callback: (user: User | null) => void) => {
  return supabaseClient.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
};

/**
 * Change the currently signed-in admin's own password.
 * Re-authenticates with the current password first (guards against an
 * unattended session and yields a clear "wrong current password" error),
 * then updates to the new password. The session stays valid afterwards.
 */
export const changeOwnPassword = async (
  currentPassword: string,
  newPassword: string
): Promise<void> => {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user?.email) {
    throw new Error('NOT_AUTHENTICATED');
  }

  // 1. Verify the current password on a throwaway client.
  //    Signing in on the main client would mint a brand-new session and reset
  //    the 12-hour absolute clock -- an admin could then extend their session
  //    indefinitely just by re-entering their password. The scratch client
  //    persists nothing, so the live session is untouched either way.
  const scratch = createScratchClient();
  const { error: verifyError } = await scratch.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  // Don't leave the verification session alive server-side.
  await scratch.auth.signOut({ scope: 'local' }).catch(() => undefined);
  if (verifyError) {
    throw new Error('CURRENT_PASSWORD_INVALID');
  }

  // 2. Apply the new password.
  const { error: updateError } = await supabaseClient.auth.updateUser({
    password: newPassword,
  });
  if (updateError) {
    throw new Error(updateError.message || 'Failed to update password');
  }

  logAction(AUDIT_ACTIONS.CHANGE_PASSWORD, 'auth', user.id, { email: user.email });
};

