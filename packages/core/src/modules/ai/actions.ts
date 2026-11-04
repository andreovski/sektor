import { addDays } from '@sektor/finance-engine';
import { tool, type ToolSet } from 'ai';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';

import type { AppCtx } from '../../app';
import { accounts, categories, transactions } from '../../db/schema';
import { AppError, notFound, stamp, todayIn } from '../../services/context';
import { wallInstant } from '../agenda/view';
import { events } from '../agenda/schema';
import { habitChecks, habits } from '../habits/schema';
import { getTask, listTaskLists } from '../tasks/service';

import { askChoice, jevUsable } from './jev';
import { redact } from './redact';
import { aiProposals, type ProposalCard } from './schema';
import { allowedAreas, type Area, readSettings } from './settings';
import { scrubStrings } from './tools';

// A fase 3c: o assistente propõe, a pessoa confirma. As ferramentas daqui só montam a proposta
// (com o antes e o depois) e a guardam; quem grava é `applyProposal`, pelos mesmos métodos do
// RPC que as telas usam. Mudar ou apagar algo que já existe sempre espera a pessoa. Lançamento
// novo pode salvar sozinho quando o Jev confirma conta e categoria com folga, com Desfazer.

/** Acima disto o Jev decide sozinho (o mesmo corte do Jotta). */
export const AUTO_SAVE_SCORE = 0.85;

export type ProposalKind =
  | 'task.create'
  | 'task.complete'
  | 'task.update'
  | 'task.delete'
  | 'event.create'
  | 'event.delete'
  | 'transaction.create'
  | 'transaction.update'
  | 'transaction.delete'
  | 'reminder.create'
  | 'habit.check';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data em AAAA-MM-DD.');
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora em HH:MM.');

