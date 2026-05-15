import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // hls.js is only reached via a dynamic import() in FeedVideo / useVideoEngine
  // when a `.m3u8` URL is encountered. Vite's optimizer doesn't statically
  // discover it from those code paths, so we hint it explicitly — otherwise
  // the dynamic import throws "Failed to resolve module specifier 'hls.js'"
  // the first time PornHub (HLS-only as of 2026-05-14) is encountered.
  optimizeDeps: {
    include: ['hls.js'],
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      }
    }
  },
  build: {
    // hls.js lazy chunk is 523kB -- expected, unavoidable, only loaded on HLS playback
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          // Split large vendor libs into their own chunks
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-zustand': ['zustand'],
          // hls.js is loaded dynamically (only when HLS stream is played)
        }
      }
    }
  }
})
