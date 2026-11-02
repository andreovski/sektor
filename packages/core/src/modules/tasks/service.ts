import {
  addDays,
  dateOccurrences,
  instantToWallTime,
} from '@sektor/finance-engine';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  max,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { z } from 'zod';

import { AppError, type Ctx, notFound, stamp, todayIn } from '../../services/context';

import { parseCapture } from './capture';
import type {
  captureTaskSchema,
  CompleteTaskResponse,
  createProjectSchema,
  createTaskListSchema,
  createTaskSchema,
  listTasksSchema,
  ProjectResponse,
  reorderTasksSchema,
  TagResponse,
  TaskCounts,
  TaskListResponse,
  TaskResponse,
  TaskStatus,
  updateProjectSchema,
  updateTaskListSchema,
  updateTaskSchema,
} from './contract';
import { projects, taskLists, taskTagLinks, taskTags, tasks } from './schema';

type TaskRow = typeof tasks.$inferSelect;
type ListRow = typeof taskLists.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;

const live = isNull(tasks.deletedAt);
const topLevel = isNull(tasks.parentTaskId);

// ------------------------------------------------------------------ listas

export function inboxId(ctx: Ctx): string {
  const inbox = ctx.db
    .select({ id: taskLists.id })
    .from(taskLists)
    .where(and(eq(taskLists.isInbox, true), isNull(taskLists.deletedAt)))
    .get();
  if (inbox) return inbox.id;
  const row = { ...stamp(), name: 'Entrada', isInbox: true };
  ctx.db.insert(taskLists).values(row).run();
  return row.id;
}

function toList(row: ListRow, openCount: number): TaskListResponse {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    sortOrder: row.sortOrder,
    isInbox: row.isInbox,
    openCount,
  };
}

export function listTaskLists(ctx: Ctx): TaskListResponse[] {
  inboxId(ctx);
  const open = new Map(
    ctx.db
      .select({ listId: tasks.listId, n: count() })
      .from(tasks)
      .where(and(live, topLevel, isNull(tasks.completedAt)))
      .groupBy(tasks.listId)
      .all()
      .map((row) => [row.listId, row.n])
  );
  return ctx.db
    .select()
    .from(taskLists)
    .where(isNull(taskLists.deletedAt))
    .orderBy(desc(taskLists.isInbox), asc(taskLists.sortOrder), asc(taskLists.createdAt))
    .all()
    .map((row) => toList(row, open.get(row.id) ?? 0));
}

function getList(ctx: Ctx, id: string) {
  const list = ctx.db
    .select()
    .from(taskLists)
    .where(and(eq(taskLists.id, id), isNull(taskLists.deletedAt)))
    .get();
  if (!list) throw notFound('Lista');
  return list;
}

export function createTaskList(
  ctx: Ctx,
  body: z.output<typeof createTaskListSchema>
): TaskListResponse {
  const last = ctx.db
    .select({ value: max(taskLists.sortOrder) })
    .from(taskLists)
    .where(isNull(taskLists.deletedAt))
    .get();
  const row = {
    ...stamp(),
    name: body.name,
    color: body.color ?? null,
    sortOrder: (last?.value ?? -1) + 1,
  };
  ctx.db.insert(taskLists).values(row).run();
  return toList(getList(ctx, row.id), 0);
}

export function updateTaskList(
  ctx: Ctx,
  id: string,
  body: z.output<typeof updateTaskListSchema>
): TaskListResponse {
  getList(ctx, id);
  ctx.db
    .update(taskLists)
    .set({ ...body, updatedAt: Date.now() })
    .where(eq(taskLists.id, id))
    .run();
  return listTaskLists(ctx).find((list) => list.id === id)!;
}

export function deleteTaskList(ctx: Ctx, id: string) {
  if (getList(ctx, id).isInbox) throw new AppError(400, 'A Entrada não pode ser apagada.');
  const now = Date.now();
  ctx.db.transaction(() => {
    ctx.db
      .update(tasks)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(tasks.listId, id), live))
      .run();
    ctx.db
      .update(taskLists)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(taskLists.id, id))
      .run();
  });
}

// ------------------------------------------------------------------ leitura de tarefas

