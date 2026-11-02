import { and, eq, isNull } from 'drizzle-orm';

import type { AppCtx } from '../../app';
import { AppError, notFound, stamp } from '../../services/context';
import { calendars } from '../agenda/schema';
import { defaultCalendar, listCalendars, setDefaultCalendar } from '../agenda/service';

import {
  calendarsOf,
  forgetCalendars,
  pendingEventCount,
  pushPendingEvents,
  syncCalendar,
  syncCalendarList,
} from './calendar';
import {
  CALENDAR_SCOPE,
  exchangeCode,
  fetchUserInfo,
  forgetAccessToken,
  GoogleAuthError,
  hasScope,
  liveAccounts,
  MISSING_PERMISSION_MESSAGE,
  recordFailure,
  rememberAccessToken,
  revokeToken,
  saveAccount,
  secretName,
  TASKS_SCOPE,
  tasksAccount,
} from './client';
import { type GoogleAccountRow, googleAccounts } from './schema';
import { pendingTaskCount, pushPendingTasks, syncTasks, unlinkTasks } from './tasks';

// Uma coisa por vez: job, botão e envio após uma edição mexem nas mesmas linhas e nos mesmos tokens.
const queues = new WeakMap<object, Promise<unknown>>();

function enqueue<T>(ctx: AppCtx, run: () => Promise<T>): Promise<T> {
  const result = (queues.get(ctx) ?? Promise.resolve()).then(run, run);
  queues.set(ctx, result.catch(() => undefined));
  return result;
}

/** Espera o que está na fila. */
export const settled = (ctx: AppCtx) => enqueue(ctx, async () => undefined);

const usable = (account: GoogleAccountRow) => !account.needsReconnect;

async function syncAccountCalendars(ctx: AppCtx, account: GoogleAccountRow) {
  if (!usable(account)) return;
  if (!hasScope(account.scope, CALENDAR_SCOPE)) {
    saveAccount(ctx, account.id, { needsReconnect: true, lastError: MISSING_PERMISSION_MESSAGE });
    return;
  }
  try {
    await syncCalendarList(ctx, account.id);
    for (const calendar of calendarsOf(ctx, account.id)) {
      if (calendar.selected) await syncCalendar(ctx, account.id, calendar);
    }
    await pushPendingEvents(ctx, account.id);
    saveAccount(ctx, account.id, { lastError: null, lastSyncAt: Date.now() });
  } catch (error) {
    recordFailure(ctx, account.id, error);
  }
}

async function syncAccountTasks(ctx: AppCtx) {
  const account = tasksAccount(ctx);
  if (!account || !usable(account)) return;
  if (!hasScope(account.scope, TASKS_SCOPE)) {
    saveAccount(ctx, account.id, { needsReconnect: true, lastError: MISSING_PERMISSION_MESSAGE });
    return;
  }
  try {
    await syncTasks(ctx, account.id, account.tasksSyncedAt);
  } catch (error) {
    recordFailure(ctx, account.id, error);
  }
}

/** Uma conta com problema não segura as outras, e nada aqui lança para quem chamou. */
export function syncAll(ctx: AppCtx, accountId?: string) {
  if (!ctx.google) return Promise.resolve();
  return enqueue(ctx, async () => {
    for (const account of liveAccounts(ctx)) {
      if (accountId && account.id !== accountId) continue;
      await syncAccountCalendars(ctx, account);
    }
    await syncAccountTasks(ctx);
  });
}

/** Depois de uma edição: envia o pendente sem esperar o job. */
export function schedulePush(ctx: AppCtx) {
  if (!ctx.google || !liveAccounts(ctx).length) return;
  void enqueue(ctx, async () => {
    for (const account of liveAccounts(ctx).filter(usable)) {
      try {
        await pushPendingEvents(ctx, account.id);
      } catch (error) {
        recordFailure(ctx, account.id, error);
      }
    }
    const account = tasksAccount(ctx);
    if (!account || !usable(account)) return;
    try {
      await pushPendingTasks(ctx, account.id);
    } catch (error) {
      recordFailure(ctx, account.id, error);
    }
  });
}

/** Fim do login: `code` e `verifier` vêm do processo main, nunca da tela. */
export async function connectAccount(
  ctx: AppCtx,
  input: { code: string; verifier: string; redirectUri: string }
) {
  if (!ctx.google) throw new AppError(400, 'O Google não está configurado neste build.');
  let token;
  try {
    token = await exchangeCode(ctx, input);
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      throw new AppError(400, 'O Google recusou a entrada. Tente de novo.');
    }
    console.error('[google] login', error instanceof Error ? error.message : 'falha');
    throw new AppError(502, 'Não deu para falar com o Google. Tente de novo.');
  }
  const scope = token.scope ?? '';
  if (!hasScope(scope, CALENDAR_SCOPE) || !hasScope(scope, TASKS_SCOPE)) {
    throw new AppError(400, MISSING_PERMISSION_MESSAGE);
  }
  const info = await fetchUserInfo(token.access_token);
  const existing = liveAccounts(ctx).find((account) => account.sub === info.sub);
  if (!existing && !token.refresh_token) {
    throw new AppError(400, 'O Google não deu acesso duradouro. Tente de novo.');
  }

  const fields = {
    email: info.email,
    name: info.name ?? null,
    scope,
    needsReconnect: false,
    lastError: null,
  };
  let id = existing?.id;
  if (id) saveAccount(ctx, id, fields);
  else {
    id = ctx.db
      .insert(googleAccounts)
      .values({ ...stamp(), ...fields, sub: info.sub, syncTasks: !tasksAccount(ctx) })
      .returning()
      .get().id;
  }
  if (token.refresh_token) ctx.secrets.set(secretName(id), token.refresh_token);
  rememberAccessToken(id, token.access_token, token.expires_in);
  await syncAll(ctx, id);
  return { email: info.email };
}

