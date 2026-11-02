import type { KeyStore } from './bank/client';
import { type DbHandle, openDatabase } from './db/client';
import { appMeta } from './db/schema';
import { handlers as agenda, jobs as agendaJobs } from './modules/agenda';
import {
  chooseFolder,
  type DbStore,
  handlers as backup,
  jobs as backupJobs,
  savedTimeZone,
} from './modules/backup';
import { handlers as finance, jobs as financeJobs } from './modules/finance';
import { handlers as financePlus, jobs as financePlusJobs } from './modules/financePlus';
import { handlers as focus, jobs as focusJobs } from './modules/focus';
import { handlers as goals, jobs as goalsJobs } from './modules/goals';
import {
  connectAccount,
  handlers as google,
  jobs as googleJobs,
  schedulePush,
  syncAll,
} from './modules/google';
import { handlers as habits, jobs as habitsJobs } from './modules/habits';
import { handlers as health, jobs as healthJobs } from './modules/health';
import { handlers as projects, jobs as projectsJobs } from './modules/projects';
import { handlers as reminders, jobs as remindersJobs } from './modules/reminders';
import { handlers as review, jobs as reviewJobs } from './modules/review';
import { handlers as tasks, jobs as tasksJobs } from './modules/tasks';
import { ensureCategories } from './services/categories';
import { AppError, type Ctx } from './services/context';

/** Tudo o que um módulo recebe. `notify` vira notificação nativa; `secrets` vive no cofre. */
export interface AppCtx extends Ctx {
  keys: KeyStore;
  secrets: Secrets;
  notify(title: string, body: string): void;
  /** Credenciais do app no Google. Sem elas, nada do Google roda. */
  google?: GoogleConfig | null;
}

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
}

export interface Secrets {
  get(name: string): string | null;
  set(name: string, value: string | null): void;
}

/** Trabalho periódico. Roda com o app aberto ou na bandeja, e recupera o atraso ao abrir. */
export interface Job {
  name: string;
  everyMs: number;
  run(ctx: AppCtx): unknown;
}

const buildHandlers = (ctx: AppCtx, store: DbStore, systemTimeZone: string) => ({
  ...finance(ctx),
  ...financePlus(ctx),
  ...tasks(ctx),
  ...projects(ctx),
  ...agenda(ctx),
  ...reminders(ctx),
  ...habits(ctx),
  ...goals(ctx),
  ...health(ctx),
  ...focus(ctx),
  ...review(ctx),
  ...google(ctx),
  ...backup(ctx, store, systemTimeZone),
});

export type Rpc = ReturnType<typeof buildHandlers>;

const JOBS: Job[] = [
  ...financeJobs,
  ...financePlusJobs,
  ...tasksJobs,
  ...projectsJobs,
  ...agendaJobs,
  ...remindersJobs,
  ...habitsJobs,
  ...goalsJobs,
  ...healthJobs,
  ...focusJobs,
  ...reviewJobs,
  ...googleJobs,
];

export interface AppOptions {
  dbPath: string;
  keyHex: string;
  timeZone: string;
  secrets: Secrets;
  notify(title: string, body: string): void;
  google?: GoogleConfig | null;
}

export interface App {
  handle: DbHandle;
  ctx: AppCtx;
  /** Resposta serializável: nunca lança para o outro lado do canal. */
  call(method: string, input: unknown): Promise<RpcResult>;
  tick(): Promise<void>;
  /** Fora do RPC: o caminho vem do diálogo do main, nunca da tela. */
  chooseBackupFolder(folder: string): { folder: string; recoveryPassword: string | null };
  /** Fora do RPC: o código do login vem do main, nunca da tela. */
  connectGoogle(input: { code: string; verifier: string; redirectUri: string }): Promise<{ email: string }>;
  /** Ao abrir o app, sem esperar o intervalo do job. */
  syncGoogle(): Promise<void>;
}

export type RpcResult =
  | { ok: true; value: unknown }
  | { ok: false; status: number; message: string };

const SECRET_NAME = 'pluggy';

/** Escritas que o Google precisa saber: saem na hora, sem esperar os 5 minutos do job. */
const GOOGLE_WRITES =
  /^(events\.(create|update|delete)|tasks\.(create|capture|update|complete|reopen|delete)|taskLists\.(create|update|delete))$/;

// O intervalo de 60 s do relógio oscila alguns ms. A folga faz um job de 60 s rodar em todo tick.
const TICK_SLACK_MS = 5_000;

export function createApp(options: AppOptions): App {
  const handle = openDatabase(options.dbPath, options.keyHex);
  const keys: KeyStore = {
    get() {
      const raw = options.secrets.get(SECRET_NAME);
      return raw ? JSON.parse(raw) : null;
    },
    set(value) {
      options.secrets.set(SECRET_NAME, value ? JSON.stringify(value) : null);
    },
  };
  const ctx: AppCtx = {
    db: handle.orm,
    timeZone: options.timeZone,
    keys,
    secrets: options.secrets,
    notify: options.notify,
    google: options.google ?? null,
  };
  ctx.timeZone = savedTimeZone(ctx) ?? options.timeZone;
  ensureCategories(ctx);
  const store: DbStore = { raw: handle.raw, path: options.dbPath, keyHex: options.keyHex };
  const handlers = buildHandlers(ctx, store, options.timeZone) as Record<
    string,
    (input: never) => unknown
  >;
  const jobs = [...JOBS, ...backupJobs(store)];

  const running = new Set<string>();
  return {
    handle,
    ctx,
    async call(method, input) {
      const handler = handlers[method];
      if (!handler) return { ok: false, status: 404, message: `Método ${method} não existe.` };
      try {
        const value = await handler((input ?? {}) as never);
        if (GOOGLE_WRITES.test(method)) schedulePush(ctx);
        return { ok: true, value };
      } catch (error) {
        if (error instanceof AppError) {
          return { ok: false, status: error.status, message: error.message };
        }
        console.error(`[rpc] ${method}`, error);
        return { ok: false, status: 500, message: 'Algo deu errado. Tente de novo.' };
      }
    },
    async tick() {
      for (const job of jobs) {
        if (running.has(job.name)) continue;
        const key = `job:${job.name}`;
        const last = Number(
          ctx.db.select().from(appMeta).all().find((row) => row.key === key)?.value ?? 0
        );
        // A rodada conta de quando começou: um job demorado não empurra o próximo.
        const started = Date.now();
        if (started - last + TICK_SLACK_MS < job.everyMs) continue;
        running.add(job.name);
        try {
          await job.run(ctx);
          const value = String(started);
          ctx.db
            .insert(appMeta)
            .values({ key, value, updatedAt: Date.now() })
            .onConflictDoUpdate({ target: appMeta.key, set: { value, updatedAt: Date.now() } })
            .run();
        } catch (error) {
          console.error(`[job] ${job.name}`, error);
        } finally {
          running.delete(job.name);
        }
      }
    },
    chooseBackupFolder: (folder) => chooseFolder(ctx, store, folder),
    connectGoogle: (input) => connectAccount(ctx, input),
    syncGoogle: () => syncAll(ctx),
  };
}
