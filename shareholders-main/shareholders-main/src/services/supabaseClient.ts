/**
 * Supabase client configuration
 * Configured for iframe usage without cookies
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { iframeSafeStorage, STORAGE_KEYS } from '../utils/iframeSafeStorage';
import { logger } from '../utils/logger';

// These should be set via environment variables
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

const isDevelopment = import.meta.env.DEV;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  logger.error('Supabase configuration missing!');
  
  // Show error in UI (only in development)
  if (isDevelopment && typeof window !== 'undefined') {
    const root = document.getElementById('root');
    if (root) {
      root.innerHTML = `
        <div style="padding: 20px; font-family: system-ui; max-width: 600px; margin: 50px auto;">
          <h1 style="color: #dc2626;">Configuration Error</h1>
          <p>Supabase environment variables are not configured.</p>
          <p>Please create a <code>.env</code> file in the project root with:</p>
          <pre style="background: #f3f4f6; padding: 15px; border-radius: 5px; overflow-x: auto;">
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key</pre>
          <p>After creating the file, restart the development server.</p>
        </div>
      `;
    }
  } else if (!isDevelopment) {
    // In production, show a user-friendly error
    if (typeof window !== 'undefined') {
      const root = document.getElementById('root');
      if (root) {
        root.innerHTML = `
          <div style="padding: 20px; font-family: system-ui; max-width: 600px; margin: 50px auto; text-align: center;">
            <h1 style="color: #dc2626;">Service Unavailable</h1>
            <p>The application is currently unavailable. Please contact support if this issue persists.</p>
          </div>
        `;
      }
    }
  }
}

/**
 * Custom storage adapter for Supabase that uses iframe-safe storage
 */
const customStorage = {
  getItem: (key: string): string | null => {
    if (key === 'sb-access-token' || key.includes('access_token')) {
      return iframeSafeStorage.getItem(STORAGE_KEYS.SUPABASE_ACCESS_TOKEN);
    }
    if (key === 'sb-refresh-token' || key.includes('refresh_token')) {
      return iframeSafeStorage.getItem('supabase_refresh_token');
    }
    return iframeSafeStorage.getItem(key);
  },
  setItem: (key: string, value: string): void => {
    if (key === 'sb-access-token' || key.includes('access_token')) {
      iframeSafeStorage.setItem(STORAGE_KEYS.SUPABASE_ACCESS_TOKEN, value);
    } else if (key === 'sb-refresh-token' || key.includes('refresh_token')) {
      iframeSafeStorage.setItem('supabase_refresh_token', value);
    } else {
      iframeSafeStorage.setItem(key, value);
    }
  },
  removeItem: (key: string): void => {
    iframeSafeStorage.removeItem(key);
  },
};

/**
 * Create Supabase client with iframe-safe configuration
 * - No cookies
 * - Custom storage adapter
 * - Auto-refresh disabled (handled by MCP server)
 */
export const supabaseClient: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: customStorage,
    autoRefreshToken: false,
    persistSession: true,
    detectSessionInUrl: false, // Important: don't detect session in URL (iframe constraint)
  },
});

/**
 * Set session manually (called after MCP authentication)
 */
export const setSupabaseSession = async (accessToken: string, refreshToken?: string): Promise<void> => {
  // Store tokens in iframe-safe storage
  iframeSafeStorage.setItem(STORAGE_KEYS.SUPABASE_ACCESS_TOKEN, accessToken);
  if (refreshToken) {
    iframeSafeStorage.setItem('supabase_refresh_token', refreshToken);
  }

  // Set session in Supabase client
  // Note: We use setSession which will validate the token
  const { error } = await supabaseClient.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken || '',
  });

  if (error) {
    logger.error('Failed to set Supabase session:', error);
    // Clear stored tokens if session setting failed
    clearSupabaseSession();
    throw error;
  }
};

/**
 * Clear session
 */
export const clearSupabaseSession = (): void => {
  iframeSafeStorage.removeItem(STORAGE_KEYS.SUPABASE_ACCESS_TOKEN);
  iframeSafeStorage.removeItem('supabase_refresh_token');
  supabaseClient.auth.signOut();
};

/**
 * Get current access token
 */
export const getAccessToken = (): string | null => {
  return iframeSafeStorage.getItem(STORAGE_KEYS.SUPABASE_ACCESS_TOKEN);
};

