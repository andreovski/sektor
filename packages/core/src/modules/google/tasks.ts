import { and, asc, eq, inArray, isNotNull, isNull, max, ne, or, sql } from 'drizzle-orm';

import type { AppCtx } from '../../app';
import { stamp } from '../../services/context';
import { taskLists, tasks } from '../tasks/schema';
import { completeTask, inboxId, projectOfList, reopenTask } from '../tasks/service';

import { GoogleAuthError, googleFetch, isAccountWide, isNotFound, saveAccount } from './client';

// Google Tasks não tem syncToken: a cada rodada vem o que mudou desde `updatedMin`. O Google guarda
// só o dia do prazo, sem hora, recorrência nem prioridade: isso fica no Sektor.

const API = 'https://tasks.googleapis.com/tasks/v1';
/** Folga na leitura: o relógio daqui e o de lá não batem. */
const OVERLAP_MS = 60_000;

type TaskRow = typeof tasks.$inferSelect;
type ListRow = typeof taskLists.$inferSelect;

interface GoogleTaskList {
  id: string;
  title: string;
}

export interface GoogleTask {
  id: string;
  etag?: string;
  title?: string;
  notes?: string;
  status?: 'needsAction' | 'completed';
  due?: string;
  completed?: string;
  deleted?: boolean;
  hidden?: boolean;
  parent?: string;
  updated?: string;
}

const enc = (value: string) => encodeURIComponent(value);
const pendingStates = inArray(tasks.syncState, ['PENDING', 'ERROR']);
const ignoreGone = (error: unknown) => {
  if (!isNotFound(error)) throw error;
};

const liveLists = (ctx: AppCtx) =>
  ctx.db.select().from(taskLists).where(isNull(taskLists.deletedAt)).all();

function saveList(ctx: AppCtx, id: string, data: Partial<ListRow>) {
  ctx.db.update(taskLists).set(data).where(eq(taskLists.id, id)).run();
}

// ---------------------------------------------------------------- listas

