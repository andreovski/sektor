// Abre o app num banco temporário, sem cofre, e fotografa rotas.
// Uso: node e2e/shot.mjs <saída.png> <rota> [script.mjs]
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright';

const [out, route = '/', script] = process.argv.slice(2);
const dir = mkdtempSync(join(tmpdir(), 'sektor-e2e-'));
const env = { ...process.env, SEKTOR_TEST_DIR: dir };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], env });
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.waitForLoadState('domcontentloaded');
await page.evaluate((r) => (location.hash = `#${r}`), route);
await page.waitForTimeout(1200);
if (script) await (await import(pathToFileURL(resolve(script)).href)).default(page);
await page.screenshot({ path: out });
console.log(JSON.stringify({ route, errors, title: await page.title() }));
await app.close();
rmSync(dir, { recursive: true, force: true });
