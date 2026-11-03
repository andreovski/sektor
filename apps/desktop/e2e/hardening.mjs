// Prova dos defeitos corrigidos, no app de verdade. Uso, depois do build:
//   node e2e/hardening.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from 'playwright';

const root = mkdtempSync(join(tmpdir(), 'sektor-hard-'));
let count = 0;
const newDir = () => {
  const dir = join(root, `d${++count}`);
  mkdirSync(dir);
  return dir;
};
const results = [];
const test = async (name, run) => {
  try {
    await run();
    results.push(`ok    ${name}`);
  } catch (error) {
    results.push(`FALHA ${name}\n      ${String(error.stack ?? error).split('\n').slice(0, 4).join('\n      ')}`);
  }
  console.log(results.at(-1));
};

async function launch(dir, env = {}) {
  const full = { ...process.env, SEKTOR_TEST_DIR: dir, ...env };
  delete full.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.'], env: full });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}
const go = (page, route) => page.evaluate((r) => (location.hash = `#${r}`), route);
const stubOpen = (app, path) =>
  app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, path);
const closed = (app) => new Promise((resolve) => app.process().once('exit', resolve));

await test('1. janela não navega para file:///tmp/x.html', async () => {
  const marker = join(root, 'x.html');
  writeFileSync(
    marker,
    `<title>FORA</title><script>
      window.got = 0;
      addEventListener('message', (e) => { window.got += e.ports.length; document.title = 'PORTA'; });
    </script>`
  );
  writeFileSync('/tmp/x.html', readFileSync(marker));
  const { app, page } = await launch(newDir());
  const start = page.url();
  await page.evaluate(() => {
    location.href = 'file:///tmp/x.html';
  });
  await page.waitForTimeout(500);
  assert.equal(page.url(), start);
  await page.evaluate(() => {
    const link = document.createElement('a');
    link.href = 'file:///tmp/x.html';
    document.body.append(link);
    link.click();
  });
  await page.waitForTimeout(500);
  assert.equal(page.url(), start);
  await page.evaluate(() => {
    location.href = 'https://example.com/';
  });
  await page.waitForTimeout(500);
  assert.equal(page.url(), start);
  await go(page, '/ajustes?secao=backup');
  await page.getByText('Pasta de backup').first().waitFor({ timeout: 5000 });

  // O caminho que o will-navigate não pega: mesmo assim a página de fora não recebe nada.
  await app.evaluate(({ BrowserWindow }) => {
    void BrowserWindow.getAllWindows()[0].loadURL('file:///tmp/x.html');
  });
  await page.waitForFunction(() => document.title === 'FORA');
  await page.waitForTimeout(800);
  assert.equal(await page.title(), 'FORA');
  assert.equal(await page.evaluate(() => window.got), 0);
  const refused = await page.evaluate(() => window.sektor.info().then(() => 'abriu', (e) => e.message));
  assert.match(refused, /Origem não autorizada/);
  await app.close();
});

await test('1. arquivo arrastado não abre na janela, fora da área marcada', async () => {
  const { app, page } = await launch(newDir());
  const fired = await page.evaluate(() => {
    const send = (target, type) => {
      const data = new DataTransfer();
      data.items.add(new File(['x'], 'a.html', { type: 'text/html' }));
      const event = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const zone = document.createElement('div');
    zone.dataset.fileDrop = '';
    document.body.append(zone);
    return {
      over: send(document.body, 'dragover'),
      drop: send(document.body, 'drop'),
      zone: send(zone, 'drop'),
    };
  });
  assert.deepEqual(fired, { over: true, drop: true, zone: false });
  await app.close();
});

await test('3. CSP, menu sem DevTools no pacote é conferido no smoke; menu em português', async () => {
  const { app, page } = await launch(newDir());
  const csp = await page.evaluate(
    () => document.querySelector('meta[http-equiv="Content-Security-Policy"]').content
  );
  assert.match(csp, /form-action 'none'/);
  assert.match(csp, /base-uri 'none'/);
  const menu = await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu().items.map((item) => ({
      label: item.label,
      items: item.submenu.items.map((sub) => sub.label),
    }))
  );
  assert.deepEqual(menu.map((m) => m.label).slice(0, 3), ['Sektor', 'Editar', 'Janela']);
  assert.ok(menu[1].items.includes('Copiar') && menu[1].items.includes('Colar'));
  await app.close();
});