function tagsByTask(ctx: Ctx, ids: string[]) {
  const map = new Map<string, string[]>();
  if (!ids.length) return map;
  const rows = ctx.db
    .select({ taskId: taskTagLinks.taskId, name: taskTags.name })
    .from(taskTagLinks)
    .innerJoin(taskTags, eq(taskTags.id, taskTagLinks.tagId))
    .where(and(inArray(taskTagLinks.taskId, ids), isNull(taskTagLinks.deletedAt)))
    .orderBy(asc(taskTags.name))
    .all();
  for (const row of rows) map.set(row.taskId, [...(map.get(row.taskId) ?? []), row.name]);
  return map;
}

/** Monta a resposta com etiquetas, projeto e subtarefas, sem uma consulta por linha. */
function serialize(ctx: Ctx, rows: TaskRow[]): TaskResponse[] {
  if (!rows.length) return [];
  const subRows = ctx.db
    .select()
    .from(tasks)
    .where(
      and(
        inArray(
          tasks.parentTaskId,
          rows.map((row) => row.id)
        ),
        live
      )
    )
    .orderBy(asc(tasks.sortOrder), asc(tasks.createdAt))
    .all();
  const tags = tagsByTask(ctx, [...rows, ...subRows].map((row) => row.id));
  const projectIds = [...new Set(rows.flatMap((row) => row.projectId ?? []))];
  const projectById = new Map(
    (projectIds.length
      ? ctx.db
          .select({ id: projects.id, name: projects.name, color: projects.color })
          .from(projects)
          .where(and(inArray(projects.id, projectIds), isNull(projects.deletedAt)))
          .all()
      : []
    ).map((project) => [project.id, project])
  );

  const toTask = (row: TaskRow, subtasks: TaskResponse[]): TaskResponse => ({
    id: row.id,
    listId: row.listId,
    projectId: row.projectId,
    project: row.projectId ? (projectById.get(row.projectId) ?? null) : null,
    parentTaskId: row.parentTaskId,
    title: row.title,
    notes: row.notes,
    status: row.status,
    priority: row.priority,
    dueDate: row.dueDate,
    dueTime: row.dueTime,
    rrule: row.rrule,
    sortOrder: row.sortOrder,
    completedAt: row.completedAt,
    tags: tags.get(row.id) ?? [],
    subtasks,
  });

  return rows.map((row) =>
    toTask(
      row,
      subRows.filter((sub) => sub.parentTaskId === row.id).map((sub) => toTask(sub, []))
    )
  );
}

function findTask(ctx: Ctx, id: string) {
  const task = ctx.db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), live))
    .get();
  if (!task) throw notFound('Tarefa');
  return task;
}

export function getTask(ctx: Ctx, id: string): TaskResponse {
  return serialize(ctx, [findTask(ctx, id)])[0]!;
}

function clockIn(ctx: Ctx, now: Date) {
  const wall = instantToWallTime(now, ctx.timeZone);
  return `${String(wall.hour).padStart(2, '0')}:${String(wall.minute).padStart(2, '0')}`;
}

/** A regra de cada lista inteligente. Sozinha, não olha se a tarefa está concluída. */
function dueCondition(
  ctx: Ctx,
  view: 'today' | 'next7' | 'overdue' | 'nodate',
  now = new Date()
): SQL {
  const today = todayIn(ctx, now);
  switch (view) {
    case 'today':
      return lte(tasks.dueDate, today);
    case 'next7':
      return and(gte(tasks.dueDate, today), lt(tasks.dueDate, addDays(today, 7)))!;
    case 'overdue':
      return or(
        lt(tasks.dueDate, today),
        and(eq(tasks.dueDate, today), lt(tasks.dueTime, clockIn(ctx, now)))
      )!;
    case 'nodate':
      return isNull(tasks.dueDate);
  }
}

const byDue = [
  asc(tasks.dueDate),
  asc(sql`${tasks.dueTime} IS NULL`),
  asc(tasks.dueTime),
  asc(tasks.sortOrder),
];

const escapeLike = (text: string) => text.replace(/[\\%_]/g, '\\$&');