const money = (cents: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
const day = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${value}T12:00:00Z`)
  );

const norm = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/** O primeiro cujo nome contém o termo (sem acento nem maiúscula); exato ganha. */
function byName<T>(items: T[], name: (item: T) => string, term: string | undefined) {
  if (!term?.trim()) return null;
  const wanted = norm(term);
  return items.find((i) => norm(name(i)) === wanted) ?? items.find((i) => norm(name(i)).includes(wanted)) ?? null;
}

function categoryList(app: AppCtx) {
  const rows = app.db.select().from(categories).where(isNull(categories.deletedAt)).all();
  const names = new Map(rows.map((c) => [c.id, c.name]));
  return rows.map((c) => ({
    id: c.id,
    kind: c.kind,
    label: c.parentId && names.has(c.parentId) ? `${names.get(c.parentId)} › ${c.name}` : c.name,
  }));
}

function accountList(app: AppCtx) {
  return app.db
    .select({ id: accounts.id, name: accounts.name, type: accounts.type })
    .from(accounts)
    .where(and(isNull(accounts.deletedAt), isNull(accounts.archivedAt)))
    .all();
}

function transactionRow(app: AppCtx, id: string) {
  const row = app.db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), isNull(transactions.deletedAt)))
    .get();
  if (!row) throw notFound('Lançamento não encontrado.');
  return row;
}

/** Parcela, recorrência e pagamento de fatura mexem em mais coisas: só pela tela de Finanças. */
function assertStandalone(tx: ReturnType<typeof transactionRow>) {
  if (tx.recurrenceId || tx.installmentGroupId) {
    throw new AppError(409, 'Esse lançamento faz parte de uma série ou de parcelas; mude pela tela de Finanças.');
  }
  if (tx.paysInvoiceId) throw new AppError(409, 'Esse lançamento paga uma fatura; mude pela tela de Finanças.');
}

interface Ctx {
  app: AppCtx;
  conversationId: string;
  modelId: string;
  allowed(): Area[];
  used(name: string, area: Area | null): void;
  proposed(id: string): void;
  /** O que o Jev confirmou: salva depois que a resposta estiver guardada. */
  autoApply(id: string): void;
  /** O pedido da pessoa, como ela escreveu: é o que o Jev lê. */
  request: string;
}

function save(
  ctx: Ctx,
  kind: ProposalKind,
  area: Area,
  payload: Record<string, unknown>,
  card: ProposalCard,
  before: Record<string, unknown> | null = null
) {
  return ctx.app.db
    .insert(aiProposals)
    .values({ ...stamp(), conversationId: ctx.conversationId, modelId: ctx.modelId, kind, area, payload, before, card, status: 'PENDING' })
    .returning()
    .get();
}

/** O que a ferramenta devolve ao modelo: curto, só para ele dizer "confira e salve". */
const pending = (id: string, card: ProposalCard) => ({
  proposta: id,
  resumo: `${card.kind}: ${card.title}`,
  situacao: 'aguardando a confirmação da pessoa no cartão',
});

const saving = (id: string, card: ProposalCard) => ({
  proposta: id,
  resumo: `${card.kind}: ${card.title}`,
  situacao: 'será salvo sozinho (o Jev conferiu); a pessoa pode desfazer',
});

const KINDS = {
  expense: 'Money spent: a purchase, a bill, a payment for something',
  income: 'Money received: salary, a sale, a refund, a transfer from someone else',
  transfer: "Money moved between the user's own accounts, a deposit into savings or paying a credit card bill",
  event: 'A calendar appointment at a set day and time: a doctor visit, a meeting, a class, a trip, a birthday',
  task: 'Something to do or to be reminded of, not an appointment: a to-do, an errand, a chore',
};

/**
 * A chance de o pedido ser mesmo do tipo proposto, pelo Jev (as mesmas opções do Jotta). Sem o
 * Jev usável, `null`: a proposta espera a pessoa.
 */
async function kindScore(ctx: Ctx, expected: keyof typeof KINDS) {
  if (!jevUsable(ctx.app) || !ctx.request) return null;
  const keys = Object.keys(KINDS) as (keyof typeof KINDS)[];
  const scores = await askChoice(
    ctx.app,
    'assistant.jev',
    { pedido: redact(ctx.request) },
    'The user wrote this request (in Brazilian Portuguese) to an app for personal finance, calendar and to-dos. What does the user want to record?',
    keys.map((k) => KINDS[k]),
    'None of these'
  );
  return scores ? (scores[keys.indexOf(expected)] ?? 0) : null;
}

/**
 * A lista em que a tarefa vai cai com o Jev? Com lista dita, ele precisa apontar a mesma; sem lista,
 * a Entrada ou "não diz" (a chance de não dizer é a sobra das listas).
 */
function listAgreement(scores: number[], chosen: number, named: boolean) {
  if (chosen < 0) return null;
  const best = Math.max(...scores);
  if (named) return scores[chosen] === best ? (scores[chosen] ?? 0) : 0;
  const none = Math.max(0, 1 - scores.reduce((sum, p) => sum + p, 0));
  return Math.max(none, scores[chosen] ?? 0);
}

export function buildActionTools(ctx: Ctx): ToolSet {
  const { app } = ctx;
  const defs: Record<string, { area: Area; make: () => unknown }> = {
    propor_tarefa: {
      area: 'tasks',
      make: () =>
        tool({
          description:
            'Propõe criar uma tarefa. Não grava: a pessoa confirma num cartão. Use quando pedirem para anotar, lembrar de fazer ou criar uma tarefa.',
          inputSchema: z.object({
            titulo: z.string().min(1).max(300),
            prazo: date.optional(),
            hora: clock.optional(),
            lista: z.string().max(80).optional().describe('Nome da lista ou do projeto; sem ele, vai para a Entrada'),
            notas: z.string().max(2000).optional(),
          }),
          execute: async ({ titulo, prazo, hora, lista, notas }) => {
            const lists = listTaskLists(app);
            const place = lista ? byName(lists, (l) => l.project?.name ?? l.name, lista) : null;
            if (lista && !place) return { erro: `Não achei a lista ou o projeto "${lista}".` };
            const inbox = lists.find((l) => l.isInbox);
            const payload = {
              title: titulo,
              ...(place ? { listId: place.id } : {}),
              ...(prazo ? { dueDate: prazo } : {}),
              ...(prazo && hora ? { dueTime: hora } : {}),
              ...(notas ? { notes: notas } : {}),
            };
            const card: ProposalCard = {
              kind: 'Tarefa',
              title: titulo,
              rows: [
                { label: place?.project ? 'Projeto' : 'Lista', value: place?.project?.name ?? place?.name ?? inbox?.name ?? 'Entrada' },
                { label: 'Prazo', value: prazo ? `${day(prazo)}${hora ? ` às ${hora}` : ''}` : 'Sem prazo' },
                ...(notas ? [{ label: 'Notas', value: notas }] : []),
              ],
            };
            const row = save(ctx, 'task.create', 'tasks', payload, card);
            ctx.proposed(row.id);
            // O Jev confere se é tarefa mesmo e em que lista; seguro nos dois, salva sozinho.
            const listNames = lists.map((l) => l.project?.name ?? l.name);
            const [kind, listScores] = await Promise.all([
              kindScore(ctx, 'task'),
              askChoice(app, 'assistant.jev', { pedido: redact(ctx.request) }, 'Which of the user to-do lists does this task belong to?', listNames, 'The request does not say which list'),
            ]);
            const listOk = listScores ? listAgreement(listScores, lists.indexOf(place ?? inbox!), Boolean(place)) : null;
            if (kind !== null && listOk !== null && Math.min(kind, listOk) >= AUTO_SAVE_SCORE) {
              ctx.autoApply(row.id);
              return saving(row.id, card);
            }
            return pending(row.id, card);
          },
        }),
    },
    propor_concluir_tarefa: {
      area: 'tasks',
      make: () =>
        tool({
          description: 'Propõe marcar uma tarefa como feita. Use o id que a consulta de tarefas devolveu.',
          inputSchema: z.object({ id: z.string().min(1) }),
          execute: async ({ id }) => {
            const task = getTask(app, id);
            if (task.completedAt) return { erro: 'Essa tarefa já está concluída.' };
            const card: ProposalCard = { kind: 'Concluir tarefa', title: task.title, rows: [{ label: 'Prazo', value: task.dueDate ? day(task.dueDate) : 'Sem prazo' }] };
            const row = save(ctx, 'task.complete', 'tasks', { id }, card, { status: task.status });
            ctx.proposed(row.id);
            return pending(row.id, card);
          },
        }),
    },
    propor_mudar_tarefa: {
      area: 'tasks',
      make: () =>
        tool({
          description: 'Propõe mudar o título ou o prazo de uma tarefa. Use o id da consulta de tarefas.',
          inputSchema: z.object({
            id: z.string().min(1),
            titulo: z.string().min(1).max(300).optional(),
            prazo: date.nullable().optional().describe('null tira o prazo'),
            hora: clock.nullable().optional(),
          }),
          execute: async ({ id, titulo, prazo, hora }) => {
            const task = getTask(app, id);
            const changes: Record<string, unknown> = {};
            const rows: ProposalCard['rows'] = [];
            if (titulo && titulo !== task.title) {
              changes.title = titulo;
              rows.push({ label: 'Título', value: titulo, before: task.title });
            }
            if (prazo !== undefined && prazo !== task.dueDate) {
              changes.dueDate = prazo;
              if (!prazo) changes.dueTime = null;
              rows.push({ label: 'Prazo', value: prazo ? day(prazo) : 'Sem prazo', before: task.dueDate ? day(task.dueDate) : 'Sem prazo' });
            }
            const willHaveDate = prazo !== undefined ? prazo : task.dueDate;
            if (hora && !willHaveDate) return { erro: 'Hora precisa de um prazo; diga o dia também.' };
            if (hora !== undefined && hora !== task.dueTime) {
              changes.dueTime = hora;
              rows.push({ label: 'Hora', value: hora ?? 'Sem hora', before: task.dueTime ?? 'Sem hora' });
            }
            if (!rows.length) return { erro: 'Nada muda nessa tarefa.' };
            const before = { title: task.title, dueDate: task.dueDate, dueTime: task.dueTime };
            const card: ProposalCard = { kind: 'Mudar tarefa', title: task.title, rows };
            const row = save(ctx, 'task.update', 'tasks', { id, ...changes }, card, before);
            ctx.proposed(row.id);
            return pending(row.id, card);
          },
        }),
    },
    propor_evento: {
      area: 'agenda',
      make: () =>
        tool({
          description: 'Propõe criar um compromisso na agenda. Sem hora, é de dia inteiro. Sem fim, dura 1 hora.',
          inputSchema: z.object({
            titulo: z.string().min(1).max(200),
            dia: date,
            inicio: clock.optional(),
            fim: clock.optional(),
            local: z.string().max(300).optional(),
          }),
          execute: async ({ titulo, dia, inicio, fim, local }) => {
            if (fim && !inicio) return { erro: 'Diga também a hora de início.' };
            if (inicio && fim && fim <= inicio) return { erro: 'O fim precisa ser depois do início.' };
            const allDay = !inicio;
            const start = allDay ? `${dia}T00:00:00.000Z` : wallInstant(dia, inicio, app.timeZone).toISOString();
            const endTime = fim ?? (inicio ? `${String((Number(inicio.slice(0, 2)) + 1) % 24).padStart(2, '0')}${inicio.slice(2)}` : null);
            const end = allDay
              ? `${addDays(dia, 1)}T00:00:00.000Z`
              : wallInstant(endTime! < inicio! ? addDays(dia, 1) : dia, endTime!, app.timeZone).toISOString();
            const payload = { title: titulo, allDay, startAt: start, endAt: end, ...(local ? { location: local } : {}) };
            const card: ProposalCard = {
              kind: 'Evento',
              title: titulo,
              rows: [
                { label: 'Quando', value: allDay ? `${day(dia)}, dia inteiro` : `${day(dia)}, ${inicio} às ${endTime}` },
                ...(local ? [{ label: 'Local', value: local }] : []),
              ],
            };
            const row = save(ctx, 'event.create', 'agenda', payload, card);
            ctx.proposed(row.id);
            const kind = await kindScore(ctx, 'event');
            if (kind !== null && kind >= AUTO_SAVE_SCORE) {
              ctx.autoApply(row.id);
              return saving(row.id, card);
            }
            return pending(row.id, card);
          },
        }),
    },
    propor_lancamento: {
      area: 'finance',
      make: () =>
        tool({
          description:
            'Propõe registrar um gasto ou uma entrada de dinheiro já acontecido. Valor em centavos inteiros. Conta e categoria pelo nome; sem elas, a pessoa escolhe no cartão.',
          inputSchema: z.object({
            tipo: z.enum(['gasto', 'entrada']),
            valorCentavos: z.number().int().positive(),
            descricao: z.string().min(1).max(120),
            dia: date.optional().describe('Sem dia, hoje'),
            conta: z.string().max(80).optional(),
            categoria: z.string().max(80).optional(),
          }),
          execute: async ({ tipo, valorCentavos, descricao, dia, conta, categoria }) => {
            const kind = tipo === 'entrada' ? 'INCOME' : 'EXPENSE';
            const allAccounts = accountList(app).filter((a) => a.type !== 'CREDIT_CARD' || kind === 'EXPENSE');
            const allCategories = categoryList(app).filter((c) => c.kind === kind);
            let account = byName(allAccounts, (a) => a.name, conta);
            let category = byName(allCategories, (c) => c.label, categoria);
            let confidence: number | null = null;
            // O Jev confere conta e categoria; os dois seguros e completos, salva sozinho.
            if (jevUsable(app) && allAccounts.length && allCategories.length) {
              const text = redact(`${tipo === 'entrada' ? 'Entrada' : 'Gasto'} de ${money(valorCentavos)}: ${descricao}${conta ? ` (conta: ${conta})` : ''}`);
              const [accScores, catScores] = await Promise.all([
                askChoice(app, 'assistant.jev', { pedido: text }, 'Which of the user accounts or cards does this money come out of (or go into)?', allAccounts.map((a) => a.name), 'The request does not say which account'),
                askChoice(app, 'assistant.jev', { pedido: text }, 'Which budget category fits this transaction best?', allCategories.map((c) => c.label), 'None of these categories fits'),
              ]);
              const top = (scores: number[] | null) => {
                if (!scores?.length) return null;
                const best = Math.max(...scores);
                return { index: scores.indexOf(best), score: best };
              };
              const acc = top(accScores);
              const cat = top(catScores);
              const kindChance = await kindScore(ctx, kind === 'INCOME' ? 'income' : 'expense');
              if (acc && cat && kindChance !== null && kindChance >= AUTO_SAVE_SCORE) {
                account = account ?? (acc.score >= AUTO_SAVE_SCORE ? allAccounts[acc.index]! : null);
                category = category ?? (cat.score >= AUTO_SAVE_SCORE ? allCategories[cat.index]! : null);
                const agreed =
                  account?.id === allAccounts[acc.index]?.id && category?.id === allCategories[cat.index]?.id;
                confidence = agreed ? Math.min(acc.score, cat.score) : null;
              }
            }
            const when = dia ?? todayIn(app);
            const payload = {
              kind,
              amountCents: valorCentavos,
              description: descricao,
              date: when,
              status: 'DONE',
              ...(account ? { accountId: account.id } : {}),
              ...(category ? { categoryId: category.id } : {}),
            };
            const card: ProposalCard = {
              kind: `Lançamento · ${kind === 'INCOME' ? 'Receita' : 'Despesa'}`,
              title: descricao,
              amountCents: valorCentavos,
              amountTone: kind === 'INCOME' ? 'income' : 'expense',
              rows: [
                { label: 'Categoria', value: category?.label ?? 'Escolha antes de salvar' },
                { label: 'Conta', value: account?.name ?? 'Escolha antes de salvar' },
                { label: 'Data', value: day(when) },
              ],
            };
            const row = save(ctx, 'transaction.create', 'finance', payload, card);
            ctx.proposed(row.id);
            if (account && category && confidence !== null && confidence >= AUTO_SAVE_SCORE) {
              ctx.autoApply(row.id);
              return saving(row.id, card);
            }
            return pending(row.id, card);
          },
        }),
    },
    propor_mudar_lancamento: {
      area: 'finance',
      make: () =>
        tool({
          description: 'Propõe mudar valor, descrição, data ou categoria de um lançamento. Use o id da consulta de lançamentos.',
          inputSchema: z.object({
            id: z.string().min(1),
            valorCentavos: z.number().int().positive().optional(),
            descricao: z.string().min(1).max(120).optional(),
            dia: date.optional(),
            categoria: z.string().max(80).optional(),
          }),
          execute: async ({ id, valorCentavos, descricao, dia, categoria }) => {
            const tx = transactionRow(app, id);
            assertStandalone(tx);
            const labels = categoryList(app);
            const labelOf = (cid: string | null) => labels.find((c) => c.id === cid)?.label ?? 'Sem categoria';
            const changes: Record<string, unknown> = {};
            const rows: ProposalCard['rows'] = [];
            if (valorCentavos && valorCentavos !== tx.amountCents) {
              changes.amountCents = valorCentavos;
              rows.push({ label: 'Valor', value: money(valorCentavos), before: money(tx.amountCents) });
            }
            if (descricao && descricao !== tx.description) {
              changes.description = descricao;
              rows.push({ label: 'Descrição', value: descricao, before: tx.description });
            }
            if (dia && dia !== tx.date) {
              changes.date = dia;
              rows.push({ label: 'Data', value: day(dia), before: day(tx.date) });
            }
            if (categoria) {
              const found = byName(labels.filter((c) => c.kind === tx.kind), (c) => c.label, categoria);
              if (!found) return { erro: `Não achei a categoria "${categoria}".` };
              if (found.id !== tx.categoryId) {
                changes.categoryId = found.id;
                rows.push({ label: 'Categoria', value: found.label, before: labelOf(tx.categoryId) });
              }
            }
            if (!rows.length) return { erro: 'Nada muda nesse lançamento.' };
            const before = { amountCents: tx.amountCents, description: tx.description, date: tx.date, categoryId: tx.categoryId };
            const card: ProposalCard = { kind: 'Mudar lançamento', title: tx.description, rows };
            const row = save(ctx, 'transaction.update', 'finance', { id, ...changes }, card, before);
            ctx.proposed(row.id);
            return pending(row.id, card);
          },
        }),
    },
    propor_apagar: {
      area: 'tasks',
      make: () =>
        tool({
          description: 'Propõe apagar uma tarefa, um evento ou um lançamento, pelo id que a consulta devolveu. Apagar não tem desfazer.',
          inputSchema: z.object({ tipo: z.enum(['tarefa', 'evento', 'lancamento']), id: z.string().min(1) }),
          execute: async ({ tipo, id }) => {
            const area: Area = tipo === 'tarefa' ? 'tasks' : tipo === 'evento' ? 'agenda' : 'finance';
            if (!ctx.allowed().includes(area)) return { erro: 'Essa área está desligada para a IA.' };
            ctx.used('propor_apagar', area);
            let card: ProposalCard;
            let kind: ProposalKind;
            if (tipo === 'tarefa') {
              const task = getTask(app, id);
              card = { kind: 'Apagar tarefa', title: task.title, rows: [{ label: 'Prazo', value: task.dueDate ? day(task.dueDate) : 'Sem prazo' }] };
              kind = 'task.delete';
            } else if (tipo === 'evento') {
              const event = app.db.select().from(events).where(and(eq(events.id, id), isNull(events.deletedAt))).get();
              if (!event) return { erro: 'Evento não encontrado.' };
              if (event.rrule) return { erro: 'Esse evento se repete; apague pela Agenda para escolher qual parte.' };
              const when = event.allDay ? day(event.startDate!) : new Date(event.startAt!).toLocaleString('pt-BR', { timeZone: app.timeZone, dateStyle: 'short', timeStyle: 'short' });
              card = { kind: 'Apagar evento', title: event.title, rows: [{ label: 'Quando', value: when }] };
              kind = 'event.delete';
            } else {
              const tx = transactionRow(app, id);
              assertStandalone(tx);
              card = { kind: 'Apagar lançamento', title: tx.description, amountCents: tx.amountCents, amountTone: tx.kind === 'INCOME' ? 'income' : 'expense', rows: [{ label: 'Data', value: day(tx.date) }] };
              kind = 'transaction.delete';
            }
            const row = save(ctx, kind, area, { id }, card);
            ctx.proposed(row.id);
            return pending(row.id, card);
          },
        }),
    },
    propor_lembrete: {
      area: 'tasks',
      make: () =>
        tool({
          description: 'Propõe um lembrete único, que avisa no dia e na hora pedidos.',
          inputSchema: z.object({ texto: z.string().min(1).max(200), dia: date, hora: clock }),
          execute: async ({ texto, dia, hora }) => {
            const payload = { title: texto, schedule: 'ONCE', startDate: dia, time: hora };
            const card: ProposalCard = { kind: 'Lembrete', title: texto, rows: [{ label: 'Quando', value: `${day(dia)} às ${hora}` }] };
            const row = save(ctx, 'reminder.create', 'tasks', payload, card);
            ctx.proposed(row.id);
            return pending(row.id, card);
          },
        }),
    },
    propor_habito_feito: {
      area: 'habits',
      make: () =>
        tool({
          description: 'Propõe marcar um hábito como feito num dia (sem dia, hoje).',
          inputSchema: z.object({ habito: z.string().min(1).max(80), dia: date.optional() }),
          execute: async ({ habito, dia }) => {
            const list = app.db.select({ id: habits.id, name: habits.name }).from(habits).where(isNull(habits.deletedAt)).all();
            const found = byName(list, (h) => h.name, habito);
            if (!found) return { erro: `Não achei o hábito "${habito}".` };
            const when = dia ?? todayIn(app);
            const done = app.db
              .select({ id: habitChecks.id })
              .from(habitChecks)
              .where(and(eq(habitChecks.habitId, found.id), eq(habitChecks.date, when), isNull(habitChecks.deletedAt)))
              .get();
            if (done) return { erro: 'Esse hábito já está marcado nesse dia.' };
            const card: ProposalCard = { kind: 'Hábito feito', title: found.name, rows: [{ label: 'Dia', value: day(when) }] };
            const row = save(ctx, 'habit.check', 'habits', { id: found.id, date: when }, card);
            ctx.proposed(row.id);
            return pending(row.id, card);
          },
        }),
    },
  };

  const allowed = ctx.allowed();
  const set: ToolSet = {};
  for (const [name, def] of Object.entries(defs)) {
    // "Apagar" confere a área do que apaga lá dentro; as outras, a sua.
    if (name !== 'propor_apagar' && !allowed.includes(def.area)) continue;
    const base = def.make() as ToolSet[string];
    set[name] = {
      ...base,
      execute: async (input: unknown, options: unknown) => {
        if (name !== 'propor_apagar' && !ctx.allowed().includes(def.area)) {
          return { erro: 'Essa área foi desligada para a IA.' };
        }
        if (name !== 'propor_apagar') ctx.used(name, def.area);
        try {
          return scrubStrings(await (base.execute as (i: unknown, o: unknown) => unknown)(input, options));
        } catch (error) {
          return { erro: error instanceof AppError ? error.message : 'Não consegui montar essa proposta.' };
        }
      },
    } as ToolSet[string];
  }
  return set;
}

function own(app: AppCtx, id: string) {
  const row = app.db.select().from(aiProposals).where(and(eq(aiProposals.id, id), isNull(aiProposals.deletedAt))).get();
  if (!row) throw notFound('Proposta não encontrada.');
  return row;
}

function rpc(app: AppCtx) {
  if (!app.rpc) throw new AppError(500, 'O app não está pronto para gravar.');
  return app.rpc;
}

const CREATE_METHOD: Partial<Record<ProposalKind, string>> = {
  'task.create': 'tasks.create',
  'event.create': 'events.create',
  'transaction.create': 'transactions.create',
  'reminder.create': 'reminders.create',
};
const DELETE_METHOD: Partial<Record<ProposalKind, string>> = {
  'task.create': 'tasks.delete',
  'event.create': 'events.delete',
  'transaction.create': 'transactions.delete',
  'reminder.create': 'reminders.delete',
};

/**
 * Grava a proposta pelos métodos do RPC. `overrides` são as escolhas que a pessoa fez no cartão
 * (conta e categoria de um lançamento). Só uma vez: proposta já resolvida não grava de novo.
 */
export async function applyProposal(
  app: AppCtx,
  id: string,
  options: { auto?: boolean; overrides?: Record<string, unknown> } = {}
) {
  const row = own(app, id);
  if (row.status !== 'PENDING') throw new AppError(409, 'Essa proposta já foi resolvida.');
  assertAreaOpen(app, row);
  const kind = row.kind as ProposalKind;
  const payload = { ...row.payload, ...pick(kind, options.overrides) };
  if (kind === 'transaction.create' && (!payload.accountId || !payload.categoryId)) {
    throw new AppError(400, 'Escolha a conta e a categoria no cartão.');
  }
  // Reserva antes de gravar: dois cliques não gravam duas vezes.
  const claimed = app.db
    .update(aiProposals)
    .set({ status: 'APPLYING', updatedAt: Date.now() })
    .where(and(eq(aiProposals.id, id), eq(aiProposals.status, 'PENDING')))
    .run();
  if (claimed.changes === 0) throw new AppError(409, 'Essa proposta já foi resolvida.');
  const call = rpc(app);
  let result: Record<string, unknown> | null = null;
  // O antes é lido agora, na hora de gravar, só dos campos que mudam.
  let before = row.before;
  try {
    if (CREATE_METHOD[kind]) {
      const created = (await call(CREATE_METHOD[kind]!, payload)) as { id: string } | { id: string }[];
      result = { id: Array.isArray(created) ? created[0]!.id : created.id };
    } else if (kind === 'task.complete') {
      const task = getTask(app, payload.id as string);
      if (task.completedAt) throw new AppError(409, 'Essa tarefa já está concluída.');
      before = { status: task.status };
      await call('tasks.complete', payload);
    } else if (kind === 'task.update') {
      const task = getTask(app, payload.id as string) as unknown as Record<string, unknown>;
      before = Object.fromEntries(Object.keys(payload).filter((k) => k !== 'id').map((k) => [k, task[k] ?? null]));
      await call('tasks.update', payload);
    } else if (kind === 'task.delete') await call('tasks.delete', payload);
    else if (kind === 'event.delete') await call('events.delete', { ...payload, scope: 'all' });
    else if (kind === 'transaction.update') {
      const tx = transactionRow(app, payload.id as string);
      assertStandalone(tx);
      const current = tx as unknown as Record<string, unknown>;
      before = Object.fromEntries(Object.keys(payload).filter((k) => k !== 'id').map((k) => [k, current[k] ?? null]));
      await call('transactions.update', payload);
    } else if (kind === 'transaction.delete') {
      assertStandalone(transactionRow(app, payload.id as string));
      await call('transactions.delete', payload);
    } else if (kind === 'habit.check') {
      if (habitDone(app, payload.id as string, payload.date as string)) {
        throw new AppError(409, 'Esse hábito já está marcado nesse dia.');
      }
      await call('habits.toggle', payload);
    }
  } catch (error) {
    const message = error instanceof AppError ? error.message : 'Não consegui salvar.';
    // Erro de validação deixa a proposta aberta para tentar de novo; o resto é falha.
    const retry = error instanceof AppError && error.status === 400;
    app.db
      .update(aiProposals)
      .set({ status: retry ? 'PENDING' : 'FAILED', error: retry ? null : message, updatedAt: Date.now() })
      .where(eq(aiProposals.id, id))
      .run();
    throw error instanceof AppError ? error : new AppError(500, message);
  }
  app.db
    .update(aiProposals)
    .set({
      status: 'APPLIED',
      payload,
      before,
      card: cardAfter(app, row.card, kind, payload),
      result,
      auto: Boolean(options.auto),
      updatedAt: Date.now(),
    })
    .where(eq(aiProposals.id, id))
    .run();
  return proposalView(own(app, id));
}

/** O cartão salvo mostra a conta e a categoria escolhidas, não "Escolha antes de salvar". */
function cardAfter(app: AppCtx, card: ProposalCard, kind: ProposalKind, payload: Record<string, unknown>) {
  if (kind !== 'transaction.create') return card;
  const account = accountList(app).find((a) => a.id === payload.accountId)?.name;
  const category = categoryList(app).find((c) => c.id === payload.categoryId)?.label;
  return {
    ...card,
    rows: card.rows.map((r) =>
      r.label === 'Conta' && account ? { ...r, value: account } : r.label === 'Categoria' && category ? { ...r, value: category } : r
    ),
  };
}

function habitDone(app: AppCtx, habitId: string, date: string) {
  return Boolean(
    app.db
      .select({ id: habitChecks.id })
      .from(habitChecks)
      .where(and(eq(habitChecks.habitId, habitId), eq(habitChecks.date, date), isNull(habitChecks.deletedAt)))
      .get()
  );
}

/** Área desligada para o modelo que propôs não grava nem desfaz. */
function assertAreaOpen(app: AppCtx, row: typeof aiProposals.$inferSelect) {
  const settings = readSettings(app);
  const config = settings.models.find((m) => m.id === row.modelId) ?? null;
  if (!allowedAreas(settings, config).includes(row.area as Area)) {
    throw new AppError(403, 'Essa área está desligada para a IA em Ajustes › IA.');
  }
}

/** No cartão a pessoa só troca conta e categoria do lançamento; o resto é o que foi proposto. */
function pick(kind: ProposalKind, overrides: Record<string, unknown> | undefined) {
  if (!overrides || kind !== 'transaction.create') return {};
  const out: Record<string, unknown> = {};
  if (typeof overrides.accountId === 'string') out.accountId = overrides.accountId;
  if (typeof overrides.categoryId === 'string') out.categoryId = overrides.categoryId;
  return out;
}

export function discardProposal(app: AppCtx, id: string) {
  const row = own(app, id);
  if (row.status !== 'PENDING') throw new AppError(409, 'Essa proposta já foi resolvida.');
  app.db.update(aiProposals).set({ status: 'DISCARDED', updatedAt: Date.now() }).where(eq(aiProposals.id, id)).run();
  return proposalView(own(app, id));
}

/** Desfaz o que foi salvo. Apagar não tem volta, como no Jotta. */
export async function undoProposal(app: AppCtx, id: string) {
  const row = own(app, id);
  if (row.status !== 'APPLIED') throw new AppError(409, 'Só dá para desfazer o que foi salvo.');
  assertAreaOpen(app, row);
  const kind = row.kind as ProposalKind;
  if (kind.endsWith('.delete')) throw new AppError(409, 'Apagar não tem desfazer.');
  const claimed = app.db
    .update(aiProposals)
    .set({ status: 'APPLYING', updatedAt: Date.now() })
    .where(and(eq(aiProposals.id, id), eq(aiProposals.status, 'APPLIED')))
    .run();
  if (claimed.changes === 0) throw new AppError(409, 'Só dá para desfazer o que foi salvo.');
  const call = rpc(app);
  try {
    if (DELETE_METHOD[kind]) {
      const created = row.result?.id;
      if (typeof created !== 'string') throw new AppError(409, 'Não sei o que foi criado.');
      await call(DELETE_METHOD[kind]!, kind === 'event.create' ? { id: created, scope: 'all' } : { id: created });
    } else if (kind === 'task.complete') {
      await call('tasks.reopen', { id: row.payload.id, ...(row.before?.status ? { status: row.before.status } : {}) });
    } else if (kind === 'task.update') await call('tasks.update', { id: row.payload.id, ...row.before });
    else if (kind === 'transaction.update') await call('transactions.update', { id: row.payload.id, ...row.before });
    else if (kind === 'habit.check') {
      // Só desmarca se ainda está marcado: desmarcado na tela, não volta a marcar.
      if (habitDone(app, row.payload.id as string, row.payload.date as string)) await call('habits.toggle', row.payload);
    }
  } catch (error) {
    app.db.update(aiProposals).set({ status: 'APPLIED', updatedAt: Date.now() }).where(eq(aiProposals.id, id)).run();
    throw error instanceof AppError ? error : new AppError(500, 'Não consegui desfazer.');
  }
  app.db.update(aiProposals).set({ status: 'UNDONE', updatedAt: Date.now() }).where(eq(aiProposals.id, id)).run();
  return proposalView(own(app, id));
}

export function proposalView(row: typeof aiProposals.$inferSelect) {
  const kind = row.kind as ProposalKind;
  return {
    id: row.id,
    kind,
    card: row.card,
    status: row.status,
    auto: row.auto,
    error: row.error,
    undoable: row.status === 'APPLIED' && !kind.endsWith('.delete'),
    /** Lançamento sem conta ou categoria: o cartão pede para escolher. */
    needs: kind === 'transaction.create' && row.status === 'PENDING'
      ? { account: !row.payload.accountId, category: !row.payload.categoryId, kind: row.payload.kind as string }
      : null,
    link: kind.startsWith('task') || kind === 'reminder.create' ? '/tarefas' : kind.startsWith('event') ? '/agenda' : kind.startsWith('transaction') ? '/financas' : '/habitos',
  };
}

export function proposalsOf(app: AppCtx, messageIds: string[]) {
  if (!messageIds.length) return new Map<string, ReturnType<typeof proposalView>[]>();
  const rows = app.db
    .select()
    .from(aiProposals)
    .where(and(inArray(aiProposals.messageId, messageIds), isNull(aiProposals.deletedAt)))
    .all();
  const out = new Map<string, ReturnType<typeof proposalView>[]>();
  for (const row of rows) {
    const list = out.get(row.messageId!) ?? [];
    list.push(proposalView(row));
    out.set(row.messageId!, list);
  }
  return out;
}

