// A captura rápida: a janela solta nasce escondida, o atalho a mostra, a tarefa confirma e some.
// O atalho global não dá para apertar daqui: o teste mostra a janela como o atalho faz.
// Uso: node e2e/quick-capture.mjs [pasta-das-fotos]
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from 'playwright';

const shots = process.argv[2];
const dir = mkdtempSync(join(tmpdir(), 'sektor-e2e-'));
const env = { ...process.env, SEKTOR_TEST_DIR: dir, SEKTOR_TEST_QUICK: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], env });
const errors = [];
const results = {};
const check = (name, ok) => {
  results[name] = ok;
  if (!ok) process.exitCode = 1;
};

try {
  const main = await app.firstWindow();
  await main.waitForLoadState('domcontentloaded');
  await main.waitForTimeout(1500);
  check('a principal é a primeira janela', !main.url().includes('captura-rapida'));
  const panel = app.windows().find((page) => page.url().includes('captura-rapida'));
  check('janela criada escondida', Boolean(panel));
  panel.on('pageerror', (error) => errors.push(error.message));
  check(
    'fora da lista da janela principal',
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.isVisible()).length === 1)
  );

  const show = () =>
    app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('captura-rapida'));
      window.show();
      window.focus();
      window.webContents.send('quick-capture:shown');
    });
  await show();
  await panel.waitForTimeout(500);
  check('capa de pixels no fundo', (await panel.locator('.quick-pixels canvas').count()) === 1);
  check('transparente', await panel.evaluate(() => getComputedStyle(document.body).backgroundColor === 'rgba(0, 0, 0, 0)'));
  check('abre na aba Tarefa', (await panel.getByRole('tab', { selected: true }).getAttribute('aria-label')) === 'Tarefa');
  const input = panel.getByLabel('Capturar tarefa');
  check('cursor no campo', await input.evaluate((element) => element === document.activeElement));
  await input.fill('Ligar para o contador amanhã');
  if (shots) await panel.screenshot({ path: join(shots, 'captura-tarefa.png') });
  await input.press('Enter');
  await panel.getByRole('status').waitFor({ timeout: 3000 });
  const summary = await panel.getByRole('status').innerText();
  check('confirma o que salvou', /Ligar para o contador/.test(summary) && /amanhã/i.test(summary));
  if (shots) await panel.screenshot({ path: join(shots, 'captura-confirmada.png') });
  await panel.waitForTimeout(1600);
  check(
    'fecha sozinha',
    await app.evaluate(({ BrowserWindow }) =>
      !BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('captura-rapida')).isVisible()
    )
  );

  await show();
  await panel.waitForTimeout(300);
  await panel.keyboard.press('Alt+Digit2');
  check('⌥2 troca para Nota', (await panel.getByRole('tab', { selected: true }).getAttribute('aria-label')) === 'Nota');
  await panel.keyboard.press('Alt+ArrowRight');
  check('⌥→ com o campo vazio vai para Agente', (await panel.getByRole('tab', { selected: true }).getAttribute('aria-label')) === 'Agente');
  if (shots) await panel.screenshot({ path: join(shots, 'captura-agente.png') });

  // Wallpaper e tema escolhidos na janela principal chegam à captura sem reabrir o app.
  await main.evaluate(() => (location.hash = '#/ajustes?secao=aparencia'));
  await main.getByTestId('wallpaper-noite').click();
  await main.getByTestId('theme-light').click();
  await main.waitForTimeout(1500);
  await show();
  await panel.waitForTimeout(500);
  check('segue o tema da principal', (await panel.evaluate(() => document.documentElement.dataset.theme)) === 'light');
  check('wallpaper no fundo', (await panel.locator('img.quick-wallpaper').count()) === 1);
  if (shots) await panel.screenshot({ path: join(shots, 'captura-wallpaper-claro.png') });
  await main.getByTestId('theme-dark').click();
  await main.waitForTimeout(800);
  if (shots) await panel.screenshot({ path: join(shots, 'captura-wallpaper-escuro.png') });
  // Menu aberto (o projeto da nota, o modelo) ganha espaço na janela, e ela volta ao fechar.
  const height = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('captura-rapida')).getSize()[1]
    );
  const before = await height();
  await panel.evaluate(() => {
    const menu = document.createElement('div');
    menu.setAttribute('data-radix-popper-content-wrapper', '');
    menu.id = 'menu-de-teste';
    document.body.append(menu);
  });
  await panel.waitForTimeout(200);
  const opened = await height();
  await panel.evaluate(() => document.getElementById('menu-de-teste').remove());
  await panel.waitForTimeout(200);
  check('menu aberto cabe na janela', opened >= before + 300 && (await height()) === before);
  await panel.keyboard.press('Alt+Digit1');
  await panel.waitForTimeout(100);
  const task = panel.getByLabel('Capturar tarefa');
  check('⌥1 volta para Tarefa com o cursor no campo', await task.evaluate((element) => element === document.activeElement));
  await task.fill('Comprar café');
  await panel.keyboard.press('Alt+ArrowRight');
  check('⌥→ com texto não troca a aba', (await panel.getByRole('tab', { selected: true }).getAttribute('aria-label')) === 'Tarefa');
  await task.fill('');
  // Sem modelo nos testes o campo do Agente fica desligado: a prova é voltar para Tarefa.
  await panel.getByRole('tab', { name: 'Agente' }).click();
  await panel.getByRole('tab', { name: 'Tarefa' }).click();
  await panel.waitForTimeout(100);
  check(
    'clicar na aba deixa o cursor no campo',
    await panel.getByLabel('Capturar tarefa').evaluate((element) => element === document.activeElement)
  );
  await panel.keyboard.press('Escape');
  await panel.waitForTimeout(200);
  check(
    'Esc fecha',
    await app.evaluate(({ BrowserWindow }) =>
      !BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('captura-rapida')).isVisible()
    )
  );

  // ⌘↩ na confirmação leva a principal para a tela da tarefa.
  await show();
  await panel.waitForTimeout(300);
  await panel.getByLabel('Capturar tarefa').fill('Pagar o IPTU');
  await panel.getByLabel('Capturar tarefa').press('Enter');
  await panel.getByRole('status').waitFor({ timeout: 3000 });
  await panel.keyboard.press('Meta+Enter');
  await main.waitForTimeout(500);
  check('⌘↩ abre no app', main.url().endsWith('#/tarefas'));

  // Gravar outro atalho em Ajustes.
  await main.evaluate(() => (location.hash = '#/ajustes?secao=atalhos'));
  await main.getByRole('button', { name: 'Gravar' }).click();
  await main.keyboard.press('Meta+Space');
  check('recusa o atalho do Spotlight', /Spotlight/.test(await main.getByRole('alert').innerText()));
  // Recusado, segue gravando: a próxima combinação já vale.
  await main.keyboard.press('Control+Alt+KeyK');
  await main.waitForTimeout(400);
  check('grava ⌃ ⌥ K', (await main.locator('kbd').first().innerText()) === '⌃ ⌥ K');
  check(
    'atalho novo registrado',
    await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Control+Alt+K') && !globalShortcut.isRegistered('Alt+Space'))
  );
  if (shots) await main.screenshot({ path: join(shots, 'atalhos-gravado.png') });
} finally {
  console.log(JSON.stringify({ results, errors }, null, 2));
  await app.close();
  rmSync(dir, { recursive: true, force: true });
}
