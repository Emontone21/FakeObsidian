import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Los tests corren contra el codigo fuente de shared (sin build previo).
export default defineConfig({
  resolve: {
    alias: {
      '@bitacora/shared': fileURLToPath(new URL('./shared/src/index.ts', import.meta.url))
    }
  },
  test: {
    include: ['shared/src/**/*.test.ts', 'server/src/**/*.test.ts'],
    environment: 'node',
    pool: 'forks'
  }
});
