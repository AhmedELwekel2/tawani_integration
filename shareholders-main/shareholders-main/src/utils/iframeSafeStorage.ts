/**
 * iframe-safe storage utility
 * Uses localStorage with fallback to memory storage for iframe compatibility
 */

import { logger } from './logger';

interface MemoryStorage {
  [key: string]: string | null;
}

class MemoryStore {
  private storage: MemoryStorage = {};

  getItem(key: string): string | null {
    return this.storage[key] || null;
  }

  setItem(key: string, value: string): void {
    this.storage[key] = value;
  }

  removeItem(key: string): void {
    delete this.storage[key];
  }

  clear(): void {
    this.storage = {};
  }
}

const memoryStorage = new MemoryStore();

/**
 * Safe storage that works in iframes
 * Tries localStorage first, falls back to memory storage
 */
export const iframeSafeStorage = {
  getItem: (key: string): string | null => {
    try {
      return localStorage.getItem(key);
    } catch {
      logger.warn('localStorage not available, using memory storage');
      return memoryStorage.getItem(key);
    }
  },

  setItem: (key: string, value: string): void => {
    try {
      localStorage.setItem(key, value);
    } catch {
      logger.warn('localStorage not available, using memory storage');
      memoryStorage.setItem(key, value);
    }
  },

  removeItem: (key: string): void => {
    try {
      localStorage.removeItem(key);
    } catch {
      logger.warn('localStorage not available, using memory storage');
      memoryStorage.removeItem(key);
    }
  },

  clear: (): void => {
    try {
      localStorage.clear();
    } catch {
      logger.warn('localStorage not available, using memory storage');
      memoryStorage.clear();
    }
  },
};

// Storage keys
export const STORAGE_KEYS = {
  SUPABASE_SESSION: 'supabase_session',
  SUPABASE_ACCESS_TOKEN: 'supabase_access_token',
} as const;

