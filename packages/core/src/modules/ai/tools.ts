import { addDays } from '@sektor/finance-engine';
import { tool, type ToolSet } from 'ai';
import { and, between, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { AppCtx } from '../../app';
import { categories, transactions } from '../../db/schema';
import { calendars } from '../agenda/schema';
import { todayIn } from '../../services/context';
import { listAccounts, listDueInvoices } from '../../services/finance';
import { budgetStatuses } from '../../services/reports';
import { listOccurrences } from '../agenda/service';
import { secondsByDay } from '../focus/service';
import { listGoals } from '../goals/service';
import { habitChecks, habits } from '../habits/schema';
import { listDiary } from '../health/service';
import { healthDays } from '../health/schema';
import { reviews } from '../review/schema';
import { listProjects, listTasks } from '../tasks/service';

import { redact } from './redact';
import { type Area } from './settings';

// As consultas que o assistente pode fazer: só leitura, uma área cada. Quem chama oferece ao
// modelo só as das áreas liberadas, e cada uma confere de novo na hora de rodar.

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data em AAAA-MM-DD.');
const range = {
  de: date.describe('Primeiro dia, AAAA-MM-DD'),
  ate: date.describe('Último dia, AAAA-MM-DD, inclusive'),
};
/** Dinheiro sai em centavos; o modelo escreve [[centavos]] e a tela formata. */
const cents = (value: number) => Math.round(value);
const MAX_CHARS = 12000;
const MAX_DAYS = 400;

interface Ctx {
  app: AppCtx;
  /** Áreas que podem ser lidas nesta chamada, lidas de novo a cada consulta. */
  allowed(): Area[];
  /** Anota cada consulta feita, para a tela mostrar. */
  used(name: string, area: Area | null): void;
}

function categoryLabels(app: AppCtx) {
  const rows = app.db
    .select({ id: categories.id, name: categories.name, parentId: categories.parentId, kind: categories.kind })
    .from(categories)
    .where(isNull(categories.deletedAt))
    .all();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const label = (id: string | null) => {
    const row = id ? byId.get(id) : undefined;
    if (!row) return 'Sem categoria';
    const parent = row.parentId ? byId.get(row.parentId) : undefined;
    return parent ? `${parent.name} › ${row.name}` : row.name;
  };
  return { rows, label };
}

/** Limpa CPF, cartão e afins dos textos que voltam ao modelo; número fica como está. */
function scrubStrings(value: unknown): unknown {
  if (typeof value === 'string') return redact(value);
  if (typeof value === 'number') return Number.isInteger(value) ? value : Math.round(value * 1000) / 1000;
  if (Array.isArray(value)) return value.map(scrubStrings);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubStrings(v)]));
  }
  return value;
}

function clean(value: unknown) {
  const cleaned = scrubStrings(value);
  if (JSON.stringify(cleaned).length <= MAX_CHARS) return cleaned;
  return { erro: 'Resultado grande demais. Peça um período menor ou um filtro.' };
}

/** Data e hora no fuso da pessoa, como ela lê. */
function localTime(app: AppCtx, iso: string) {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: app.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
  return parts.replace(' ', ' às ');
}

const localDay = (app: AppCtx, ms: number) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: app.timeZone }).format(new Date(ms));

function checkRange(de: string, ate: string) {
  if (ate < de) return 'A data final vem antes da inicial.';
  if (addDays(de, MAX_DAYS) < ate) return `Use até ${MAX_DAYS} dias por consulta.`;
  return null;
}

export const TOOL_LABELS: Record<string, string> = {
  hoje: 'data de hoje',
  saldos: 'saldos das contas',
  gastos_por_categoria: 'gastos por categoria',
  lancamentos: 'lançamentos',
  faturas: 'faturas a pagar',
  orcamentos: 'orçamentos',
  tarefas: 'tarefas',
  projetos: 'projetos',
  metas: 'metas',
  eventos: 'agenda',
  habitos: 'hábitos',
  foco: 'foco',
  saude: 'saúde',
  diario: 'diário',
};

