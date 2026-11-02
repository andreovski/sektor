import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    // O driver do Drizzle importa `better-sqlite3`; a variante com criptografia tem a mesma API.
    resolve: { alias: { 'better-sqlite3': 'better-sqlite3-multiple-ciphers' } },
    build: {
      externalizeDeps: { exclude: ['@sektor/core', '@sektor/finance-engine', 'drizzle-orm'] },
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          core: resolve(__dirname, 'src/core/index.ts'),
        },
      },
    },
  },
  preload: { build: { rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } } } },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } } },
    plugins: [react()],
  },
});
