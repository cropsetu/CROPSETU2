import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Kendra portal SPA. In dev, /api is proxied to the backend so the browser talks
// to the same origin (no CORS, cookies flow) — set VITE_API_PROXY to the backend URL.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_');
  // The CropSetu backend dev server listens on :3001 (backend/.env PORT=3001).
  // Override with VITE_API_PROXY if yours differs.
  const proxyTarget = env.VITE_API_PROXY || 'http://localhost:3001';
  return {
    // Served under /kendra so the backend can host the built SPA same-origin
    // (backend serves kendra/dist at /kendra; the API stays at /api/v1). In dev
    // the app is therefore at http://localhost:5181/kendra/.
    base: '/kendra/',
    plugins: [react()],
    server: {
      port: 5181,
      proxy: mode === 'development'
        ? { '/api': { target: proxyTarget, changeOrigin: true } }
        : undefined,
    },
  };
});
