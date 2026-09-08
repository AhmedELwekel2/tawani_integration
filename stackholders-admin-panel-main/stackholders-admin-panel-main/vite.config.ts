import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    visualizer({
      open: false,
      filename: 'dist/stats.html',
      gzipSize: true,
      brotliSize: true,
    }),
  ],
  build: {
    outDir: 'dist',
    sourcemap: false, // Disable sourcemaps in production for security
    minify: 'esbuild',
    chunkSizeWarningLimit: 1000,
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom')) return 'vendor';
            if (id.includes('@supabase/supabase-js')) return 'supabase';
            if (id.includes('recharts')) return 'charts';
            if (id.includes('react-phone-number-input') || id.includes('libphonenumber-js')) return 'phone';
          }
        },
      },
    },
  },
  server: {
    port: 3001,
    strictPort: true,
    // Same-origin bridge to the Tawani agent -- see the portal's config.
    proxy: {
      '/tawani': {
        target: process.env.TAWANI_API_TARGET || 'http://127.0.0.1:8010',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/tawani/, ''),
      },
    },
  },
  preview: {
    port: 4173,
  },
})