async function remoteLists(ctx: AppCtx, accountId: string) {
  const items: GoogleTaskList[] = [];
  let pageToken: string | undefined;
  do {
    const page = await googleFetch<{ items?: GoogleTaskList[]; nextPageToken?: string }>(
      ctx,
      accountId,
      `${API}/users/@me/lists`,
      { query: { maxResults: '100', pageToken } }
    );
    items.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return items;
}

/** A lista padrão do Google é a Entrada. As outras se casam pelo id e, sem id, pelo nome. */
async function pullLists(ctx: AppCtx, accountId: string) {
  const inbox = inboxId(ctx);
  const remote = await remoteLists(ctx, accountId);
  const fallback = await googleFetch<GoogleTaskList>(
    ctx,
    accountId,
    `${API}/users/@me/lists/@default`
  );
  saveList(ctx, inbox, { externalId: fallback.id, syncState: 'SYNCED' });

  for (const list of remote) {
    if (list.id === fallback.id) continue;
    const local = liveLists(ctx);
    const existing =
      local.find((row) => row.externalId === list.id) ??
      local.find((row) => !row.externalId && !row.isInbox && row.name === list.title);
    if (!existing) {
      const last = ctx.db
        .select({ value: max(taskLists.sortOrder) })
        .from(taskLists)
        .where(isNull(taskLists.deletedAt))
        .get();
      ctx.db
        .insert(taskLists)
        .values({
          ...stamp(),
          name: list.title,
          sortOrder: (last?.value ?? -1) + 1,
          source: 'GOOGLE',
          externalId: list.id,
          syncState: 'SYNCED',
        })
        .run();
      continue;
    }
    const pending = existing.syncState !== 'SYNCED' && Boolean(existing.externalId);
    saveList(ctx, existing.id, {
      externalId: list.id,
      ...(pending ? {} : { name: list.title, syncState: 'SYNCED' as const }),
    });
  }

  // Lista apagada no Google: a daqui fica, e sobe de novo. Nada se perde sem a pessoa pedir.
  const seen = new Set(remote.map((list) => list.id));
  const orphans = liveLists(ctx).filter(
    (row) => row.externalId && !row.isInbox && !seen.has(row.externalId)
  );
  for (const list of orphans) {
    ctx.db
      .update(tasks)
      .set({ ...unlinked, updatedAt: Date.now() })
      .where(and(eq(tasks.listId, list.id), isNull(tasks.deletedAt)))
      .run();
    saveList(ctx, list.id, { externalId: null, syncState: 'PENDING' });
  }
}

async function pushLists(ctx: AppCtx, accountId: string) {
  const gone = ctx.db
    .select()
    .from(taskLists)
    .where(
      and(
        isNotNull(taskLists.deletedAt),
        isNotNull(taskLists.externalId),
        ne(taskLists.syncState, 'SYNCED')
      )
    )
    .all();
  for (const list of gone) {
    await googleFetch(ctx, accountId, `${API}/users/@me/lists/${enc(list.externalId!)}`, {
      method: 'DELETE',
    }).catch(ignoreGone);
    saveList(ctx, list.id, { syncState: 'SYNCED' });
    // Com a lista vão as tarefas dela.
    ctx.db
      .update(tasks)
      .set({ syncState: 'SYNCED' })
      .where(and(eq(tasks.listId, list.id), isNotNull(tasks.deletedAt)))
      .run();
  }

  const local = liveLists(ctx).filter(
    (row) => !row.isInbox && (!row.externalId || row.syncState !== 'SYNCED')
  );
  for (const list of local) {
    const result = list.externalId
      ? await googleFetch<GoogleTaskList>(
          ctx,
          accountId,
          `${API}/users/@me/lists/${enc(list.externalId)}`,
          { method: 'PATCH', body: { title: list.name } }
        )
      : await googleFetch<GoogleTaskList>(ctx, accountId, `${API}/users/@me/lists`, {
          method: 'POST',
          body: { title: list.name },
        });
    saveList(ctx, list.id, { externalId: result.id });
    ctx.db
      .update(taskLists)
      .set({ syncState: 'SYNCED' })
      .where(and(eq(taskLists.id, list.id), eq(taskLists.updatedAt, list.updatedAt)))
      .run();
  }
}

// ---------------------------------------------------------------- Google -> Sektor

async function listChanges(ctx: AppCtx, accountId: string, listId: string, since: number | null) {
  const items: GoogleTask[] = [];
  let pageToken: string | undefined;
  do {
    const page = await googleFetch<{ items?: GoogleTask[]; nextPageToken?: string }>(
      ctx,
      accountId,
      `${API}/lists/${enc(listId)}/tasks`,
      {
        query: {
          maxResults: '100',
          showCompleted: 'true',
          showHidden: 'true',
          showDeleted: 'true',
          pageToken,
          updatedMin: since ? new Date(since).toISOString() : undefined,
        },
      }
    );
    items.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return items;
}

const findByExternal = (ctx: AppCtx, externalId: string) =>
  ctx.db
    .select()
    .from(tasks)
    .where(eq(tasks.externalId, externalId))
    .orderBy(sql`${tasks.deletedAt} IS NOT NULL`)
    .get();

/** Tarefa daqui, ainda sem par, que é a mesma de lá: voltar a uma conta não duplica tudo. */
function findTwin(ctx: AppCtx, listId: string, item: GoogleTask) {
  const title = item.title?.trim();
  if (!title) return undefined;
  const day = item.due?.slice(0, 10) ?? null;
  return ctx.db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.listId, listId),
        eq(tasks.title, title),
        day ? eq(tasks.dueDate, day) : isNull(tasks.dueDate),
        isNull(tasks.externalId),
        isNull(tasks.deletedAt)
      )
    )
    .get();
}

function removeLocal(ctx: AppCtx, row: TaskRow) {
  const now = Date.now();
  ctx.db
    .update(tasks)
    .set({ deletedAt: now, updatedAt: now, syncState: 'SYNCED' })
    .where(and(or(eq(tasks.id, row.id), eq(tasks.parentTaskId, row.id)), isNull(tasks.deletedAt)))
    .run();
}

