/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  // Legacy keys (still supported)
  readonly VITE_SUPABASE_ANON_KEY?: string
  // New publishable key format (sb_publishable_xxx)
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

