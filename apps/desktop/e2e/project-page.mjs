// Percorre a página do projeto num banco temporário, com o diálogo e o abrir do sistema trocados.
// Uso: node e2e/project-page.mjs <pasta-das-fotos>
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';

const shots = resolve(process.argv[2] ?? 'project-page-fotos');
mkdirSync(shots, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'sektor-projeto-'));
const samples = mkdtempSync(join(tmpdir(), 'sektor-amostras-'));
const env = { ...process.env, SEKTOR_TEST_DIR: dir };
delete env.ELECTRON_RUN_AS_NODE;

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push(ok);
  console.log(`${ok ? 'ok ' : 'FALHOU'} ${name}${detail ? ` (${detail})` : ''}`);
};

const app = await electron.launch({ args: ['.'], env });
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(800);

// Lê a cópia na hora, como o programa do sistema faria, e guarda o conteúdo para conferir.
await app.evaluate(({ dialog, shell }) => {
  globalThis.nextPick = [];
  globalThis.opened = [];
  globalThis.shown = [];
  const { readFileSync, statSync } = process.getBuiltinModule('node:fs');
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.nextPick });
  Object.defineProperty(shell, 'openPath', {
    configurable: true,
    value: async (path) => {
      globalThis.opened.push({ path, text: readFileSync(path, 'utf8'), mode: statSync(path).mode & 0o777 });
      return '';
    },
  });
  Object.defineProperty(shell, 'showItemInFolder', {
    configurable: true,
    value: (path) => globalThis.shown.push(path),
  });
});
const pick = (paths) => app.evaluate((_e, list) => (globalThis.nextPick = list), paths);
const shot = (name) => page.screenshot({ path: join(shots, `${name}.png`) });
const tab = (name) => page.getByRole('tab', { name }).click();
const go = (route) => page.evaluate((r) => (location.hash = `#${r}`), route);

// Criar abre a página nova.
await go('/projetos');
await page.getByRole('button', { name: 'Novo projeto' }).click();
await page.getByLabel('Nome').fill('Site da Oficina');
await page.getByLabel('Tipo').selectOption('FREELANCE');
await page.getByRole('textbox', { name: 'Início' }).fill('2026-10-20');
await page.getByLabel('Entrega').fill('2026-12-15');
await page.getByLabel('Descrição').fill('Loja nova com catálogo e agenda online.');
await page.getByRole('button', { name: 'Cor green' }).click();
await page.getByRole('button', { name: 'Criar projeto' }).click();
await page.waitForFunction(() => /#\/projetos\/[0-9a-f-]{36}$/.test(location.hash));
check('criar projeto abre /projetos/$id', true, await page.evaluate(() => location.hash));
await page.getByRole('heading', { name: 'Site da Oficina' }).waitFor();
await shot('1-vazio');

// Tarefas.
await tab('Tarefas');
const capture = page.getByLabel('Capturar tarefa');
for (const text of ['Aprovar layout amanhã !alta', 'Escrever textos sexta', 'Separar fotos']) {
  await capture.fill(text);
  await capture.press('Enter');
  await page
    .getByRole('button', { name: new RegExp(`^${text.split(' ').slice(0, 2).join(' ')}`) })
    .waitFor();
}
await page.getByRole('button', { name: 'Nova tarefa' }).click();
await page.getByLabel('Título').fill('Pagar domínio');
await page.getByText('Prazo', { exact: true }).click();
await page.getByLabel('Data do prazo').fill('2026-10-01');
await page.getByRole('button', { name: 'Criar tarefa' }).click();
await page.getByText('Pagar domínio').waitFor();
await shot('2-tarefas');

// Visão geral: concluir e evento ligado.
await tab('Visão geral');
await page.getByRole('checkbox', { name: 'Concluir Separar fotos' }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: 'Novo evento no projeto' }).click();
await page.getByLabel('Título').fill('Reunião com a Oficina');
check(
  'evento novo já vem com o projeto',
  (await page.getByRole('dialog').locator('label', { hasText: /^Projeto/ }).locator('option:checked').textContent()) === 'Site da Oficina'
);
await page.getByRole('button', { name: 'Salvar' }).click();
await page.getByRole('button', { name: /Reunião com a Oficina/ }).waitFor();
await shot('3-visao-geral');
const body = await page.locator('body').innerText();
check('cartões', /25%/.test(body) && /1 de 4/.test(body), 'progresso 1 de 4');
check('atrasada contada', /Atrasadas\s*1/.test(body));
check('prazo ordena', body.indexOf('Pagar domínio') < body.indexOf('Aprovar layout'));

// Kanban: tarefa nova fica no projeto.
await tab('Kanban');
await capture.fill('Publicar site');
await capture.press('Enter');
await page.getByLabel('Publicar site', { exact: true }).waitFor();
await shot('4-kanban');
check('kanban conta tudo', /Kanban\s*5/.test(await page.getByRole('tablist').innerText()));

// Notas.
await tab('Notas');
await page.getByRole('button', { name: 'Criar nota' }).click();
const note = '# Decisões\n\n- Fotos **próprias**\n- Sem *pop-up*\n\nHospedagem na `Railway`.';
await page.getByLabel('Texto da nota').fill(note);
await page.getByRole('status').getByText('Salvo').waitFor();
await page.getByRole('button', { name: 'Fixar' }).click();
await tab('Arquivos');
await tab('Notas');
await page.getByRole('heading', { name: 'Decisões' }).waitFor();
await shot('5-notas');
await page.getByRole('button', { name: 'Editar', exact: true }).last().click();
check('nota salvou sozinha', (await page.getByLabel('Texto da nota').inputValue()) === note);