function applyRemote(ctx: AppCtx, list: ListRow, item: GoogleTask, order: () => number) {
  const existing = findByExternal(ctx, item.id);
  // Mudança local pendente vence, e apagada aqui segue apagada.
  if (existing && (existing.deletedAt || existing.syncState !== 'SYNCED')) return;
  if (item.deleted) {
    if (existing) removeLocal(ctx, existing);
    return;
  }
  const twin = existing ? undefined : findTwin(ctx, list.id, item);
  if (twin) {
    ctx.db
      .update(tasks)
      .set({
        externalId: item.id,
        externalEtag: item.etag ?? null,
        externalListId: list.externalId,
        externalParentId: item.parent ?? null,
      })
      .where(eq(tasks.id, twin.id))
      .run();
    return;
  }

  const dueDate = item.due?.slice(0, 10) ?? null;
  const fields = {
    title: item.title?.trim() || '(sem título)',
    notes: item.notes ?? null,
    dueDate,
    // Hora feita no Sektor: o Google só tem o dia, então vale enquanto o dia for o mesmo.
    dueTime: existing && existing.dueDate === dueDate ? existing.dueTime : null,
    listId: list.id,
    projectId: projectOfList(ctx, list.id),
    externalId: item.id,
    externalEtag: item.etag ?? null,
    externalListId: list.externalId,
    externalParentId: item.parent ?? null,
    syncState: 'SYNCED' as const,
  };
  const done = item.status === 'completed';
  const completedAt = item.completed ? new Date(item.completed).getTime() : Date.now();

  if (!existing) {
    ctx.db
      .insert(tasks)
      .values({
        ...stamp(),
        ...fields,
        status: done ? 'DONE' : 'TODO',
        completedAt: done ? completedAt : null,
        sortOrder: order(),
        source: 'GOOGLE',
      })
      .run();
    return;
  }
  // Pela regra do módulo: concluir uma tarefa recorrente gera a próxima, reabrir a tira.
  if (done && !existing.completedAt) completeTask(ctx, existing.id);
  if (!done && existing.completedAt) reopenTask(ctx, existing.id);
  ctx.db
    .update(tasks)
    .set({ ...fields, updatedAt: Date.now() })
    .where(eq(tasks.id, existing.id))
    .run();
}

function linkParents(ctx: AppCtx, items: GoogleTask[]) {
  for (const item of items) {
    if (item.deleted) continue;
    const row = findByExternal(ctx, item.id);
    if (!row || row.deletedAt || row.syncState !== 'SYNCED') continue;
    const parent = item.parent ? findByExternal(ctx, item.parent) : undefined;
    const parentTaskId = parent && !parent.deletedAt && !parent.parentTaskId ? parent.id : null;
    if (parentTaskId === row.parentTaskId) continue;
    ctx.db.update(tasks).set({ parentTaskId }).where(eq(tasks.id, row.id)).run();
  }
}

async function pullList(ctx: AppCtx, accountId: string, list: ListRow, since: number | null) {
  const items = await listChanges(ctx, accountId, list.externalId!, since);
  let next =
    (ctx.db
      .select({ value: max(tasks.sortOrder) })
      .from(tasks)
      .where(and(eq(tasks.listId, list.id), isNull(tasks.deletedAt)))
      .get()?.value ?? -1) + 1;
  for (const item of items) applyRemote(ctx, list, item, () => next++);
  linkParents(ctx, items);
}

// ---------------------------------------------------------------- Sektor -> Google

const googleBody = (task: TaskRow) => ({
  title: task.title,
  notes: task.notes ?? '',
  due: task.dueDate ? `${task.dueDate}T00:00:00.000Z` : null,
  status: task.completedAt ? 'completed' : 'needsAction',
  completed: task.completedAt ? new Date(task.completedAt).toISOString() : null,
});

/** Quem mudou enquanto a chamada estava no ar continua pendente. */
function settle(ctx: AppCtx, task: TaskRow, data: Partial<TaskRow>) {
  ctx.db.update(tasks).set(data).where(eq(tasks.id, task.id)).run();
  ctx.db
    .update(tasks)
    .set({ syncState: 'SYNCED' })
    .where(and(eq(tasks.id, task.id), eq(tasks.updatedAt, task.updatedAt)))
    .run();
}

const taskUrl = (listId: string, taskId: string) =>
  `${API}/lists/${enc(listId)}/tasks/${enc(taskId)}`;

async function removeRemote(ctx: AppCtx, accountId: string, task: TaskRow) {
  if (!task.externalId || !task.externalListId) return;
  await googleFetch(ctx, accountId, taskUrl(task.externalListId, task.externalId), {
    method: 'DELETE',
  }).catch(ignoreGone);
}