export function buildTools(ctx: Ctx): ToolSet {
  const { app } = ctx;
  // Cada `tool()` tem o tipo da sua entrada; aqui só importa que é uma ferramenta.
  const defs: Record<string, { area: Area | null; make: () => unknown }> = {
    hoje: {
      area: null,
      make: () =>
        tool({
          description: 'A data de hoje e o dia da semana, no fuso da pessoa.',
          inputSchema: z.object({}),
          execute: async () => {
            const today = todayIn(app);
            const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'UTC' }).format(
              new Date(`${today}T12:00:00Z`)
            );
            return { hoje: today, diaDaSemana: weekday };
          },
        }),
    },
    saldos: {
      area: 'finance',
      make: () =>
        tool({
          description: 'Saldo atual de cada conta e cartão (cartão: o que se deve e a fatura aberta).',
          inputSchema: z.object({}),
          execute: async () =>
            listAccounts(app).map((a) => ({
              conta: a.name,
              tipo: a.type,
              saldoCentavos: cents(a.balanceCents),
              faturaAbertaCentavos: a.openInvoiceCents,
            })),
        }),
    },
    gastos_por_categoria: {
      area: 'finance',
      make: () =>
        tool({
          description:
            'Total gasto (ou recebido) por categoria num período, só lançamentos efetivados. Use para "quanto gastei com X".',
          inputSchema: z.object({ ...range, tipo: z.enum(['gastos', 'entradas']).default('gastos') }),
          execute: async ({ de, ate, tipo }) => {
            const problem = checkRange(de, ate);
            if (problem) return { erro: problem };
            const { label } = categoryLabels(app);
            const kind = tipo === 'entradas' ? 'INCOME' : 'EXPENSE';
            const rows = app.db.all<{ categoryId: string | null; total: number; count: number }>(
              sql`SELECT category_id AS categoryId, SUM(amount_cents) AS total, COUNT(*) AS count
                  FROM transactions
                  WHERE kind = ${kind} AND status = 'DONE' AND deleted_at IS NULL
                    AND date BETWEEN ${de} AND ${ate}
                  GROUP BY category_id ORDER BY total DESC`
            );
            return {
              periodo: { de, ate },
              totalCentavos: rows.reduce((sum, r) => sum + r.total, 0),
              categorias: rows.map((r) => ({
                categoria: label(r.categoryId),
                totalCentavos: r.total,
                lancamentos: r.count,
              })),
            };
          },
        }),
    },
    lancamentos: {
      area: 'finance',
      make: () =>
        tool({
          description:
            'Lançamentos efetivados de um período, com filtro por texto, categoria e tipo. Devolve o total já somado de todos os que casam e até 40 deles para citar.',
          inputSchema: z.object({
            ...range,
            busca: z.string().max(80).optional().describe('Trecho da descrição, como "uber"'),
            categoria: z.string().max(80).optional().describe('Nome (ou parte) da categoria'),
            tipo: z.enum(['gastos', 'entradas', 'transferencias']).default('gastos'),
            incluirPrevistos: z.boolean().default(false),
          }),
          execute: async ({ de, ate, busca, categoria, tipo, incluirPrevistos }) => {
            const problem = checkRange(de, ate);
            if (problem) return { erro: problem };
            const { rows, label } = categoryLabels(app);
            const names = new Map(listAccounts(app, true).map((a) => [a.id, a.name]));
            const wanted = categoria?.trim().toLowerCase();
            const ids = wanted
              ? rows.filter((c) => label(c.id).toLowerCase().includes(wanted)).map((c) => c.id)
              : null;
            const kind = tipo === 'entradas' ? 'INCOME' : tipo === 'transferencias' ? 'TRANSFER' : 'EXPENSE';
            const term = busca?.trim().toLowerCase();
            // Direto no banco, sem o limite da lista da tela: o total precisa de todos.
            const all = app.db
              .select({
                date: transactions.date,
                description: transactions.description,
                amountCents: transactions.amountCents,
                categoryId: transactions.categoryId,
                accountId: transactions.accountId,
                status: transactions.status,
              })
              .from(transactions)
              .where(
                and(
                  isNull(transactions.deletedAt),
                  eq(transactions.kind, kind),
                  between(transactions.date, de, ate),
                  incluirPrevistos ? undefined : eq(transactions.status, 'DONE'),
                  ids ? (ids.length ? inArray(transactions.categoryId, ids) : sql`0`) : undefined
                )
              )
              .orderBy(desc(transactions.date))
              .all()
              .filter((t) => !term || t.description.toLowerCase().includes(term));
            return {
              quantidade: all.length,
              totalCentavos: all.reduce((sum, t) => sum + t.amountCents, 0),
              mostrando: Math.min(all.length, 40),
              lancamentos: all.slice(0, 40).map((t) => ({
                data: t.date,
                descricao: t.description,
                valorCentavos: t.amountCents,
                categoria: label(t.categoryId),
                conta: names.get(t.accountId) ?? null,
                ...(t.status === 'PLANNED' ? { previsto: true } : {}),
              })),
            };
          },
        }),
    },
    faturas: {
      area: 'finance',
      make: () =>
        tool({
          description: 'Faturas de cartão ainda não pagas, com vencimento e valor. Período opcional.',
          inputSchema: z.object({ de: date.optional(), ate: date.optional() }),
          execute: async ({ de, ate }) => {
            const names = new Map(listAccounts(app, true).map((a) => [a.id, a.name]));
            return listDueInvoices(app, { from: de, to: ate }).map((invoice) => ({
              cartao: names.get(invoice.accountId) ?? null,
              vencimento: invoice.dueDate,
              totalCentavos: invoice.totalCents,
              situacao: invoice.status,
            }));
          },
        }),
    },
    orcamentos: {
      area: 'finance',
      make: () =>
        tool({
          description: 'Orçamentos do mês por categoria: limite, gasto e quanto falta.',
          inputSchema: z.object({ mes: z.string().regex(/^\d{4}-\d{2}$/).describe('AAAA-MM') }),
          execute: async ({ mes }) => {
            const { label } = categoryLabels(app);
            return budgetStatuses(app, mes).map((b) => {
              const { categoryId, ...rest } = b as typeof b & { categoryId: string | null };
              return { ...rest, categoria: label(categoryId) };
            });
          },
        }),
    },
    tarefas: {
      area: 'tasks',
      make: () =>
        tool({
          description:
            'Tarefas, por prazo, texto ou situação. Por padrão só as abertas; concluidas=true inclui as feitas.',
          inputSchema: z.object({
            prazoDe: date.optional(),
            prazoAte: date.optional(),
            busca: z.string().max(80).optional(),
            concluidas: z.boolean().optional(),
          }),
          execute: async ({ prazoDe, prazoAte, busca, concluidas }) => {
            const list = listTasks(app, {
              dueFrom: prazoDe,
              dueTo: prazoAte,
              search: busca,
              includeCompleted: concluidas,
              limit: 1000,
            });
            const showProject = ctx.allowed().includes('projects');
            return {
              quantidade: list.length,
              mostrando: Math.min(list.length, 50),
              tarefas: list.slice(0, 50).map((t) => ({
                titulo: t.title,
                situacao: t.status,
                prioridade: t.priority,
                prazo: t.dueDate,
                hora: t.dueTime,
                ...(showProject && t.project ? { projeto: t.project.name } : {}),
                etiquetas: t.tags,
                concluidaEm: t.completedAt ? localDay(app, t.completedAt) : null,
              })),
            };
          },
        }),
    },
    projetos: {
      area: 'projects',
      make: () =>
        tool({
          description: 'Projetos, com situação, datas e descrição.',
          inputSchema: z.object({ concluidos: z.boolean().optional() }),
          execute: async ({ concluidos }) =>
            listProjects(app, { includeCompleted: concluidos }).map((p) => ({
              nome: p.name,
              tipo: p.type,
              situacao: p.status,
              inicio: p.startDate,
              prazo: p.dueDate,
              descricao: p.description,
            })),
        }),
    },
    metas: {
      area: 'tasks',
      make: () =>
        tool({
          description: 'Metas, com prazo e o ritmo em relação a ele.',
          inputSchema: z.object({}),
          execute: async () => {
            const allowed = ctx.allowed();
            // A meta conta na área do que ela mede: saldo e dinheiro são finanças, saúde é saúde.
            const areaOf = (g: { area: string; source: string; money: boolean }): Area =>
              g.source === 'ACCOUNT_BALANCE' || g.money || g.area === 'FINANCAS'
                ? 'finance'
                : g.area === 'SAUDE'
                  ? 'health'
                  : g.source === 'HABIT_STREAK'
                    ? 'habits'
                    : 'tasks';
            const money = (value: number | null | undefined) => (value == null ? null : Math.round(value));
            return listGoals(app)
              .filter((g) => allowed.includes(areaOf(g)))
              .map((g) => ({
                titulo: g.title,
                prazo: g.deadline,
                situacao: g.pace.status,
                progresso: Math.round((g.pace.progress ?? 0) * 100) / 100,
                ...(g.money
                  ? { alvoCentavos: money(g.target), atualCentavos: money(g.current) }
                  : { unidade: g.unit, alvo: g.target, atual: g.current }),
              }));
          },
        }),
    },
    eventos: {
      area: 'agenda',
      make: () =>
        tool({
          description: 'Compromissos da agenda num período, já com as repetições.',
          inputSchema: z.object(range),
          execute: async ({ de, ate }) => {
            const problem = checkRange(de, ate);
            if (problem) return { erro: problem };
            // Sem calendário ainda, não há evento; listar criaria o calendário local.
            const hasCalendar = app.db.select({ id: calendars.id }).from(calendars).limit(1).get();
            if (!hasCalendar) return { quantidade: 0, eventos: [] };
            // O fim da Agenda é exclusivo; aqui "até" inclui o dia.
            const list = listOccurrences(app, { from: de, to: addDays(ate, 1) }).sort((a, b) =>
              a.startAt.localeCompare(b.startAt)
            );
            return {
              quantidade: list.length,
              mostrando: Math.min(list.length, 80),
              eventos: list.slice(0, 80).map((e) =>
                e.allDay
                  ? {
                      titulo: e.title,
                      diaInteiro: true,
                      de: e.startAt.slice(0, 10),
                      ate: addDays(e.endAt.slice(0, 10), -1),
                      local: e.location,
                    }
                  : {
                      titulo: e.title,
                      inicio: localTime(app, e.startAt),
                      fim: localTime(app, e.endAt),
                      local: e.location,
                    }
              ),
            };
          },
        }),
    },
    habitos: {
      area: 'habits',
      make: () =>
        tool({
          description: 'Quantas vezes cada hábito foi marcado num período.',
          inputSchema: z.object(range),
          execute: async ({ de, ate }) => {
            const problem = checkRange(de, ate);
            if (problem) return { erro: problem };
            const rows = app.db
              .select({ name: habits.name, checks: sql<number>`COUNT(${habitChecks.id})` })
              .from(habits)
              .leftJoin(
                habitChecks,
                and(
                  eq(habitChecks.habitId, habits.id),
                  isNull(habitChecks.deletedAt),
                  between(habitChecks.date, de, ate)
                )
              )
              .where(isNull(habits.deletedAt))
              .groupBy(habits.id)
              .all();
            return { periodo: { de, ate }, habitos: rows.map((r) => ({ habito: r.name, vezes: r.checks })) };
          },
        }),
    },
    foco: {
      area: 'focus',
      make: () =>
        tool({
          description: 'Minutos de foco por dia num período.',
          inputSchema: z.object(range),
          execute: async ({ de, ate }) => {
            const problem = checkRange(de, ate);
            if (problem) return { erro: problem };
            const days = [...secondsByDay(app, de, ate).entries()].map(([dia, seconds]) => ({
              dia,
              minutos: Math.round(seconds / 60),
            }));
            return { totalMinutos: days.reduce((sum, d) => sum + d.minutos, 0), dias: days };
          },
        }),
    },
    saude: {
      area: 'health',
      make: () =>
        tool({
          description: 'Humor e energia (1 a 5), sono e água por dia num período.',
          inputSchema: z.object(range),
          execute: async ({ de, ate }) => {
            const problem = checkRange(de, ate);
            if (problem) return { erro: problem };
            return app.db
              .select({
                dia: healthDays.date,
                humor: healthDays.mood,
                energia: healthDays.energy,
                sonoMinutos: healthDays.sleepMinutes,
                aguaMl: healthDays.waterMl,
              })
              .from(healthDays)
              .where(and(isNull(healthDays.deletedAt), between(healthDays.date, de, ate)))
              .orderBy(healthDays.date)
              .all();
          },
        }),
    },
    diario: {
      area: 'journal',
      make: () =>
        tool({
          description:
            'Trechos do diário e das revisões semanais (o que deu certo, o que travou). Busca por texto opcional.',
          inputSchema: z.object({ busca: z.string().max(80).optional() }),
          execute: async ({ busca }) => ({
            diario: listDiary(app, busca).slice(0, 20),
            revisoes: app.db
              .select({ semana: reviews.weekStart, oQueDeuCerto: reviews.wentWell, oQueTravou: reviews.blocked })
              .from(reviews)
              .where(isNull(reviews.deletedAt))
              .orderBy(sql`${reviews.weekStart} DESC`)
              .limit(8)
              .all()
              .filter((r) => !busca || `${r.oQueDeuCerto} ${r.oQueTravou}`.toLowerCase().includes(busca.toLowerCase())),
          }),
        }),
    },
  };

  const allowed = ctx.allowed();
  const set: ToolSet = {};
  for (const [name, def] of Object.entries(defs)) {
    if (def.area && !allowed.includes(def.area)) continue;
    const base = def.make() as ToolSet[string];
    set[name] = {
      ...base,
      execute: async (input: unknown, options: unknown) => {
        // Desligada no meio da conversa: a consulta não roda.
        if (def.area && !ctx.allowed().includes(def.area)) {
          return { erro: 'Essa área foi desligada para a IA.' };
        }
        ctx.used(name, def.area);
        const result = await (base.execute as (i: unknown, o: unknown) => unknown)(input, options);
        return clean(result);
      },
    } as ToolSet[string];
  }
  return set;
}
