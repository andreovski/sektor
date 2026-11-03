import {
  buildRRule,
  dateStringInZone,
  dateStringToUtc,
  diffInDays,
  type Frequency,
  instantToWallTime,
  parseSimpleRRule,
} from '@sektor/finance-engine';

import {
  type CreateTaskBody,
  type ListTasksQuery,
  TASK_STATUS_LABELS,
  type TaskListResponse,
  type TaskPriority,
  type TaskResponse,
  type TaskStatus,
  type TaskView,
} from './contract';

// Regras puras da tela: moram aqui para o teste do núcleo alcançá-las.

// ------------------------------------------------------------------ listas inteligentes

export type SmartSlug = 'hoje' | 'programadas' | 'atrasadas' | 'sem-prazo' | 'todas' | 'concluidas';

export interface SmartViewMeta {
  slug: SmartSlug;
  /** Visão do núcleo; `undefined` = todas as abertas. */
  view: TaskView | undefined;
  /** Campo de `tasks.counts`. */
  count: 'today' | 'next7' | 'overdue' | 'nodate' | 'all' | 'completed';
  title: string;
  emptyTitle: string;
}

export const SMART_VIEWS: SmartViewMeta[] = [
  { slug: 'hoje', view: 'today', count: 'today', title: 'Hoje', emptyTitle: 'Tudo em dia' },
  {
    slug: 'programadas',
    view: 'next7',
    count: 'next7',
    title: 'Programadas',
    emptyTitle: 'Nada programado',
  },
  {
    slug: 'atrasadas',
    view: 'overdue',
    count: 'overdue',
    title: 'Atrasadas',
    emptyTitle: 'Nada atrasado',
  },
  {
    slug: 'sem-prazo',
    view: 'nodate',
    count: 'nodate',
    title: 'Sem prazo',
    emptyTitle: 'Nenhuma tarefa sem prazo',
  },
  { slug: 'todas', view: undefined, count: 'all', title: 'Todas', emptyTitle: 'Nenhuma tarefa' },
  {
    slug: 'concluidas',
    view: 'completed',
    count: 'completed',
    title: 'Concluídas',
    emptyTitle: 'Nenhuma tarefa concluída',
  },
];

export function smartView(param: string): SmartViewMeta | undefined {
  return SMART_VIEWS.find((view) => view.slug === param);
}

export type ListTarget =
  | { kind: 'smart'; meta: SmartViewMeta; tag?: string }
  | { kind: 'list'; id: string; tag?: string };

/** O parâmetro da tela é o id de uma lista ou o nome de uma lista inteligente. */
export function resolveListParam(param: string, tag?: string): ListTarget {
  const meta = smartView(param);
  if (meta) return { kind: 'smart', meta, tag: tag || undefined };
  return { kind: 'list', id: param, tag: tag || undefined };
}

export function queryForTarget(target: ListTarget): ListTasksQuery {
  if (target.kind === 'list') return { listId: target.id, tag: target.tag };
  return { view: target.meta.view, tag: target.tag };
}

/** A captura não aparece onde a tarefa nova sumiria na hora. */
export function canCapture(target: ListTarget) {
  return target.kind === 'list' || !['atrasadas', 'concluidas'].includes(target.meta.slug);
}

/** O que a captura herda da lista aberta. */
export function captureDefaults(target: ListTarget, today: string) {
  const defaults: { listId?: string; defaultDueDate?: string; defaultTag?: string } = {};
  if (target.kind === 'list') defaults.listId = target.id;
  else if (target.meta.slug === 'hoje' || target.meta.slug === 'programadas') {
    defaults.defaultDueDate = today;
  }
  if (target.tag) defaults.defaultTag = target.tag;
  return defaults;
}

export function sortLists(lists: TaskListResponse[]) {
  return [...lists].sort(
    (a, b) => Number(b.isInbox) - Number(a.isInbox) || a.sortOrder - b.sortOrder
  );
}

// ------------------------------------------------------------------ prazo e prioridade

export interface DueInfo {
  label: string;
  overdue: boolean;
}

