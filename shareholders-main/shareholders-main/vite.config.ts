import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // Local dev only: route Supabase calls through the dev server.
  //
  // The auth edge functions reject any request whose Origin is not in their
  // ALLOWED_ORIGINS list, and that list is read at module scope, so localhost
  // cannot be added without redeploying them. Proxying instead keeps the
  // browser same-origin (no preflight at all) and lets the dev server present
  // the deployed origin on the way out. Set SUPABASE_PROXY_TARGET in .env.local
  // to switch this on; without it the app talks to Supabase directly as usual.
  const proxyTarget = env.SUPABASE_PROXY_TARGET
  const proxyOrigin = env.SUPABASE_PROXY_ORIGIN

  const supabaseProxy = proxyTarget
    ? Object.fromEntries(
        ['/functions/v1', '/rest/v1', '/auth/v1', '/storage/v1'].map((prefix) => [
          prefix,
          {
            target: proxyTarget,
            changeOrigin: true,
            secure: true,
            configure: (proxy: { on: (e: string, cb: (...a: never[]) => void) => void }) => {
              proxy.on('proxyReq', (proxyReq: { setHeader: (k: string, v: string) => void }) => {
                if (proxyOrigin) proxyReq.setHeader('origin', proxyOrigin)
              })
            },
          },
        ])
      )
    : undefined

  // The Tawani agent is a separate service on its own port. Proxying it under
  // /tawani keeps the browser same-origin, so the app works from any host the
  // dev server is reached on -- a LAN IP, a tunnel, or plain localhost -- and
  // needs no CORS. In production put the same path on your reverse proxy.
  const tawaniTarget = env.TAWANI_API_TARGET || 'http://127.0.0.1:8010'

  return {
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: 'dist',
    // Generate sourcemaps only for production debugging (separate file)
    sourcemap: 'hidden',
    // Optimize chunk splitting
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'supabase-vendor': ['@supabase/supabase-js'],
        },
      },
    },
    // Minify for production
    minify: 'esbuild',
    // Chunk size warning limit
    chunkSizeWarningLimit: 1000,
  },
  server: {
    port: 3000,
    proxy: {
      ...(supabaseProxy || {}),
      '/tawani': {
        target: tawaniTarget,
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/tawani/, ''),
      },
    },
  },
  // Optimize dependencies
  optimizeDeps: {
    include: ['react', 'react-dom', '@supabase/supabase-js'],
  },
  }
})

