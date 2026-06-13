import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/metaboviz/' : '/',
  plugins: [react()],
  server: {
    // Fix WebSocket connection issues
    hmr: {
      overlay: false
    }
  },
  resolve: {
    // Ensure single React instance for hooks to work correctly
    dedupe: ['react', 'react-dom']
  },
  worker: {
    format: 'es'  // Use ES modules format for workers (required for code-splitting)
  },
  optimizeDeps: {
    // Include HiGHS in pre-bundling to properly transform CJS to ESM
    include: ['highs', 'react', 'react-dom']
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Split React core
          'react-vendor': ['react', 'react-dom'],
          // Split charting library (Recharts is the largest dependency)
          'charts': ['recharts'],
          // Split icons
          'icons': ['lucide-react']
        }
      }
    }
  },
  assetsInclude: ['**/*.wasm']
})
