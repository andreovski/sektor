// Calendário ligado ao projeto, editor de notas e pastas, num banco temporário.
// Uso: node e2e/notes-calendar.mjs <pasta-das-fotos>
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';

import { choose } from './fields.mjs';

const shots = resolve(process.argv[2] ?? 'notes-calendar-fotos');
mkdirSync(shots, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'sektor-notas-'));
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

const shot = (name) => page.screenshot({ path: join(shots, `${name}.png`) });
const tab = (name) => page.getByRole('tab', { name }).click();
const go = (route) => page.evaluate((r) => (location.hash = `#${r}`), route);

// O banco é lido e escrito por fora, pelo main: no teste a chave fica em texto na pasta.
const sql = (query, params = []) =>
  app.evaluate(
    (_e, { query, params, dir }) => {
      const { createRequire } = process.getBuiltinModule('node:module');
      const { readFileSync } = process.getBuiltinModule('node:fs');
      const Database = createRequire(`${process.cwd()}/package.json`)('better-sqlite3-multiple-ciphers');
      const db = new Database(`${dir}/sektor.db`);
      db.pragma(`hexkey='${readFileSync(`${dir}/database.key`, 'utf8')}'`);
      const statement = db.prepare(query);
      const result = statement.reader ? statement.all(...params) : statement.run(...params);
      db.close();
      return result;
    },
    { query, params, dir }
  );

// 1. Um calendário só da obra, com um evento, desmarcado na Agenda.
await go('/agenda');
await page.getByRole('button', { name: 'Calendários' }).click();
await page.getByRole('dialog').getByLabel('Nome').fill('Obra');
await page.getByRole('button', { name: 'Criar', exact: true }).click();
await page.getByLabel('Mostrar Obra').waitFor();
await page.keyboard.press('Escape');
await page.getByRole('button', { name: 'Novo evento' }).click();
await page.getByLabel('Título').fill('Concretagem da laje');
await choose(page, page.getByRole('dialog').getByLabel('Calendário'), 'Obra');
await page.getByRole('button', { name: 'Salvar' }).click();
await page.getByRole('dialog').waitFor({ state: 'detached' });
await page.getByRole('button', { name: 'Calendários' }).click();
await page.getByLabel('Mostrar Obra').click();
await page.keyboard.press('Escape');

// 2. Projeto ligado ao calendário pelo Editar.
await go('/projetos');
await page.getByRole('button', { name: 'Novo projeto' }).click();
await page.getByLabel('Nome').fill('Casa da praia');
await page.getByRole('button', { name: 'Criar projeto' }).click();
await page.getByRole('heading', { name: 'Casa da praia' }).waitFor();
check('sem calendário, a agenda do projeto fica vazia', await page.getByText('Nenhum evento ligado a este projeto').isVisible());
await page.getByRole('button', { name: 'Editar', exact: true }).click();
await choose(page, page.getByLabel('Calendário da Agenda'), 'Obra');
await page.getByRole('button', { name: 'Salvar' }).click();
await page.getByRole('button', { name: /Concretagem da laje/ }).waitFor();
check('com calendário, mostra os eventos dele mesmo desmarcado na Agenda', true);
await shot('1-agenda-do-projeto');
await page.getByRole('button', { name: 'Novo evento no projeto' }).click();
check(
  'evento novo vai para o calendário do projeto',
  (await page.getByRole('dialog').getByLabel('Calendário').textContent()) === 'Obra'
);
await page.keyboard.press('Escape');

