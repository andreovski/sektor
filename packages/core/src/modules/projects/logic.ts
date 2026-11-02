import type { EventOccurrence } from '../agenda/view';
import type { TaskResponse } from '../tasks/contract';

/** Sem prazo vai para o fim; no mesmo dia, sem hora vem depois das que têm hora. */
export function byDueDate(tasks: TaskResponse[]) {
  const key = (task: TaskResponse) =>
    `${task.dueDate ?? '9999-99-99'} ${task.dueTime ?? '99:99'}`;
  return [...tasks].sort(
    (a, b) => key(a).localeCompare(key(b)) || a.sortOrder - b.sortOrder
  );
}

/** Eventos do projeto que ainda não acabaram, do mais próximo ao mais distante. */
export function upcomingOfProject(
  occurrences: EventOccurrence[],
  projectId: string,
  today: string,
  now: Date
) {
  const pending = (event: EventOccurrence) =>
    event.allDay ? event.endAt.slice(0, 10) > today : new Date(event.endAt) > now;
  return occurrences
    .filter((event) => event.projectId === projectId && pending(event))
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const text = value.toLocaleString('pt-BR', { maximumFractionDigits: value < 10 ? 1 : 0 });
  return `${text} ${units[unit]}`;
}

/** A primeira linha com texto, sem as marcas do Markdown: é o nome da nota na lista. */
export function noteTitle(body: string) {
  const line = body.split('\n').find((text) => text.trim());
  if (!line) return 'Nota vazia';
  return line.replace(/^\s*(#{1,6}\s+|[-*]\s+|\d+\.\s+|>\s*)/, '').replace(/[*`]/g, '').trim();
}