export function listTasks(ctx: Ctx, query: z.output<typeof listTasksSchema> = {}): TaskResponse[] {
  const where: (SQL | undefined)[] = [live, topLevel];
  if (query.listId) where.push(eq(tasks.listId, query.listId));
  if (query.projectId) where.push(eq(tasks.projectId, query.projectId));
  if (query.status) where.push(eq(tasks.status, query.status));
  if (query.dueFrom) where.push(gte(tasks.dueDate, query.dueFrom));
  if (query.dueTo) where.push(lte(tasks.dueDate, query.dueTo));
  if (query.tag) {
    where.push(
      inArray(
        tasks.id,
        ctx.db
          .select({ id: taskTagLinks.taskId })
          .from(taskTagLinks)
          .innerJoin(taskTags, eq(taskTags.id, taskTagLinks.tagId))
          .where(
            and(eq(taskTags.name, query.tag.toLowerCase()), isNull(taskTagLinks.deletedAt))
          )
      )
    );
  }
  if (query.search) {
    const term = `%${escapeLike(query.search)}%`;
    where.push(
      or(
        sql`${tasks.title} LIKE ${term} ESCAPE '\\'`,
        sql`${tasks.notes} LIKE ${term} ESCAPE '\\'`
      )
    );
  }

  const dated = query.view && query.view !== 'completed' && query.view !== 'nodate';
  if (query.view === 'completed') {
    where.push(isNotNull(tasks.completedAt));
  } else {
    if (query.view) where.push(dueCondition(ctx, query.view));
    if (!query.includeCompleted && query.status !== 'DONE') where.push(isNull(tasks.completedAt));
  }

  const orderBy =
    query.view === 'completed'
      ? [desc(tasks.completedAt)]
      : dated || query.dueFrom || query.dueTo
        ? byDue
        : [asc(tasks.sortOrder), asc(tasks.createdAt)];

  const rows = ctx.db
    .select()
    .from(tasks)
    .where(and(...where))
    .orderBy(...orderBy)
    .limit(query.limit ?? (query.view === 'completed' ? 200 : 1000))
    .all();
  return serialize(ctx, rows);
}

export function taskCounts(ctx: Ctx): TaskCounts {
  const now = new Date();
  const tally = (...conditions: SQL[]) =>
    ctx.db
      .select({ n: count() })
      .from(tasks)
      .where(and(live, topLevel, ...conditions))
      .get()?.n ?? 0;
  const open = isNull(tasks.completedAt);
  return {
    today: tally(open, dueCondition(ctx, 'today', now)),
    next7: tally(open, dueCondition(ctx, 'next7', now)),
    overdue: tally(open, dueCondition(ctx, 'overdue', now)),
    nodate: tally(open, dueCondition(ctx, 'nodate', now)),
    all: tally(open),
    completed: tally(isNotNull(tasks.completedAt)),
  };
}

export function listTags(ctx: Ctx): TagResponse[] {
  return ctx.db
    .select({ id: taskTags.id, name: taskTags.name, taskCount: count(tasks.id) })
    .from(taskTags)
    .leftJoin(
      taskTagLinks,
      and(eq(taskTagLinks.tagId, taskTags.id), isNull(taskTagLinks.deletedAt))
    )
    .leftJoin(
      tasks,
      and(eq(tasks.id, taskTagLinks.taskId), live, isNull(tasks.completedAt))
    )
    .where(isNull(taskTags.deletedAt))
    .groupBy(taskTags.id)
    .orderBy(asc(taskTags.name))
    .all();
}

// ------------------------------------------------------------------ escrita de tarefas

