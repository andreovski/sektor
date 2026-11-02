import { defineConfig } from 'vitest/config';

// Como no app: o driver do Drizzle usa a variante com criptografia, compilada para o Electron.
export default defineConfig({
  resolve: { alias: { 'better-sqlite3': 'better-sqlite3-multiple-ciphers' } },
  test: { server: { deps: { inline: ['drizzle-orm'] } } },
});