// Arquivos.
await tab('Arquivos');
const stored = () => {
  try {
    return readdirSync(join(dir, 'arquivos-de-projeto'));
  } catch {
    return [];
  }
};
const content = 'proposta da oficina';
const hash = createHash('sha256').update(content).digest('hex');
await page.evaluate((text) => {
  const data = new DataTransfer();
  data.items.add(new File([text], 'proposta.PDF', { type: 'application/pdf' }));
  const area = document.querySelector('[data-file-drop]');
  for (const type of ['dragover', 'drop']) {
    area.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data }));
  }
}, content);
await page.getByRole('button', { name: 'proposta.PDF', exact: true }).waitFor();
check('arrastar cifra com o nome do hash, sem extensão', stored().includes(`${hash}.sek`), stored().join());
check('texto conhecido não está no disco', !readFileSync(join(dir, 'arquivos-de-projeto', `${hash}.sek`)).includes(content));

const logo = join(samples, 'logo.txt');
writeFileSync(logo, 'logo');
const big = join(samples, 'grande.bin');
writeFileSync(big, Buffer.alloc(25 * 1024 * 1024 + 1));
const copy = join(samples, 'copia.pdf');
writeFileSync(copy, content);
await pick([logo, big, copy]);
await page.getByRole('button', { name: 'Anexar arquivo' }).click();
await page.getByRole('button', { name: 'logo.txt', exact: true }).waitFor();
await page.getByText('grande.bin passa de 25 MB.').waitFor();
await page.getByText('copia.pdf já está neste projeto.').waitFor();
check('botão anexa; 25 MB e repetido recusados', stored().length === 2, stored().length);
check('sem arquivo pela metade', !stored().some((name) => name.endsWith('.tmp')));
await shot('6-arquivos');

await page.getByRole('button', { name: 'proposta.PDF', exact: true }).click();
await page.waitForTimeout(200);
const opened = await app.evaluate(() => globalThis.opened);
check('abre uma cópia decifrada pelo sistema', opened[0]?.text === content, opened[0]?.path);
check('com o nome original, fora da pasta cifrada', opened[0].path.endsWith('/proposta.PDF') && !opened[0].path.includes('arquivos-de-projeto'));
check('cópia somente leitura', opened[0].mode === 0o400, opened[0].mode.toString(8));

const script = join(samples, 'instala.sh');
writeFileSync(script, 'echo oi');
await pick([script]);
await page.getByRole('button', { name: 'Anexar arquivo' }).click();
await page.getByRole('button', { name: 'instala.sh', exact: true }).click();
await page.waitForTimeout(200);
const afterScript = await app.evaluate(() => ({ opened: globalThis.opened.length, shown: globalThis.shown }));
check('executável não abre: só aparece na pasta', afterScript.opened === 1 && afterScript.shown[0]?.endsWith('/instala.sh'));
await page.getByRole('button', { name: 'Remover instala.sh' }).click();
await page.getByRole('button', { name: 'Remover', exact: true }).click();
await page.getByRole('button', { name: 'instala.sh', exact: true }).waitFor({ state: 'detached' });

// Adulterado: nada decifra e a tela diz o motivo.
const sealedPath = join(dir, 'arquivos-de-projeto', `${hash}.sek`);
const good = readFileSync(sealedPath);
const bad = Buffer.from(good);
bad[bad.length - 1] ^= 1;
writeFileSync(sealedPath, bad);
await page.getByRole('button', { name: 'proposta.PDF', exact: true }).click();
await page.getByText('Este arquivo foi alterado ou danificado').waitFor();
writeFileSync(sealedPath, good);
check('adulterado é recusado', (await app.evaluate(() => globalThis.opened.length)) === 1);

await page.getByRole('button', { name: 'Remover logo.txt' }).click();
await page.getByRole('button', { name: 'Remover', exact: true }).click();
await page.getByRole('button', { name: 'logo.txt', exact: true }).waitFor({ state: 'detached' });
await page.waitForTimeout(200);
check('remover tira a cópia', stored().length === 1);
check('contador de arquivos', /Arquivos\s*1/.test(await page.getByRole('tablist').innerText()));

// Abrir pela lista e apagar.
await go('/projetos');
await page.getByRole('heading', { name: 'Site da Oficina' }).click();
await page.getByRole('tablist').waitFor();
check('clicar no projeto abre a página', /#\/projetos\/[0-9a-f-]{36}$/.test(await page.evaluate(() => location.hash)));
await page.getByLabel('Status do projeto').selectOption('PAUSED');
await page.waitForTimeout(300);
await go('/projetos');
await page.getByText('Pausado').first().waitFor();
await shot('7-lista');
await page.getByRole('heading', { name: 'Site da Oficina' }).click();
await page.getByRole('button', { name: 'Editar', exact: true }).click();
await page.getByRole('button', { name: 'Apagar projeto' }).click();
await page.waitForFunction(() => location.hash === '#/projetos');
check('apagar volta à lista', true);

const relevant = errors.filter((text) => !/favicon|Failed to load resource/.test(text));
check('sem erro na tela', relevant.length === 0, relevant.join(' | '));
await app.close();
rmSync(samples, { recursive: true, force: true });
rmSync(dir, { recursive: true, force: true });
process.exit(checks.every(Boolean) ? 0 : 1);