// 3. Notas: atalhos de Markdown, "/" e o texto guardado em Markdown.
await tab('Notas');
await page.getByRole('button', { name: 'Criar nota' }).click();
const editor = page.getByRole('textbox', { name: 'Texto da nota' });
await editor.waitFor();
await editor.click();
await page.keyboard.type('# Decisões\nFotos **próprias** e *sem pop-up*.\n- Telhado\nPiso\n\n[] Pedir orçamento\n\n');
await page.keyboard.type('/cita');
await page.getByRole('listbox', { name: 'Blocos' }).waitFor();
await shot('2-menu-de-blocos');
await page.keyboard.press('Enter');
await page.keyboard.type('Hospedagem na `Railway` ');
await page.getByRole('status').getByText('Salvo').waitFor();
await page.waitForTimeout(900);
await page.getByRole('status').getByText('Salvo').waitFor();
const [{ body }] = await sql('SELECT body FROM project_notes WHERE deleted_at IS NULL');
console.log(JSON.stringify(body));
check('título vira #', body.startsWith('# Decisões\n'));
check('negrito e itálico', body.includes('**próprias**') && body.includes('*sem pop-up*'));
check('lista', /- Telhado\n- Piso/.test(body));
check('tarefa', body.includes('- [ ] Pedir orçamento'));
check('citação pelo /', body.includes('> Hospedagem na `Railway`'));
await page.getByRole('heading', { name: 'Decisões' }).waitFor();
await shot('3-nota');

// 4. Nota antiga, escrita na caixa de texto: abre formatada e não muda sem edição.
const projectId = (await sql('SELECT id FROM projects WHERE deleted_at IS NULL'))[0].id;
const legacy = 'Ideias soltas\nlinha dois sem linha em branco\n\n## Seção\n1. um\n2. dois\n\n```\ncodigo <b>cru</b>\n```\n<script>alert(1)</script>';
const now = Date.now();
await sql(
  `INSERT INTO project_notes (id, created_at, updated_at, project_id, body) VALUES ('nota-antiga', ?, ?, ?, ?)`,
  [now + 1000, now, projectId, legacy]
);
await page.reload();
await page.getByRole('tablist').waitFor();
await tab('Notas');
await page.getByRole('button', { name: 'Ideias soltas' }).click();
await page.getByRole('heading', { name: 'Seção' }).waitFor();
const text = await page.getByRole('textbox', { name: 'Texto da nota' }).innerText();
check('quebra de linha antiga continua', /Ideias soltas\nlinha dois/.test(text), JSON.stringify(text.slice(0, 40)));
check('HTML fica de fora', (await page.locator('.rich-text script').count()) === 0);
check('código preservado', text.includes('codigo <b>cru</b>'));
await page.waitForTimeout(900);
check(
  'abrir sem editar não reescreve',
  (await sql(`SELECT body FROM project_notes WHERE id = 'nota-antiga'`))[0].body === legacy
);
await shot('4-nota-antiga');

// 5. Pastas.
await page.getByRole('button', { name: 'Nova pasta' }).click();
await page.getByLabel('Nome da pasta').fill('Reuniões');
await page.keyboard.press('Enter');
await page.getByRole('button', { name: 'Reuniões', exact: true }).waitFor();
await page.getByRole('button', { name: 'Reuniões', exact: true }).hover();
await page.getByRole('button', { name: 'Nova nota em Reuniões' }).click();
await page.locator('[aria-current="true"]', { hasText: 'Nota vazia' }).waitFor();
await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Texto da nota');
await page.keyboard.type('Ata da visita');
await page.getByRole('status').getByText('Salvo').waitFor();
await page.waitForTimeout(900);
const inFolder = await sql(
  `SELECT f.name AS folder FROM project_notes n JOIN project_note_folders f ON f.id = n.folder_id WHERE n.body = 'Ata da visita'`
);
check('nota criada dentro da pasta', inFolder[0]?.folder === 'Reuniões');
await page.getByRole('button', { name: 'Decisões' }).click();
await choose(page, page.getByLabel('Pasta da nota'), 'Reuniões');
await page.waitForTimeout(400);
const nav = page.getByRole('navigation', { name: 'Notas do projeto' });
check(
  'mover pela lista de pastas',
  (await sql(`SELECT count(*) AS n FROM project_notes n JOIN project_note_folders f ON f.id = n.folder_id WHERE f.name = 'Reuniões'`))[0].n === 2
);
await shot('5-pastas');
await page.getByRole('button', { name: 'Reuniões', exact: true }).hover();
await page.getByRole('button', { name: 'Renomear pasta' }).click();
await page.getByLabel('Nome da pasta').fill('Atas');
await page.keyboard.press('Enter');
await page.getByRole('button', { name: 'Atas', exact: true }).waitFor();
await page.getByRole('button', { name: 'Atas', exact: true }).hover();
await page.getByRole('button', { name: 'Apagar pasta' }).click();
await page.getByRole('button', { name: 'Apagar pasta' }).last().click();
await page.getByRole('button', { name: 'Atas', exact: true }).waitFor({ state: 'detached' });
check('apagar a pasta mantém as notas', (await sql('SELECT count(*) AS n FROM project_notes WHERE deleted_at IS NULL AND folder_id IS NULL'))[0].n === 3);