function syncTags(ctx: Ctx, taskId: string, names: string[]) {
  const unique = [
    ...new Set(names.map((name) => name.trim().replace(/^#+/, '').toLowerCase()).filter(Boolean)),
  ];
  const wanted = unique.map((name) => {
    const existing = ctx.db
      .select({ id: taskTags.id })
      .from(taskTags)
      .where(and(eq(taskTags.name, name), isNull(taskTags.deletedAt)))
      .get();
    if (existing) return existing.id;
    const row = { ...stamp(), name };
    ctx.db.insert(taskTags).values(row).run();
    return row.id;
  });

  const current = ctx.db
    .select({ id: taskTagLinks.id, tagId: taskTagLinks.tagId })
    .from(taskTagLinks)
    .where(and(eq(taskTagLinks.taskId, taskId), isNull(taskTagLinks.deletedAt)))
    .all();
  const gone = current.filter((link) => !wanted.includes(link.tagId)).map((link) => link.id);
  if (gone.length) {
    const now = Date.now();
    ctx.db
      .update(taskTagLinks)
      .set({ deletedAt: now, updatedAt: now })
      .where(inArray(taskTagLinks.id, gone))
      .run();
  }
  for (const tagId of wanted) {
    if (current.some((link) => link.tagId === tagId)) continue;
    ctx.db
      .insert(taskTagLinks)
      .values({ ...stamp(), taskId, tagId })
      .run();
  }
}

function assertProject(ctx: Ctx, id: string | null | undefined) {
  if (!id) return;
  findProject(ctx, id);
}

function nextSortOrder(ctx: Ctx, listId: string, parentTaskId: string | null) {
  const last = ctx.db
    .select({ value: max(tasks.sortOrder) })
    .from(tasks)
    .where(
      and(
        eq(tasks.listId, listId),
        parentTaskId ? eq(tasks.parentTaskId, parentTaskId) : topLevel,
        live
      )
    )
    .get();
  return (last?.value ?? -1) + 1;
}

export function createTask(ctx: Ctx, body: z.output<typeof createTaskSchema>): TaskResponse {
  const parent = body.parentTaskId ? findParent(ctx, body.parentTaskId) : null;
  const listId = parent?.listId ?? (body.listId ? getList(ctx, body.listId).id : inboxId(ctx));
  const projectId = parent ? parent.projectId : (body.projectId ?? null);
  assertProject(ctx, projectId);
  const row = {
    ...stamp(),
    listId,
    projectId,
    parentTaskId: parent?.id ?? null,
    title: body.title,
    notes: body.notes ?? null,
    status: body.status ?? 'TODO',
    priority: body.priority ?? null,
    dueDate: body.dueDate ?? null,
    dueTime: body.dueDate ? (body.dueTime ?? null) : null,
    rrule: body.rrule ?? null,
    sortOrder: nextSortOrder(ctx, listId, parent?.id ?? null),
    completedAt: body.status === 'DONE' ? Date.now() : null,
  };
  ctx.db.transaction(() => {
    ctx.db.insert(tasks).values(row).run();
    if (body.tags?.length) syncTags(ctx, row.id, body.tags);
  });
  return getTask(ctx, row.id);
}

function findParent(ctx: Ctx, id: string) {
  const parent = ctx.db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), live))
    .get();
  if (!parent) throw notFound('Tarefa-mãe');
  if (parent.parentTaskId) throw new AppError(400, 'Subtarefas vão até um nível só.');
  return parent;
}

/** Cria uma tarefa a partir de uma linha digitada. */
export function captureTask(ctx: Ctx, body: z.output<typeof captureTaskSchema>): TaskResponse {
  const parsed = parseCapture(body.text, todayIn(ctx));
  if (!parsed.title) throw new AppError(400, 'Escreva o que precisa ser feito.');
  return createTask(ctx, {
    title: parsed.title.slice(0, 300),
    listId: body.listId,
    projectId: body.projectId,
    dueDate: parsed.dueDate ?? body.defaultDueDate ?? null,
    priority: parsed.priority,
    tags: body.defaultTag ? [...parsed.tags, body.defaultTag].slice(0, 10) : parsed.tags,
  });
}

/** Próximo prazo de uma tarefa recorrente, depois do atual. Três anos sem ocorrência é o fim. */
function nextDue(rrule: string, dueDate: string) {
  return dateOccurrences(rrule, dueDate, addDays(dueDate, 1), addDays(dueDate, 3 * 366))[0] ?? null;
}

function markComplete(ctx: Ctx, task: TaskRow): string | null {
  const now = Date.now();
  ctx.db
    .update(tasks)
    .set({ completedAt: now, status: 'DONE', updatedAt: now })
    .where(eq(tasks.id, task.id))
    .run();
  if (!task.rrule || !task.dueDate) return null;
  const dueDate = nextDue(task.rrule, task.dueDate);
  if (!dueDate) return null;

  const next = {
    ...stamp(),
    listId: task.listId,
    projectId: task.projectId,
    title: task.title,
    notes: task.notes,
    dueDate,
    dueTime: task.dueTime,
    priority: task.priority,
    rrule: task.rrule,
    sortOrder: task.sortOrder,
  };
  ctx.db.insert(tasks).values(next).run();
  const subtasks = ctx.db
    .select()
    .from(tasks)
    .where(and(eq(tasks.parentTaskId, task.id), live))
    .all();
  for (const sub of subtasks) {
    ctx.db
      .insert(tasks)
      .values({
        ...stamp(),
        listId: task.listId,
        projectId: task.projectId,
        parentTaskId: next.id,
        title: sub.title,
        notes: sub.notes,
        sortOrder: sub.sortOrder,
      })
      .run();
  }
  syncTags(ctx, next.id, tagsByTask(ctx, [task.id]).get(task.id) ?? []);
  return next.id;
}

