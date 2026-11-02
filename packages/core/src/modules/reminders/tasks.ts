import type { AppCtx } from '../../app';
import { AppError } from '../../services/context';
import { getTask } from '../tasks';

export interface LiveTask {
  title: string;
  dueDate: string | null;
  dueTime: string | null;
  done: boolean;
}

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
