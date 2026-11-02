import type { AppCtx } from '../../app';
import { AppError } from '../../services/context';
import { getTask, seriesLinks } from '../tasks';

export interface LiveTask {
  title: string;
  dueDate: string | null;
  dueTime: string | null;
  done: boolean;
}

/** Para onde vai o lembrete quando a tarefa acaba ou sai, numa tarefa recorrente. */
export const taskSeries = (ctx: AppCtx, id: string) => seriesLinks(ctx, id);

/** `gone`: a tarefa foi apagada. `undefined`: não deu para ler, e vale a cópia do lembrete. */
export function readTask(ctx: AppCtx, id: string): LiveTask | 'gone' | undefined {
  try {
    const task = getTask(ctx, id);
    return {
      title: task.title,
      dueDate: task.dueDate,
      dueTime: task.dueTime,
      done: Boolean(task.completedAt),
    };
  } catch (error) {
    return error instanceof AppError && error.status === 404 ? 'gone' : undefined;
  }
}
