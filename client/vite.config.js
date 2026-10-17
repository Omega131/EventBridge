import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5173,
    // WHAT: Proxy configuration for local development.
    // WHY: When the browser on port 5173 sends requests starting with /api (e.g. fetch('/api/events')),
    // Vite forwards them directly to our Express server running on http://localhost:3000.
    // This avoids Cross-Origin (CORS) issues and allows httpOnly cookies to be sent seamlessly.
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
