import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    host: '0.0.0.0', port: 5173, allowedHosts: ['.alpha.site', '.run.app'],
    // Preserve the browser's Host and Origin so the API can enforce same-origin writes.
    proxy: { '/api': { target: 'http://127.0.0.1:8080', changeOrigin: false } },
  },
  preview: { host: '0.0.0.0', allowedHosts: ['.alpha.site', '.run.app'] },
});