function markOpen(ctx: Ctx, id: string, status: TaskStatus = 'TODO') {
  ctx.db
    .update(tasks)
    .set({ completedAt: null, status, updatedAt: Date.now() })
    .where(eq(tasks.id, id))
    .run();
}

export function completeTask(ctx: Ctx, id: string): CompleteTaskResponse {
  const task = findTask(ctx, id);
  let nextId: string | null = null;
  if (!task.completedAt) ctx.db.transaction(() => (nextId = markComplete(ctx, task)));
  return { task: getTask(ctx, id), next: nextId ? getTask(ctx, nextId) : null };
}

export function reopenTask(ctx: Ctx, id: string, status?: TaskStatus): TaskResponse {
  const task = findTask(ctx, id);
  if (task.completedAt) markOpen(ctx, id, status);
  return getTask(ctx, id);
}

export function updateTask(
  ctx: Ctx,
  id: string,
  body: z.output<typeof updateTaskSchema>
): TaskResponse {
  const task = findTask(ctx, id);
  const { completed, status, tags, listId, parentTaskId, projectId, ...fields } = body;

  const patch: Partial<TaskRow> = { updatedAt: Date.now() };
  if (fields.title !== undefined) patch.title = fields.title;
  if (fields.notes !== undefined) patch.notes = fields.notes;
  if (fields.priority !== undefined) patch.priority = fields.priority;
  if (fields.rrule !== undefined) patch.rrule = fields.rrule;

  const dueDate = fields.dueDate !== undefined ? fields.dueDate : task.dueDate;
  if (fields.dueDate !== undefined) patch.dueDate = fields.dueDate;
  if (!dueDate) patch.dueTime = null;
  else if (fields.dueTime !== undefined) patch.dueTime = fields.dueTime;

  if (listId !== undefined && listId !== task.listId) {
    if (task.parentTaskId) throw new AppError(400, 'Mova a tarefa-mãe para trocar a lista.');
    patch.listId = getList(ctx, listId).id;
  }
  if (projectId !== undefined && projectId !== task.projectId) {
    if (task.parentTaskId) throw new AppError(400, 'Mova a tarefa-mãe para trocar o projeto.');
    assertProject(ctx, projectId);
    patch.projectId = projectId;
  }
  if (parentTaskId !== undefined && parentTaskId !== task.parentTaskId) {
    if (parentTaskId === id) throw new AppError(400, 'A tarefa não pode ser mãe de si mesma.');
    patch.parentTaskId = parentTaskId;
    if (parentTaskId) {
      const hasChildren = ctx.db
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.parentTaskId, id), live))
        .get();
      if (hasChildren) throw new AppError(400, 'Subtarefas vão até um nível só.');
      const parent = findParent(ctx, parentTaskId);
      patch.listId = parent.listId;
      patch.projectId = parent.projectId;
    }
  }

  const done = completed === true || status === 'DONE';
  const reopen = completed === false || (status !== undefined && status !== 'DONE');

  ctx.db.transaction(() => {
    ctx.db.update(tasks).set(patch).where(eq(tasks.id, id)).run();
    const family: Partial<TaskRow> = {};
    if (patch.listId) family.listId = patch.listId;
    if (patch.projectId !== undefined) family.projectId = patch.projectId;
    if (Object.keys(family).length) {
      ctx.db
        .update(tasks)
        .set({ ...family, updatedAt: Date.now() })
        .where(and(eq(tasks.parentTaskId, id), live))
        .run();
    }
    if (tags) syncTags(ctx, id, tags);

    if (done) {
      if (!task.completedAt) markComplete(ctx, { ...task, ...patch });
    } else if (reopen) {
      if (task.completedAt) markOpen(ctx, id, status);
      else if (status) {
        ctx.db
          .update(tasks)
          .set({ status, updatedAt: Date.now() })
          .where(eq(tasks.id, id))
          .run();
      }
    }
  });
  return getTask(ctx, id);
}

export function deleteTask(ctx: Ctx, id: string) {
  findTask(ctx, id);
  const now = Date.now();
  ctx.db
    .update(tasks)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(or(eq(tasks.id, id), eq(tasks.parentTaskId, id)), live))
    .run();
}

