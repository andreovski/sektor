// Prova que as credenciais do Google só entram no main e no núcleo. Compila com valores falsos no
// ambiente, que vencem o `.env.local`, e nunca lê esse arquivo. Roda com `e2e/locked.sh`.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ID = 'sentinela-id.apps.googleusercontent.com';
const SECRET = 'sentinela-segredo-0123456789';
const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
execFileSync('../../node_modules/.bin/electron-vite', ['build'], {
  env: { ...env, GOOGLE_CLIENT_ID: ID, GOOGLE_CLIENT_SECRET: SECRET },
  stdio: 'ignore',
});

const files = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
const holders = (text) =>
  files('out')
    .filter((path) => readFileSync(path).includes(text))
    .sort();

assert.deepEqual(holders(SECRET), ['out/main/core.js']);
assert.deepEqual(holders(ID), ['out/main/core.js', 'out/main/index.js']);
console.log('ok    segredo só no núcleo; id só no main e no núcleo; nada no preload nem na tela');
