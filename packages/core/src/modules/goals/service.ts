import { and, eq, isNull, sql } from 'drizzle-orm';

import { AppError, type Ctx, notFound, stamp, todayIn } from '../../services/context';
import { currentStreak, type Frequency } from '../habits/streaks';

import { computePace } from './pace';
import { goals, MONEY_UNIT } from './schema';

type GoalRow = typeof goals.$inferSelect;

export interface GoalBody {
  title: string;
  area: GoalRow['area'];
  target: number;
  unit: string;
  deadline?: string | null;
  color: GoalRow['color'];
  source: GoalRow['source'];
  sourceId?: string | null;
  manualValue?: number;
}

const liveGoal = isNull(goals.deletedAt);

const SOURCE_UNIT: Partial<Record<GoalRow['source'], string>> = {
  PROJECT_TASKS: 'tarefas',
  HABIT_STREAK: 'dias',
  ACCOUNT_BALANCE: MONEY_UNIT,
};

// Outros módulos entram só por SQL: a tabela pode ainda não existir nesta versão do banco.
function hasTable(ctx: Ctx, name: string) {
  return Boolean(
    ctx.db.get(sql`SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ${name}`)
  );
}

interface SourceRead {
  label: string;
  value: number;
}

const projectLabelColumn = (ctx: Ctx) =>
  ctx.db
    .all<{ name: string }>(sql`SELECT name FROM pragma_table_info('projects')`)
    .some((column) => column.name === 'name')
    ? sql.raw('name')
    : sql.raw('title');

function readProject(ctx: Ctx, id: string): SourceRead | null {
  if (!hasTable(ctx, 'projects') || !hasTable(ctx, 'tasks')) return null;
  const project = ctx.db.get<{ label: string } | undefined>(
    sql`SELECT ${projectLabelColumn(ctx)} AS label FROM projects
        WHERE id = ${id} AND deleted_at IS NULL`
  );
  if (!project) return null;
  const tasks = ctx.db.get<{ done: number | null }>(
    sql`SELECT SUM(completed_at IS NOT NULL) AS done FROM tasks
        WHERE project_id = ${id} AND parent_task_id IS NULL AND deleted_at IS NULL`
  );
  return { label: project.label, value: tasks.done ?? 0 };
}

function readHabit(ctx: Ctx, id: string): SourceRead | null {
  if (!hasTable(ctx, 'habits') || !hasTable(ctx, 'habit_checks')) return null;
  const habit = ctx.db.get<
    { name: string; frequency: Frequency['type']; times: number | null; endOn: string | null } | undefined
  >(
    sql`SELECT name, frequency, times_per_week AS times, end_on AS endOn FROM habits
        WHERE id = ${id} AND deleted_at IS NULL`
  );
  if (!habit) return null;
  const marks = ctx.db.all<{ date: string }>(
    sql`SELECT date FROM habit_checks WHERE habit_id = ${id} AND deleted_at IS NULL`
  );
  const frequency: Frequency =
    habit.frequency === 'TIMES'
      ? { type: 'TIMES', times: habit.times ?? 1 }
      : { type: habit.frequency };
  const today = todayIn(ctx);
  const asOf = habit.endOn && habit.endOn < today ? habit.endOn : today;
  return {
    label: habit.name,
    value: currentStreak(frequency, new Set(marks.map((mark) => mark.date)), asOf),
  };
}

const balanceColumn = sql`a.initial_balance_cents + COALESCE((
  SELECT SUM(CASE
    WHEN t.kind = 'INCOME' THEN t.amount_cents
    WHEN t.kind = 'EXPENSE' THEN -t.amount_cents
    WHEN t.to_account_id = a.id THEN t.amount_cents
    ELSE -t.amount_cents
  END)
  FROM transactions t
  WHERE t.deleted_at IS NULL AND t.status = 'DONE'
    AND (t.account_id = a.id OR (t.kind = 'TRANSFER' AND t.to_account_id = a.id))
), 0)`;

function readAccount(ctx: Ctx, id: string): SourceRead | null {
  if (!hasTable(ctx, 'accounts') || !hasTable(ctx, 'transactions')) return null;
  const account = ctx.db.get<{ label: string; value: number } | undefined>(
    sql`SELECT a.name AS label, ${balanceColumn} AS value FROM accounts a
        WHERE a.id = ${id} AND a.deleted_at IS NULL`
  );
  return account ?? null;
}

function readSource(ctx: Ctx, source: GoalRow['source'], id: string | null): SourceRead | null {
  if (!id) return null;
  if (source === 'PROJECT_TASKS') return readProject(ctx, id);
  if (source === 'HABIT_STREAK') return readHabit(ctx, id);
  if (source === 'ACCOUNT_BALANCE') return readAccount(ctx, id);
  return null;
}

