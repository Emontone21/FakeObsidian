import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // En desarrollo la API la sirve el backend en otro puerto.
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false }
    }
  },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false }
});