export function reorderTasks(ctx: Ctx, body: z.output<typeof reorderTasksSchema>) {
  const found = ctx.db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(inArray(tasks.id, body.orderedIds), eq(tasks.listId, body.listId), live))
    .all();
  if (found.length !== new Set(body.orderedIds).size || found.length !== body.orderedIds.length) {
    throw new AppError(400, 'Tarefas fora da lista.');
  }
  const now = Date.now();
  ctx.db.transaction(() => {
    body.orderedIds.forEach((id, index) => {
      ctx.db
        .update(tasks)
        .set({ sortOrder: index, updatedAt: now })
        .where(eq(tasks.id, id))
        .run();
    });
  });
}

// ------------------------------------------------------------------ projetos

function findProject(ctx: Ctx, id: string) {
  const project = ctx.db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), isNull(projects.deletedAt)))
    .get();
  if (!project) throw notFound('Projeto');
  return project;
}

function withProgress(ctx: Ctx, rows: ProjectRow[]): ProjectResponse[] {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const inProjects = and(inArray(tasks.projectId, ids), live, topLevel);
  const totals = new Map(
    ctx.db
      .select({
        projectId: tasks.projectId,
        total: count(),
        done: count(tasks.completedAt),
      })
      .from(tasks)
      .where(inProjects)
      .groupBy(tasks.projectId)
      .all()
      .map((row) => [row.projectId, row])
  );
  const nextByProject = new Map<string, TaskRow>();
  const open = ctx.db
    .select()
    .from(tasks)
    .where(and(inProjects, isNull(tasks.completedAt)))
    .orderBy(asc(sql`${tasks.dueDate} IS NULL`), ...byDue, asc(tasks.createdAt))
    .all();
  for (const task of open) {
    if (!nextByProject.has(task.projectId!)) nextByProject.set(task.projectId!, task);
  }

  return rows.map((row) => {
    const total = totals.get(row.id)?.total ?? 0;
    const done = totals.get(row.id)?.done ?? 0;
    const next = nextByProject.get(row.id);
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      description: row.description,
      color: row.color,
      dueDate: row.dueDate,
      completedAt: row.completedAt,
      progress: { total, done, percent: total ? Math.round((done / total) * 100) : 0 },
      nextTask: next
        ? { id: next.id, title: next.title, dueDate: next.dueDate, dueTime: next.dueTime }
        : null,
    };
  });
}

export function listProjects(
  ctx: Ctx,
  query: { includeCompleted?: boolean } = {}
): ProjectResponse[] {
  const rows = ctx.db
    .select()
    .from(projects)
    .where(
      and(
        isNull(projects.deletedAt),
        query.includeCompleted ? undefined : isNull(projects.completedAt)
      )
    )
    .orderBy(
      asc(sql`${projects.completedAt} IS NOT NULL`),
      asc(sql`${projects.dueDate} IS NULL`),
      asc(projects.dueDate),
      asc(projects.createdAt)
    )
    .all();
  return withProgress(ctx, rows);
}

export function getProject(ctx: Ctx, id: string): ProjectResponse {
  return withProgress(ctx, [findProject(ctx, id)])[0]!;
}

export function createProject(
  ctx: Ctx,
  body: z.output<typeof createProjectSchema>
): ProjectResponse {
  const row = {
    ...stamp(),
    name: body.name,
    type: body.type ?? ('PERSONAL' as const),
    description: body.description ?? null,
    color: body.color ?? null,
    dueDate: body.dueDate ?? null,
  };
  ctx.db.insert(projects).values(row).run();
  return getProject(ctx, row.id);
}

export function updateProject(
  ctx: Ctx,
  id: string,
  body: z.output<typeof updateProjectSchema>
): ProjectResponse {
  const project = findProject(ctx, id);
  const { completed, ...fields } = body;
  const now = Date.now();
  const patch: Partial<ProjectRow> = { ...fields, updatedAt: now };
  if (completed === true && !project.completedAt) patch.completedAt = now;
  if (completed === false) patch.completedAt = null;
  ctx.db.update(projects).set(patch).where(eq(projects.id, id)).run();
  return getProject(ctx, id);
}

/** As tarefas continuam, agora sem projeto. */
export function deleteProject(ctx: Ctx, id: string) {
  findProject(ctx, id);
  const now = Date.now();
  ctx.db.transaction(() => {
    ctx.db
      .update(tasks)
      .set({ projectId: null, updatedAt: now })
      .where(eq(tasks.projectId, id))
      .run();
    ctx.db
      .update(projects)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(projects.id, id))
      .run();
  });
}