await test('4. banco corrompido: tela de erro com causa e pasta, e nada apagado', async () => {
  const dir = newDir();
  const junk = 'lixo'.repeat(5000);
  writeFileSync(join(dir, 'sektor.db'), junk);
  writeFileSync(join(dir, 'database.key'), 'd'.repeat(64));
  const { app, page } = await launch(dir);
  await page.getByText('O Sektor não conseguiu abrir seus dados').waitFor({ timeout: 5000 });
  await page.getByText('file is not a database').waitFor();
  await page.getByText(dir).waitFor();
  await page.screenshot({ path: '/tmp/sektor-fatal.png' });
  assert.equal(readFileSync(join(dir, 'sektor.db'), 'utf8'), junk);
  await app.close();
});

await test('4. cofre indisponível: tela de erro, e a chave não é tocada', async () => {
  const dir = newDir();
  const { app, page } = await launch(dir, { SEKTOR_TEST_VAULT: 'off' });
  await page.getByText('O cofre do sistema não respondeu').waitFor({ timeout: 5000 });
  await page.getByText('O cofre do sistema não está disponível.').waitFor();
  assert.equal(existsSync(join(dir, 'database.key')), false);
  await app.close();
});

await test('4. banco sem chave não ganha chave nova', async () => {
  const dir = newDir();
  writeFileSync(join(dir, 'sektor.db'), 'lixo'.repeat(5000));
  const { app, page } = await launch(dir);
  await page.getByText('A chave do banco sumiu').waitFor({ timeout: 5000 });
  assert.equal(existsSync(join(dir, 'database.key')), false);
  await app.close();
});

await test('4. núcleo morre: chamada pendente rejeita com mensagem clara', async () => {
  const { app, page } = await launch(newDir());
  await go(page, '/ajustes');
  await page.getByRole('button', { name: 'Salvar' }).waitFor({ timeout: 5000 });
  const pid = await app.evaluate(
    ({ app: electronApp }) =>
      electronApp.getAppMetrics().find((m) => m.type === 'Utility' && m.name === 'sektor-core')?.pid
  );
  assert.ok(pid);
  process.kill(pid, 'SIGSTOP');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await page.waitForTimeout(300);
  process.kill(pid, 'SIGKILL');
  await page.getByText('O núcleo do Sektor parou').first().waitFor({ timeout: 5000 });
  await page.getByText(/Esta chamada não foi concluída/).waitFor({ timeout: 5000 });
  await app.close();
});

await test('6. fechar a janela e clicar no Dock reabre, com o núcleo ligado', async () => {
  const { app, page } = await launch(newDir());
  await page.getByText('Hoje').first().waitFor({ timeout: 5000 });
  const next = app.waitForEvent('window');
  await page.close();
  await app.evaluate(async ({ app: electronApp, BrowserWindow }) => {
    while (BrowserWindow.getAllWindows().length) await new Promise((r) => setTimeout(r, 50));
    electronApp.emit('activate');
  });
  const window = await next;
  await window.getByText('Hoje').first().waitFor({ timeout: 5000 });
  await window.evaluate(() => (location.hash = '#/ajustes'));
  await window.getByRole('button', { name: 'Salvar' }).waitFor({ timeout: 5000 });
  await app.close();
});

await test('6. segunda instância sai e foca a primeira', async () => {
  const dir = newDir();
  const { app } = await launch(dir);
  await app.evaluate(({ app: electronApp, BrowserWindow }) => {
    globalThis.seen = 0;
    electronApp.on('second-instance', () => (globalThis.seen += 1));
    BrowserWindow.getAllWindows()[0].minimize();
  });
  const env = { ...process.env, SEKTOR_TEST_DIR: dir };
  delete env.ELECTRON_RUN_AS_NODE;
  const { spawn } = await import('node:child_process');
  const electronPath = (await import('electron')).default;
  const second = spawn(electronPath, ['.'], { env, stdio: 'ignore' });
  const code = await new Promise((resolve) => second.once('exit', resolve));
  assert.equal(code, 0);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const state = await app.evaluate(({ BrowserWindow }) => ({
    seen: globalThis.seen,
    windows: BrowserWindow.getAllWindows().length,
    minimized: BrowserWindow.getAllWindows()[0].isMinimized(),
  }));
  assert.deepEqual(state, { seen: 1, windows: 1, minimized: false });
  await app.close();
});