// 6. Nota em pop-up: janela sem moldura, por cima de tudo, e o texto volta para o app.
await page.getByRole('button', { name: 'Decisões' }).click();
const popupPromise = app.waitForEvent('window');
await page.getByRole('button', { name: 'Pop-up' }).click();
const popup = await popupPromise;
popup.on('pageerror', (error) => errors.push(`pop-up: ${error.message}`));
await popup.getByRole('heading', { name: 'Decisões' }).waitFor();
const floating = await app.evaluate(({ BrowserWindow }) =>
  BrowserWindow.getAllWindows().map((w) => ({ top: w.isAlwaysOnTop(), url: w.webContents.getURL(), size: w.getSize() }))
);
const popInfo = floating.find((w) => w.url.includes('nota-fixa'));
check('pop-up por cima de tudo', popInfo?.top === true && floating.length === 2, JSON.stringify(popInfo));
await page.getByRole('button', { name: 'Pop-up' }).click();
await page.waitForTimeout(400);
check('abrir de novo não duplica', (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)) === 2);
const popEditor = popup.getByRole('textbox', { name: 'Texto da nota' });
await popEditor.locator('blockquote').click();
await popup.keyboard.press('End');
await popup.keyboard.press('Enter');
await popup.keyboard.press('Enter');
await popup.keyboard.type('Escrito no pop-up');
await popup.getByRole('status').getByText('Salvo').waitFor({ state: 'attached' });
await popup.waitForTimeout(900);
await popup.screenshot({ path: join(shots, '6-pop-up.png') });
await page.evaluate(() => window.dispatchEvent(new Event('focus')));
await page.getByRole('textbox', { name: 'Texto da nota' }).getByText('Escrito no pop-up').waitFor();
check('o app recebe o que foi escrito no pop-up', true);
await popup.getByRole('button', { name: 'Fechar pop-up' }).click();
await page.waitForTimeout(400);
check('fechar o pop-up', (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)) === 1);

// 7. Notas de tarefa num modal: editor rico, "/" funciona dentro do diálogo.
await tab('Tarefas');
await page.getByRole('button', { name: 'Nova tarefa' }).click();
await page.getByLabel('Título').fill('Comprar telhas');
const taskNotes = page.getByRole('dialog').getByRole('textbox', { name: 'Notas' });
await taskNotes.click();
await page.keyboard.type('/tarefas');
await page.getByRole('option', { name: /Lista de tarefas/ }).click();
await page.keyboard.type('Cerâmica');
await shot('7-notas-da-tarefa');
await page.getByRole('button', { name: 'Criar tarefa' }).click();
await page.getByRole('dialog').waitFor({ state: 'detached' });
const [{ notes }] = await sql(`SELECT notes FROM tasks WHERE title = 'Comprar telhas'`);
check('notas da tarefa em Markdown', notes === '- [ ] Cerâmica', JSON.stringify(notes));

const relevant = errors.filter((text) => !/favicon|Failed to load resource/.test(text));
check('sem erro na tela', relevant.length === 0, relevant.join(' | '));
await app.close();
rmSync(dir, { recursive: true, force: true });
process.exit(checks.every(Boolean) ? 0 : 1);
