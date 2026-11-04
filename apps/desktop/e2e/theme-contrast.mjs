// Mede o contraste WCAG de cada paleta nos dois modos, com as cores já resolvidas no app.
// Uso: node e2e/theme-contrast.mjs (depois de `electron-vite build`)
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from 'playwright';

const TEXT = 4.5;
const SHAPE = 3;
const PALETTES = ['floresta', 'papel', 'oceano', 'ameixa', 'rose', 'grafite', 'dracula'];
const PAIRS = [
  ['--foreground', '--background', TEXT],
  ['--foreground', '--surface-raised', TEXT],
  ['--muted-foreground', '--background', TEXT],
  ['--muted-foreground', '--surface', TEXT],
  ['--muted-foreground', '--surface-sunken', TEXT],
  ['--subtle-foreground', '--surface', TEXT],
  ['--primary-foreground', '--primary', TEXT],
  ['--primary-foreground', '--primary-hover', TEXT],
  ['--primary', '--background', TEXT],
  ['--primary', '--surface', TEXT],
  ['--secondary', '--surface', TEXT],
  ...['success', 'warning', 'danger', 'info'].map((name) => [`--${name}`, '--surface', TEXT]),
  ...['violet', 'blue', 'green', 'amber', 'orange', 'rose', 'cyan'].map((name) => [
    `--tone-${name}`,
    '--surface',
    SHAPE,
  ]),
];

const dir = mkdtempSync(join(tmpdir(), 'sektor-e2e-'));
const env = { ...process.env, SEKTOR_TEST_DIR: dir };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], env });
const page = await app.firstWindow();
await page.waitForTimeout(800);

const results = await page.evaluate(
  ({ palettes, pairs }) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const rgb = (color) => {
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    const luminance = (channels) => {
      const [r, g, b] = channels.map((value) => {
        const c = value / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const root = document.documentElement;
    const out = [];
    for (const palette of palettes) {
      for (const theme of ['dark', 'light']) {
        root.dataset.palette = palette;
        root.dataset.theme = theme;
        const styles = getComputedStyle(root);
        for (const [text, back, need] of pairs) {
          const a = luminance(rgb(styles.getPropertyValue(text)));
          const b = luminance(rgb(styles.getPropertyValue(back)));
          const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          out.push({ palette, theme, text, back, need, ratio: Math.round(ratio * 100) / 100 });
        }
      }
    }
    return out;
  },
  { palettes: PALETTES, pairs: PAIRS }
);

const failed = results.filter(({ ratio, need }) => ratio < need);
for (const { palette, theme, text, back, need, ratio } of failed) {
  console.log(`FALHA ${palette}/${theme}: ${text} em ${back} = ${ratio} (mínimo ${need})`);
}
console.log(`${results.length - failed.length}/${results.length} ok`);
await app.close();
rmSync(dir, { recursive: true, force: true });
process.exit(failed.length ? 1 : 0);
