import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  server: { port: 8520, strictPort: true, host: '127.0.0.1' },
  preview: { port: 8521, strictPort: true, host: '127.0.0.1' },
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