/** O que dá para ligar a uma meta agora. Módulo que ainda não existe devolve lista vazia. */
export function goalSources(ctx: Ctx) {
  const projects =
    hasTable(ctx, 'projects') && hasTable(ctx, 'tasks')
      ? ctx.db.all<{ id: string; label: string; total: number }>(
          sql`SELECT p.id, p.${projectLabelColumn(ctx)} AS label,
                (SELECT COUNT(*) FROM tasks t
                  WHERE t.project_id = p.id AND t.parent_task_id IS NULL
                    AND t.deleted_at IS NULL) AS total
              FROM projects p WHERE p.deleted_at IS NULL ORDER BY label`
        )
      : [];
  const habits = hasTable(ctx, 'habits')
    ? ctx.db.all<{ id: string; label: string }>(
        sql`SELECT id, name AS label FROM habits WHERE deleted_at IS NULL ORDER BY position`
      )
    : [];
  const accounts =
    hasTable(ctx, 'accounts') && hasTable(ctx, 'transactions')
      ? ctx.db.all<{ id: string; label: string; balanceCents: number }>(
          sql`SELECT a.id, a.name AS label, ${balanceColumn} AS balanceCents FROM accounts a
              WHERE a.deleted_at IS NULL AND a.archived_at IS NULL AND a.type <> 'CREDIT_CARD'
              ORDER BY a.name`
        )
      : [];
  return { projects, habits, accounts };
}

function view(ctx: Ctx, row: GoalRow) {
  const read = row.source === 'MANUAL' ? null : readSource(ctx, row.source, row.sourceId);
  const current = row.source === 'MANUAL' ? row.manualValue : (read?.value ?? 0);
  const money = row.unit === MONEY_UNIT;
  const pace = computePace({
    target: row.target,
    current,
    deadline: row.deadline,
    startedOn: row.startedOn,
    today: todayIn(ctx),
    whole: money || row.source === 'PROJECT_TASKS',
    ...(row.source === 'HABIT_STREAK' ? { maxPerDay: 1 } : {}),
  });
  return {
    id: row.id,
    title: row.title,
    area: row.area,
    color: row.color,
    unit: row.unit,
    money,
    target: row.target,
    current,
    deadline: row.deadline,
    startedOn: row.startedOn,
    source: row.source,
    sourceId: row.sourceId,
    sourceLabel: read?.label ?? null,
    sourceMissing: row.source !== 'MANUAL' && !read,
    pace,
  };
}

export function listGoals(ctx: Ctx) {
  const list = ctx.db.select().from(goals).where(liveGoal).all().map((row) => view(ctx, row));
  // Abertas primeiro, pelo prazo mais próximo; sem prazo depois; concluídas no fim.
  const rank = (goal: (typeof list)[number]) =>
    goal.pace.status === 'done' ? 2 : goal.deadline ? 0 : 1;
  return list.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.deadline ?? '').localeCompare(b.deadline ?? '') ||
      a.title.localeCompare(b.title, 'pt-BR')
  );
}

function ownedGoal(ctx: Ctx, id: string) {
  const row = ctx.db
    .select()
    .from(goals)
    .where(and(eq(goals.id, id), liveGoal))
    .get();
  if (!row) throw notFound('Meta não encontrada.');
  return row;
}

function columns(ctx: Ctx, body: GoalBody) {
  const linked = body.source !== 'MANUAL';
  if (linked && !readSource(ctx, body.source, body.sourceId ?? null)) {
    const messages = {
      PROJECT_TASKS: 'Projeto não encontrado.',
      HABIT_STREAK: 'Hábito não encontrado.',
      ACCOUNT_BALANCE: 'Conta não encontrada.',
    };
    throw notFound(messages[body.source as keyof typeof messages]);
  }
  const unit = SOURCE_UNIT[body.source] ?? body.unit;
  if (unit === MONEY_UNIT && !Number.isInteger(body.target)) {
    throw new AppError(400, 'Valor em centavos inteiros.');
  }
  return {
    title: body.title,
    area: body.area,
    target: body.target,
    unit,
    deadline: body.deadline ?? null,
    color: body.color,
    source: body.source,
    sourceId: linked ? body.sourceId! : null,
  };
}

const goalView = (ctx: Ctx, id: string) => view(ctx, ownedGoal(ctx, id));

export function createGoal(ctx: Ctx, body: GoalBody) {
  const { id } = ctx.db
    .insert(goals)
    .values({
      ...stamp(),
      ...columns(ctx, body),
      startedOn: todayIn(ctx),
      manualValue: body.source === 'MANUAL' ? (body.manualValue ?? 0) : 0,
    })
    .returning()
    .get();
  return goalView(ctx, id);
}

export function updateGoal(ctx: Ctx, id: string, body: GoalBody) {
  ownedGoal(ctx, id);
  ctx.db
    .update(goals)
    .set({ ...columns(ctx, body), updatedAt: Date.now() })
    .where(eq(goals.id, id))
    .run();
  return goalView(ctx, id);
}

export function setProgress(ctx: Ctx, id: string, value: number) {
  const row = ownedGoal(ctx, id);
  if (row.source !== 'MANUAL') {
    throw new AppError(409, 'Esta meta acompanha o progresso sozinha.');
  }
  if (row.unit === MONEY_UNIT && !Number.isInteger(value)) {
    throw new AppError(400, 'Valor em centavos inteiros.');
  }
  ctx.db.update(goals).set({ manualValue: value, updatedAt: Date.now() }).where(eq(goals.id, id)).run();
  return goalView(ctx, id);
}

export function deleteGoal(ctx: Ctx, id: string) {
  ownedGoal(ctx, id);
  const now = Date.now();
  ctx.db.update(goals).set({ deletedAt: now, updatedAt: now }).where(eq(goals.id, id)).run();
  return { id };
}