const recovery = {};
await test('8/9. ajustes: nome no Início, backup com senha uma vez', async () => {
  const dir = newDir();
  const folder = newDir();
  recovery.dir = dir;
  recovery.folder = folder;
  const { app, page } = await launch(dir);
  await go(page, '/ajustes?secao=sobre');
  await page.getByText('Pasta de dados').first().waitFor({ timeout: 5000 });
  await page.getByTestId('data-dir').getByText(dir).waitFor();
  await go(page, '/ajustes');
  await page.getByLabel('Seu nome').fill('André');
  await page.getByLabel('Fuso horário').selectOption('Asia/Tokyo');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await page.getByText('Ajustes salvos.').waitFor();

  await go(page, '/ajustes?secao=backup');
  await stubOpen(app, folder);
  await page.getByRole('button', { name: 'Escolher pasta' }).click();
  const code = page.getByTestId('recovery-password');
  await code.waitFor({ timeout: 5000 });
  recovery.password = await code.innerText();
  assert.match(recovery.password, /^[0-9A-Z]{4}(-[0-9A-Z]{4}){5}$/);
  await page.screenshot({ path: '/tmp/sektor-recovery.png' });
  await page.getByRole('button', { name: 'Já guardei' }).click();
  await page.getByTestId('backup-folder').getByText(folder).waitFor();
  await page.getByRole('button', { name: 'Fazer backup agora' }).click();
  await page.getByText('Backup feito.').waitFor();
  await page.screenshot({ path: '/tmp/sektor-ajustes.png', fullPage: true });
  const files = readdirSync(folder);
  assert.ok(files.includes('sektor-recuperacao.json'));
  const backups = files.filter((f) => f.endsWith('.db'));
  assert.ok(backups.length >= 1, files.join());
  const header = readFileSync(join(folder, backups[0])).subarray(0, 15).toString('latin1');
  assert.notEqual(header, 'SQLite format 3');
  recovery.file = join(folder, backups[0]);

  await go(page, '/');
  await page.getByRole('heading', { name: /, André$/ }).waitFor({ timeout: 5000 });
  await app.close();
});

await test('8. restaura na mesma máquina: confirma, reinicia e guarda a base anterior', async () => {
  const { app, page } = await launch(recovery.dir);
  await go(page, '/ajustes');
  await page.getByLabel('Seu nome').fill('Depois do backup');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await page.getByText('Ajustes salvos.').waitFor();
  await go(page, '/ajustes?secao=backup');
  await stubOpen(app, recovery.file);
  await page.getByRole('button', { name: 'Restaurar de um arquivo' }).click();
  const gone = closed(app);
  await page.getByRole('button', { name: 'Restaurar e reiniciar' }).click();
  await gone;
  assert.equal(existsSync(join(recovery.dir, 'restauracao-pendente.json')), true);

  const again = await launch(recovery.dir);
  await go(again.page, '/ajustes');
  await again.page.getByRole('button', { name: 'Salvar' }).waitFor({ timeout: 5000 });
  await again.page.waitForFunction(
    () => document.querySelector('input')?.value === 'André',
    undefined,
    { timeout: 5000 }
  );
  assert.equal(existsSync(join(recovery.dir, 'restauracao-pendente.json')), false);
  assert.ok(readdirSync(join(recovery.dir, 'antes-da-restauracao')).some((f) => f.endsWith('.db')));
  await again.app.close();
});

await test('8. restaura em outra máquina com a senha', async () => {
  const dir = newDir();
  const { app, page } = await launch(dir);
  await go(page, '/ajustes?secao=backup');
  await stubOpen(app, recovery.file);
  await page.getByRole('button', { name: 'Restaurar de um arquivo' }).click();
  await page.getByRole('button', { name: 'Restaurar e reiniciar' }).click();
  await page.getByText('Digite a senha de recuperação').waitFor({ timeout: 5000 });
  await page.getByLabel('Senha de recuperação').fill('AAAA-BBBB-CCCC-DDDD-EEEE-FFFF');
  await page.getByRole('button', { name: 'Restaurar e reiniciar' }).click();
  await page.getByText('Senha de recuperação incorreta.').waitFor({ timeout: 5000 });
  await page.getByLabel('Senha de recuperação').fill(recovery.password);
  const gone = closed(app);
  await page.getByRole('button', { name: 'Restaurar e reiniciar' }).click();
  await gone;

  const again = await launch(dir);
  await again.page.getByRole('heading', { name: /, André$/ }).waitFor({ timeout: 5000 });
  await go(again.page, '/ajustes?secao=backup');
  await again.page.getByText('Nenhuma. Sem pasta').waitFor({ timeout: 5000 });
  await again.app.close();
});