async function pushTask(ctx: AppCtx, accountId: string, task: TaskRow) {
  if (task.deletedAt) {
    await removeRemote(ctx, accountId, task);
    return settle(ctx, task, { externalParentId: null });
  }
  const list = ctx.db.select().from(taskLists).where(eq(taskLists.id, task.listId)).get();
  if (!list?.externalId) return;

  const parent = task.parentTaskId
    ? ctx.db.select().from(tasks).where(eq(tasks.id, task.parentTaskId)).get()
    : undefined;
  if (task.parentTaskId && !parent?.externalId) return;
  const parentId = parent?.externalId ?? null;

  // Trocou de lista: lá, é uma tarefa apagada numa e criada na outra.
  let externalId = task.externalId;
  if (externalId && task.externalListId && task.externalListId !== list.externalId) {
    await removeRemote(ctx, accountId, task);
    externalId = null;
  }

  const listUrl = `${API}/lists/${enc(list.externalId)}/tasks`;
  const create = () =>
    googleFetch<GoogleTask>(ctx, accountId, listUrl, {
      method: 'POST',
      body: googleBody(task),
      query: { parent: parentId ?? undefined },
    });

  let result: GoogleTask;
  if (!externalId) result = await create();
  else {
    try {
      result = await googleFetch<GoogleTask>(ctx, accountId, taskUrl(list.externalId, externalId), {
        method: 'PATCH',
        body: googleBody(task),
      });
      if (parentId !== task.externalParentId) {
        result = await googleFetch<GoogleTask>(
          ctx,
          accountId,
          `${taskUrl(list.externalId, externalId)}/move`,
          { method: 'POST', query: { parent: parentId ?? undefined } }
        );
      }
    } catch (error) {
      if (!isNotFound(error)) throw error;
      // Sumiu de lá enquanto mudava aqui: a mudança local vence, e a tarefa nasce de novo.
      result = await create();
    }
  }
  settle(ctx, task, {
    externalId: result.id,
    externalEtag: result.etag ?? null,
    externalListId: list.externalId,
    externalParentId: parentId,
  });
}

export async function pushPendingTasks(ctx: AppCtx, accountId: string) {
  await pushLists(ctx, accountId);
  // Mães antes das subtarefas: a subtarefa precisa do id da mãe no Google.
  const pending = ctx.db
    .select()
    .from(tasks)
    .where(pendingStates)
    .orderBy(asc(sql`${tasks.parentTaskId} IS NOT NULL`), asc(tasks.createdAt))
    .all();
  for (const row of pending) {
    // A leitura é de antes: a mãe enviada neste laço já tem id, e a linha pode ter mudado.
    const task = ctx.db.select().from(tasks).where(eq(tasks.id, row.id)).get();
    if (!task || task.syncState === 'SYNCED') continue;
    try {
      await pushTask(ctx, accountId, task);
    } catch (error) {
      if (error instanceof GoogleAuthError || isAccountWide(error)) throw error;
      ctx.db
        .update(tasks)
        .set({ syncState: 'ERROR' })
        .where(and(eq(tasks.id, task.id), eq(tasks.updatedAt, task.updatedAt)))
        .run();
    }
  }
}

export const pendingTaskCount = (ctx: AppCtx) =>
  ctx.db.select({ id: tasks.id }).from(tasks).where(pendingStates).all().length;

/** Lê listas e mudanças e envia o que está pendente. Quem chama trata as falhas. */
export async function syncTasks(ctx: AppCtx, accountId: string, syncedAt: number | null) {
  const startedAt = Date.now();
  await pullLists(ctx, accountId);
  await pushLists(ctx, accountId);
  const since = syncedAt ? syncedAt - OVERLAP_MS : null;
  const linked = liveLists(ctx).filter((list) => list.externalId);
  for (const list of linked) await pullList(ctx, accountId, list, since);
  await pushPendingTasks(ctx, accountId);
  saveAccount(ctx, accountId, { tasksSyncedAt: startedAt });
}

const unlinked = {
  externalId: null,
  externalEtag: null,
  externalListId: null,
  externalParentId: null,
  syncState: 'PENDING' as const,
};

/** Tira o vínculo com a conta. Nada se perde: sobem de novo se houver outra conta. */
export function unlinkTasks(ctx: AppCtx) {
  ctx.db.update(tasks).set({ syncState: 'SYNCED' }).where(isNotNull(tasks.deletedAt)).run();
  ctx.db.update(tasks).set({ ...unlinked, source: 'LOCAL' }).where(isNull(tasks.deletedAt)).run();
  ctx.db.update(taskLists).set({ syncState: 'SYNCED' }).where(isNotNull(taskLists.deletedAt)).run();
  ctx.db
    .update(taskLists)
    .set({ externalId: null, source: 'LOCAL', syncState: 'PENDING' })
    .where(isNull(taskLists.deletedAt))
    .run();
}
