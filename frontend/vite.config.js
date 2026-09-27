import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// In development the API runs on :8000; Vite forwards /api and /ws to it,
// so the browser only ever talks to one origin (no CORS issues, phones on
// the same Wi-Fi can open http://<laptop-ip>:5173).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    allowedHosts: true, // lets a Cloudflare/ngrok tunnel URL reach the dev server
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8000',
      '/ws': { target: 'ws://localhost:8000', ws: true },
    },
  },
})