await test('8. cofre perdeu a chave: a tela de erro restaura com a senha', async () => {
  const dir = newDir();
  const first = await launch(dir);
  await first.page.getByText('Hoje').first().waitFor({ timeout: 5000 });
  await first.app.close();
  const oldKey = readFileSync(join(dir, 'database.key'));

  const { app, page } = await launch(dir, { SEKTOR_TEST_VAULT: 'locked' });
  await page.getByText('O cofre do sistema não respondeu').waitFor({ timeout: 5000 });
  await stubOpen(app, recovery.file);
  await page.getByRole('button', { name: 'Restaurar um backup' }).click();
  await page.getByRole('button', { name: 'Restaurar e reiniciar' }).click();
  await page.getByLabel('Senha de recuperação').fill(recovery.password);
  const gone = closed(app);
  await page.getByRole('button', { name: 'Restaurar e reiniciar' }).click();
  await gone;

  const again = await launch(dir);
  await again.page.getByRole('heading', { name: /, André$/ }).waitFor({ timeout: 8000 });
  const kept = readdirSync(join(dir, 'antes-da-restauracao'));
  const oldCopy = kept.find((f) => f.endsWith('.key'));
  assert.deepEqual(readFileSync(join(dir, 'antes-da-restauracao', oldCopy)), oldKey);
  await again.app.close();
});