export function relativeDay(date: string, today: string) {
  const days = diffInDays(today, date);
  if (days === 0) return 'Hoje';
  if (days === 1) return 'Amanhã';
  if (days === -1) return 'Ontem';
  const utc = dateStringToUtc(date);
  const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' }).format(utc);
  const day = new Intl.DateTimeFormat('pt-BR', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(utc);
  return `${weekday}, ${day}${date.slice(0, 4) === today.slice(0, 4) ? '' : ` de ${date.slice(0, 4)}`}`;
}

/** "Hoje", "Amanhã, 14:00", "qua., 22 de out." — atrasada quando passou. */
export function dueInfo(
  task: Pick<TaskResponse, 'dueDate' | 'dueTime' | 'completedAt'>,
  today: string,
  clock: string
): DueInfo | null {
  if (!task.dueDate) return null;
  const day = relativeDay(task.dueDate, today);
  return {
    label: task.dueTime ? `${day}, ${task.dueTime}` : day,
    overdue:
      !task.completedAt &&
      (task.dueDate < today ||
        (task.dueDate === today && task.dueTime !== null && task.dueTime < clock)),
  };
}

export function clockAt(instant: Date, timeZone?: string) {
  const zone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const wall = instantToWallTime(instant, zone);
  return `${String(wall.hour).padStart(2, '0')}:${String(wall.minute).padStart(2, '0')}`;
}

/** "Concluída hoje às 14:30", "Concluída ontem às 09:05", "Concluída em 22/10 às 18:00". */
export function completedLabel(
  task: Pick<TaskResponse, 'completedAt'>,
  now: Date,
  timeZone?: string
): string | null {
  if (!task.completedAt) return null;
  const zone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const instant = new Date(task.completedAt);
  const key = dateStringInZone(instant, zone);
  const today = dateStringInZone(now, zone);
  const [year, month, day] = key.split('-');
  const days = diffInDays(today, key);
  const when =
    days === 0
      ? 'hoje'
      : days === -1
        ? 'ontem'
        : `em ${day}/${month}${year === today.slice(0, 4) ? '' : `/${year}`}`;
  return `Concluída ${when} às ${clockAt(instant, zone)}`;
}

/** Quantas das três barras ficam acesas. */
export function priorityBars(priority: TaskPriority | null | undefined) {
  if (priority === 'HIGH') return 3;
  if (priority === 'MEDIUM') return 2;
  if (priority === 'LOW') return 1;
  return 0;
}

// ------------------------------------------------------------------ ordem e agrupamento

/** Move `activeId` para a posição de `overId` (o que o arrastar faz). */
export function moveId(ids: string[], activeId: string, overId: string) {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return ids;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, activeId);
  return next;
}

/** Aplica uma ordem local (enquanto o núcleo grava) sobre a lista que veio dele. */
export function applyOrder<T extends { id: string }>(items: T[], order: string[] | null) {
  if (!order) return items;
  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered = order.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
  const rest = items.filter((item) => !order.includes(item.id));
  return [...ordered, ...rest];
}

/** Subtarefas mostradas na lista: só as abertas (na visão de concluídas, todas). */
export function visibleSubtasks(task: TaskResponse, showCompleted: boolean) {
  return showCompleted ? task.subtasks : task.subtasks.filter((sub) => !sub.completedAt);
}

export const STATUS_ORDER: TaskStatus[] = ['IN_PROGRESS', 'REVIEW', 'TODO', 'BACKLOG', 'DONE'];

export const BOARD_COLUMNS: TaskStatus[] = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'];

export interface StatusGroup {
  status: TaskStatus;
  title: string;
  tasks: TaskResponse[];
}

/** Grupos da lista, sem os vazios: o que está andando primeiro. */
export function groupByStatus(tasks: TaskResponse[]): StatusGroup[] {
  return STATUS_ORDER.map((status) => ({
    status,
    title: TASK_STATUS_LABELS[status],
    tasks: tasks.filter((task) => task.status === status),
  })).filter((group) => group.tasks.length > 0);
}

/** Colunas do Kanban, com as vazias. Status mudado na tela vale até o núcleo responder. */
export function boardColumns(
  tasks: TaskResponse[],
  moved: Record<string, TaskStatus> = {}
): StatusGroup[] {
  const statusOf = (task: TaskResponse) => moved[task.id] ?? task.status;
  return BOARD_COLUMNS.map((status) => {
    const inColumn = tasks.filter((task) => statusOf(task) === status);
    return {
      status,
      title: TASK_STATUS_LABELS[status],
      tasks:
        status === 'DONE'
          ? [...inColumn].sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
          : inColumn,
    };
  });
}

// ------------------------------------------------------------------ etiquetas

