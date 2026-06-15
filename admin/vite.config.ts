import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Admin SPA. In dev, /api is proxied to the backend so the browser talks to the
// same origin (no CORS, cookies flow) — set VITE_API_PROXY to the backend URL.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_');
  const proxyTarget = env.VITE_API_PROXY || 'http://localhost:3000';
  return {
    // Served under /admin so the backend can host the built SPA same-origin
    // (backend serves admin/dist at /admin; the API stays at /api/v1). In dev
    // the app is therefore at http://localhost:5180/admin/.
    base: '/admin/',
    plugins: [react()],
    server: {
      port: 5180,
      proxy: mode === 'development'
        ? { '/api': { target: proxyTarget, changeOrigin: true } }
        : undefined,
    },
  };
});
