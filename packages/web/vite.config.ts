import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// VITE_API_URL is consumed two ways: as a fetch base in the browser (where the
// /api segment is conventional) and as the dev-proxy target (where it is not,
// because Vite preserves the matched /api prefix). Strip a trailing /api so the
// proxy works whether the env var includes it or not.
const proxyTarget = (process.env.VITE_API_URL || 'http://localhost:3001')
  .replace(/\/+$/, '')
  .replace(/\/api$/, '');

export default defineConfig({
  plugins: [react()],
  server: {
    port: parseInt(process.env.WEB_PORT || '5173'),
    proxy: {
      '/api': {
        target: proxyTarget,
        changeOrigin: true,
      },
    },
  },
});