export function normalizeTag(raw: string) {
  return raw.trim().replace(/^#+/, '').trim().replace(/\s+/g, '-').slice(0, 30);
}

/** Acrescenta uma etiqueta (sem repetir, sem diferenciar maiúsculas; no máximo 10). */
export function addTag(tags: string[], raw: string) {
  const tag = normalizeTag(raw);
  if (!tag || tags.length >= 10) return tags;
  if (tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) return tags;
  return [...tags, tag];
}

// ------------------------------------------------------------------ formulário

export const REPEAT_OPTIONS: { value: '' | Frequency; label: string }[] = [
  { value: '', label: 'Nunca' },
  { value: 'DAILY', label: 'Diariamente' },
  { value: 'WEEKLY', label: 'Semanalmente' },
  { value: 'MONTHLY', label: 'Mensalmente' },
  { value: 'YEARLY', label: 'Anualmente' },
];

/** A regra simples vira a opção do seletor; regra complexa é preservada. */
export function repeatValue(rrule: string | null): string {
  if (!rrule) return '';
  const parsed = parseSimpleRRule(rrule);
  if (
    parsed &&
    (!parsed.byWeekday?.length || parsed.freq === 'WEEKLY') &&
    !parsed.count &&
    !parsed.until &&
    (!parsed.interval || parsed.interval === 1)
  ) {
    return parsed.freq;
  }
  return rrule;
}

/** Dias da semana de uma repetição semanal (0 = domingo); vazio fora dela. */
export function weekdaysOf(rrule: string | null): number[] {
  const parsed = rrule ? parseSimpleRRule(rrule) : null;
  return parsed?.freq === 'WEEKLY' ? (parsed.byWeekday ?? []) : [];
}

export interface TaskForm {
  title: string;
  notes: string;
  hasDate: boolean;
  date: string;
  hasTime: boolean;
  time: string;
  /** '' | frequência simples | regra completa preservada. */
  repeat: string;
  /** Na repetição semanal, os dias (0 = domingo); vazio é o dia do prazo. */
  weekdays: number[];
  tags: string[];
  priority: TaskPriority | null;
  status: TaskStatus;
  /** A lista diz também o projeto: a de um projeto é a dele. */
  listId: string;
}

export function formFromTask(
  task: TaskResponse | null,
  defaults: { listId: string; today: string; date?: string }
): TaskForm {
  if (!task) {
    return {
      title: '',
      notes: '',
      hasDate: Boolean(defaults.date),
      date: defaults.date ?? defaults.today,
      hasTime: false,
      time: '09:00',
      repeat: '',
      weekdays: [],
      tags: [],
      priority: null,
      status: 'TODO',
      listId: defaults.listId,
    };
  }
  return {
    title: task.title,
    notes: task.notes ?? '',
    hasDate: Boolean(task.dueDate),
    date: task.dueDate ?? defaults.today,
    hasTime: Boolean(task.dueTime),
    time: task.dueTime ?? '09:00',
    repeat: repeatValue(task.rrule),
    weekdays: weekdaysOf(task.rrule),
    tags: task.tags,
    priority: task.priority,
    status: task.status,
    listId: task.listId,
  };
}

/** O corpo do núcleo a partir do formulário (o mesmo para criar e editar). */
export function bodyFromForm(form: TaskForm) {
  const dueDate = form.hasDate && form.date ? form.date : null;
  const rrule =
    !dueDate || !form.repeat
      ? null
      : form.repeat.startsWith('FREQ=')
        ? form.repeat
        : buildRRule({
            freq: form.repeat as Frequency,
            ...(form.repeat === 'WEEKLY' && form.weekdays.length
              ? { byWeekday: form.weekdays }
              : {}),
          });
  return {
    title: form.title.trim(),
    notes: form.notes.trim() || null,
    dueDate,
    dueTime: dueDate && form.hasTime && form.time ? form.time : null,
    rrule,
    tags: form.tags,
    priority: form.priority,
    status: form.status,
    listId: form.listId || undefined,
  } satisfies CreateTaskBody;
}

/** Procura uma tarefa (ou subtarefa) pelo id nas listas carregadas. */
export function findTask(groups: (TaskResponse[] | undefined)[], id: string | null) {
  if (!id) return null;
  for (const tasks of groups) {
    for (const task of tasks ?? []) {
      if (task.id === id) return task;
      const sub = task.subtasks.find((s) => s.id === id);
      if (sub) return sub;
    }
  }
  return null;
}