await test('Google: conectar abre o navegador, confere o state e cancela fechando a porta', async () => {
  const { app, page } = await launch(newDir());
  await go(page, '/ajustes?secao=google');
  await page.getByRole('heading', { name: 'Ajustes' }).waitFor({ timeout: 5000 });
  const button = page.getByRole('button', { name: 'Conectar conta Google' });
  await page
    .getByText('O Google não está configurado neste build.')
    .or(button)
    .first()
    .waitFor({ timeout: 5000 });
  if (!(await button.isVisible())) {
    await page.screenshot({ path: '/tmp/sektor-google-off.png', fullPage: true });
    await app.close();
    return;
  }
  await app.evaluate(({ shell }) => {
    shell.openExternal = async (url) => {
      globalThis.opened = url;
    };
  });
  await button.click();
  await page.getByText('Continue no navegador').waitFor({ timeout: 5000 });
  await page.screenshot({ path: '/tmp/sektor-google.png', fullPage: true });
  const opened = new URL(await app.evaluate(() => globalThis.opened));
  assert.equal(opened.host, 'accounts.google.com');
  assert.equal(opened.searchParams.get('code_challenge_method'), 'S256');
  const callback = opened.searchParams.get('redirect_uri');
  assert.match(callback, /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  assert.equal((await fetch(`${callback}?code=x&state=errado`)).status, 400);
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await button.waitFor({ timeout: 5000 });
  await assert.rejects(fetch(callback));
  await app.close();
});

await test('Google: a tela não enxerga as credenciais', async () => {
  const { app, page } = await launch(newDir());
  const seen = await page.evaluate(() => [
    typeof globalThis.__GOOGLE_CLIENT_SECRET__,
    typeof window.sektor.googleLogin,
    typeof window.sektor.googleClientSecret,
  ]);
  assert.deepEqual(seen, ['undefined', 'function', 'undefined']);
  await app.close();
});

await test('Google: página de fora não abre o login', async () => {
  const { app, page } = await launch(newDir());
  await app.evaluate(({ BrowserWindow }) => {
    void BrowserWindow.getAllWindows()[0].loadURL('data:text/html,<title>FORA</title>');
  });
  await page.waitForFunction(() => document.title === 'FORA');
  assert.equal(await page.evaluate(() => typeof window.sektor?.googleLogin), 'function');
  const refused = await page.evaluate(() =>
    window.sektor.googleLogin().then(() => 'abriu', (e) => e.message)
  );
  assert.match(refused, /Origem não autorizada/);
  await app.close();
});

// Arquivos de projeto: o caminho inteiro, com o app de verdade e o abrir do sistema trocado.
const TEXT = 'contrato sigiloso da oficina';
const textHash = createHash('sha256').update(TEXT).digest('hex');
const filesIn = (dir) => join(dir, 'arquivos-de-projeto');
const stubShell = (app) =>
  app.evaluate(({ shell }) => {
    globalThis.opened = [];
    const { readFileSync } = process.getBuiltinModule('node:fs');
    Object.defineProperty(shell, 'openPath', {
      configurable: true,
      value: async (path) => {
        globalThis.opened.push({ path, text: readFileSync(path, 'utf8') });
        return '';
      },
    });
  });
async function attachToNewProject(app, page) {
  const sample = join(root, 'contrato.txt');
  writeFileSync(sample, TEXT);
  await go(page, '/projetos');
  await page.getByRole('button', { name: 'Novo projeto' }).click();
  await page.getByLabel('Nome').fill('Oficina');
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await page.waitForFunction(() => /#\/projetos\/[0-9a-f-]{36}$/.test(location.hash));
  await page.getByRole('tab', { name: 'Arquivos' }).click();
  await stubOpen(app, sample);
  await page.getByRole('button', { name: 'Anexar arquivo' }).click();
  await page.getByRole('button', { name: 'contrato.txt', exact: true }).waitFor({ timeout: 5000 });
}
async function openAttached(page) {
  await go(page, '/projetos');
  await page.getByRole('heading', { name: 'Oficina' }).click({ timeout: 8000 });
  await page.getByRole('tab', { name: 'Arquivos' }).click();
  await page.getByRole('button', { name: 'contrato.txt', exact: true }).click({ timeout: 5000 });
}
const openedList = async (app, page) => {
  await page.waitForTimeout(300);
  return app.evaluate(() => globalThis.opened);
};

const vault = {};
await test('arquivo: cifrado no disco, e a cópia aberta some depois do prazo', async () => {
  const dir = newDir();
  vault.dir = dir;
  mkdirSync(join(dir, 'arquivos-abertos', 'de-uma-queda'), { recursive: true });
  writeFileSync(join(dir, 'arquivos-abertos', 'de-uma-queda', 'sobra.txt'), TEXT);
  const { app, page } = await launch(dir, { SEKTOR_TEST_OPEN_MS: '400' });
  await page.getByText('Hoje').first().waitFor({ timeout: 5000 });
  assert.equal(existsSync(join(dir, 'arquivos-abertos', 'de-uma-queda')), false);
  await stubShell(app);
  await attachToNewProject(app, page);
  assert.deepEqual(readdirSync(filesIn(dir)), [`${textHash}.sek`]);
  assert.equal(readFileSync(join(filesIn(dir), `${textHash}.sek`)).includes(TEXT), false);
  await openAttached(page);
  const [first] = await openedList(app, page);
  assert.equal(first.text, TEXT);
  assert.ok(first.path.startsWith(join(dir, 'arquivos-abertos')));
  await page.waitForTimeout(700);
  assert.equal(existsSync(first.path), false);
  await app.close();
});

await test('arquivo: a cópia aberta some ao sair, sem esperar o prazo', async () => {
  const { app, page } = await launch(vault.dir);
  await stubShell(app);
  await openAttached(page);
  const [first] = await openedList(app, page);
  assert.equal(existsSync(first.path), true);
  await app.close();
  assert.equal(existsSync(first.path), false);
});

await test('arquivo: o que estava em claro é cifrado ao abrir, e continua abrindo', async () => {
  const sealed = join(filesIn(vault.dir), `${textHash}.sek`);
  vault.sealed = readFileSync(sealed);
  rmSync(sealed);
  writeFileSync(join(filesIn(vault.dir), `${textHash}.txt`), TEXT);
  const { app, page } = await launch(vault.dir);
  await page.getByText('Hoje').first().waitFor({ timeout: 5000 });
  assert.deepEqual(readdirSync(filesIn(vault.dir)), [`${textHash}.sek`]);
  assert.equal(readFileSync(sealed).includes(TEXT), false);
  await stubShell(app);
  await openAttached(page);
  assert.equal((await openedList(app, page))[0].text, TEXT);

  const folder = newDir();
  vault.folder = folder;
  await go(page, '/ajustes?secao=backup');
  await stubOpen(app, folder);
  await page.getByRole('button', { name: 'Escolher pasta' }).click();
  const code = page.getByTestId('recovery-password');
  await code.waitFor({ timeout: 5000 });
  vault.password = await code.innerText();
  await page.getByRole('button', { name: 'Já guardei' }).click();
  await page.getByTestId('backup-project-files').getByText('1 arquivo(s)').waitFor({ timeout: 5000 });
  await app.close();
  vault.backup = join(folder, readdirSync(folder).find((name) => name.endsWith('.db')));
  const [keyFolder] = readdirSync(filesIn(folder));
  vault.copy = join(filesIn(folder), keyFolder, `${textHash}.sek`);
  assert.deepEqual(readFileSync(vault.copy), readFileSync(sealed));
});

async function restoreElsewhere(dir) {
  const { app, page } = await launch(dir);
  await go(page, '/ajustes?secao=backup');
  await page.getByRole('button', { name: 'Restaurar de um arquivo' }).waitFor({ timeout: 5000 });
  await stubOpen(app, vault.backup);
  await page.getByRole('button', { name: 'Restaurar de um arquivo' }).click();
  await page.getByRole('button', { name: 'Restaurar e reiniciar' }).click();
  await page.getByLabel('Senha de recuperação').fill(vault.password);
  const gone = closed(app);
  await page.getByRole('button', { name: 'Restaurar e reiniciar' }).click();
  return { page, gone };
}

await test('arquivo: restaura em outra máquina, recifrado com a chave de lá', async () => {
  const dir = newDir();
  const { gone } = await restoreElsewhere(dir);
  await gone;
  const again = await launch(dir);
  await again.page.getByText('Hoje').first().waitFor({ timeout: 8000 });
  assert.deepEqual(readdirSync(filesIn(dir)), [`${textHash}.sek`]);
  assert.notDeepEqual(readFileSync(join(filesIn(dir), `${textHash}.sek`)), vault.sealed);
  assert.equal(existsSync(join(dir, 'arquivos-restaurando')), false);
  await stubShell(again.app);
  await openAttached(again.page);
  assert.equal((await openedList(again.app, again.page))[0].text, TEXT);
  await again.app.close();
});

await test('arquivo: faltou no backup, restaura igual e a tela conta', async () => {
  rmSync(vault.copy);
  const dir = newDir();
  const { page, gone } = await restoreElsewhere(dir);
  await page.getByText('1 arquivo de projeto não foi encontrado no backup.').waitFor({ timeout: 8000 });
  await page.screenshot({ path: '/tmp/sektor-arquivo-faltou.png' });
  await page.getByRole('button', { name: 'Reiniciar' }).click();
  await gone;
  const again = await launch(dir);
  await again.page.getByText('Hoje').first().waitFor({ timeout: 8000 });
  await openAttached(again.page);
  await again.page.getByText('Este arquivo não está mais neste computador.').waitFor({ timeout: 5000 });
  await again.app.close();
});

await test('arquivo: cofre perdeu a chave, o que estava aqui é recifrado e o antigo fica guardado', async () => {
  const dir = vault.dir;
  const { app, page } = await launch(dir, { SEKTOR_TEST_VAULT: 'locked' });
  await page.getByText('O cofre do sistema não respondeu').waitFor({ timeout: 5000 });
  await stubOpen(app, vault.backup);
  await page.getByRole('button', { name: 'Restaurar um backup' }).click();
  await page.getByRole('button', { name: 'Restaurar e reiniciar' }).click();
  await page.getByLabel('Senha de recuperação').fill(vault.password);
  const gone = closed(app);
  await page.getByRole('button', { name: 'Restaurar e reiniciar' }).click();
  await gone;
  const again = await launch(dir);
  await again.page.getByText('Hoje').first().waitFor({ timeout: 8000 });
  await stubShell(again.app);
  await openAttached(again.page);
  assert.equal((await openedList(again.app, again.page))[0].text, TEXT);
  const kept = readdirSync(join(dir, 'antes-da-restauracao')).find((f) => f.startsWith('arquivos-'));
  assert.deepEqual(readdirSync(join(dir, 'antes-da-restauracao', kept)), [`${textHash}.sek`]);
  await again.app.close();
});

rmSync(root, { recursive: true, force: true });
rmSync('/tmp/x.html', { force: true });
const failed = results.filter((line) => line.startsWith('FALHA'));
console.log(`\n${results.length - failed.length}/${results.length} ok`);
process.exit(failed.length ? 1 : 0);