const findAccount = (ctx: AppCtx, id: string) => {
  const row = liveAccounts(ctx).find((account) => account.id === id);
  if (!row) throw notFound('Conta não encontrada.');
  return row;
};

const dateOrNull = (at: number | null) => (at ? new Date(at).toISOString() : null);

export function status(ctx: AppCtx) {
  const accounts = liveAccounts(ctx);
  const views = new Map(listCalendars(ctx).map((row) => [row.id, row]));
  const rows = accounts.flatMap((account) => calendarsOf(ctx, account.id));
  const taskAccount = accounts.find((account) => account.syncTasks);
  return {
    configured: Boolean(ctx.google),
    accounts: accounts.map((account) => ({
      id: account.id,
      email: account.email,
      name: account.name,
      syncTasks: account.syncTasks,
      needsReconnect: account.needsReconnect,
      lastError: account.lastError,
      lastSyncAt: dateOrNull(account.lastSyncAt),
    })),
    calendars: rows.map((row) => ({
      ...views.get(row.id)!,
      accountId: row.externalAccount!,
      primary: row.isPrimary,
      alsoIn: rows
        .filter((other) => other.externalId === row.externalId && other.id !== row.id)
        .map((other) => other.id),
    })),
    defaultCalendarId: defaultCalendar(ctx).id,
    tasksAccountId: taskAccount?.id ?? null,
    tasksSyncedAt: dateOrNull(taskAccount?.tasksSyncedAt ?? null),
    pending: pendingEventCount(ctx) + (taskAccount ? pendingTaskCount(ctx) : 0),
  };
}

/** Marcar ou desmarcar: a leitura do calendário recém-marcado sai junto. */
export async function setCalendarSelected(ctx: AppCtx, id: string, selected: boolean) {
  const row = ctx.db
    .select()
    .from(calendars)
    .where(and(eq(calendars.id, id), eq(calendars.source, 'GOOGLE'), isNull(calendars.deletedAt)))
    .get();
  if (!row) throw notFound('Calendário não encontrado.');
  ctx.db
    .update(calendars)
    .set({ selected, updatedAt: Date.now() })
    .where(eq(calendars.id, id))
    .run();
  if (selected) await syncAll(ctx, row.externalAccount!);
  return status(ctx);
}

export async function setTasksAccount(ctx: AppCtx, accountId: string | null) {
  if (accountId) findAccount(ctx, accountId);
  await enqueue(ctx, async () => {
    ctx.db
      .update(googleAccounts)
      .set({ syncTasks: false, tasksSyncedAt: null, updatedAt: Date.now() })
      .where(isNull(googleAccounts.deletedAt))
      .run();
    unlinkTasks(ctx);
    if (accountId) saveAccount(ctx, accountId, { syncTasks: true });
  });
  if (accountId) await syncAll(ctx, accountId);
  return status(ctx);
}

/**
 * Tira a conta do Sektor: somem as agendas dela e o que veio delas. Os calendários locais não são
 * tocados, as tarefas ficam sem vínculo e nada é apagado no Google.
 */
export async function disconnect(ctx: AppCtx, id: string) {
  findAccount(ctx, id);
  await enqueue(ctx, async () => {
    const account = findAccount(ctx, id);
    const refreshToken = ctx.secrets.get(secretName(id));
    const wasDefault = calendarsOf(ctx, id).some((row) => row.id === defaultCalendar(ctx).id);
    forgetCalendars(ctx, id);
    if (account.syncTasks) unlinkTasks(ctx);
    ctx.db
      .update(googleAccounts)
      .set({ deletedAt: Date.now(), updatedAt: Date.now(), syncTasks: false })
      .where(eq(googleAccounts.id, id))
      .run();
    ctx.secrets.set(secretName(id), null);
    forgetAccessToken(id);
    if (wasDefault) {
      const next = liveAccounts(ctx)
        .flatMap((other) => calendarsOf(ctx, other.id))
        .find((row) => row.isPrimary && !row.readOnly);
      setDefaultCalendar(ctx, next?.id ?? null);
    }
    if (refreshToken) await revokeToken(refreshToken);
  });
  return status(ctx);
}
