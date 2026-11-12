import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  server: { port: 8520, strictPort: true },
  preview: { port: 8521, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 900, assetsDir: 'build' }, // public/assets/<id>/ stays separate
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
