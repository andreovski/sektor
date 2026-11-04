import tailwind from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Só na seção `main`, que gera o main e o núcleo. `.env.local` não vai para o Git nem para o pacote.
  const env = loadEnv(mode, __dirname, 'GOOGLE_');
  return {
  main: {
    define: {
      __GOOGLE_CLIENT_ID__: JSON.stringify(env.GOOGLE_CLIENT_ID ?? ''),
      __GOOGLE_CLIENT_SECRET__: JSON.stringify(env.GOOGLE_CLIENT_SECRET ?? ''),
    },
    // O driver do Drizzle importa `better-sqlite3`; a variante com criptografia tem a mesma API.
    resolve: { alias: { 'better-sqlite3': 'better-sqlite3-multiple-ciphers' } },
    build: {
      externalizeDeps: { exclude: ['@sektor/core', '@sektor/finance-engine', '@sektor/contract', 'drizzle-orm', 'zod'] },
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
    plugins: [react(), tailwind()],
    // O motor do Whisper (onnxruntime) vai dentro do app: os arquivos `.wasm` não saem pelo `exports`.
    resolve: { alias: { 'ort-dist': dirname(createRequire(__filename).resolve('onnxruntime-web')) } },
    worker: { format: 'es' },
  },
  };
});
