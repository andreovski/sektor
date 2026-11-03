import { parseSimpleRRule } from '@sektor/finance-engine';
import { z } from 'zod';

export const TASK_STATUSES = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'] as const;
export const taskStatusSchema = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  BACKLOG: 'Backlog',
  TODO: 'A fazer',
  IN_PROGRESS: 'Em progresso',
  REVIEW: 'Em revisão',
  DONE: 'Concluída',
};

export const taskPrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export type TaskPriority = z.infer<typeof taskPrioritySchema>;

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  LOW: 'Baixa',
  MEDIUM: 'Média',
  HIGH: 'Alta',
};

export const PROJECT_TYPES = ['PERSONAL', 'ACADEMIC', 'PROFESSIONAL', 'FREELANCE'] as const;
export const projectTypeSchema = z.enum(PROJECT_TYPES);
export type ProjectType = z.infer<typeof projectTypeSchema>;

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  PERSONAL: 'Pessoal',
  ACADEMIC: 'Acadêmico',
  PROFESSIONAL: 'Profissional',
  FREELANCE: 'Freelance',
};

export const PROJECT_STATUSES = ['ACTIVE', 'PAUSED', 'DONE'] as const;
export const projectStatusSchema = z.enum(PROJECT_STATUSES);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  ACTIVE: 'Ativo',
  PAUSED: 'Pausado',
  DONE: 'Concluído',
};

/** Tons de `ui/theme.css`, guardados pelo nome. */
export const TONES = ['violet', 'blue', 'green', 'amber', 'orange', 'rose', 'cyan'] as const;
export type Tone = (typeof TONES)[number];
const toneSchema = z.enum(TONES).nullable().optional();

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.');
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida.');
const rruleSchema = z
  .string()
  .max(300)
  .refine((rule) => parseSimpleRRule(rule) !== null, 'Repetição inválida.');

export const createTaskListSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome.').max(60),
  color: toneSchema,
});
export type CreateTaskListBody = z.input<typeof createTaskListSchema>;

export const updateTaskListSchema = createTaskListSchema
  .partial()
  .extend({ sortOrder: z.number().int().optional() });
export type UpdateTaskListBody = z.input<typeof updateTaskListSchema>;

const taskFields = {
  title: z.string().trim().min(1, 'Informe o título.').max(300),
  /** Sem lista, vai para a Entrada. */
  listId: z.string().optional(),
  parentTaskId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  dueDate: dateSchema.nullable().optional(),
  /** Sem hora = prazo só com dia. */
  dueTime: timeSchema.nullable().optional(),
  priority: taskPrioritySchema.nullable().optional(),
  status: taskStatusSchema.optional(),
  rrule: rruleSchema.nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
};

export const createTaskSchema = z
  .object(taskFields)
  .refine((body) => !body.dueTime || body.dueDate, 'Hora precisa de data.');
export type CreateTaskBody = z.input<typeof createTaskSchema>;

export const updateTaskSchema = z
  .object(taskFields)
  .partial()
  .extend({ completed: z.boolean().optional() });
export type UpdateTaskBody = z.input<typeof updateTaskSchema>;

export const captureTaskSchema = z.object({
  text: z.string().trim().min(1, 'Escreva a tarefa.').max(400),
  listId: z.string().optional(),
  projectId: z.string().nullable().optional(),
  /** Prazo quando o texto não traz nenhum (na lista Hoje, por exemplo). */
  defaultDueDate: dateSchema.nullable().optional(),
  /** Etiqueta da visão aberta, somada às do texto. */
  defaultTag: z.string().trim().min(1).max(30).optional(),
});
export type CaptureTaskBody = z.input<typeof captureTaskSchema>;

export const taskViewSchema = z.enum(['today', 'next7', 'overdue', 'nodate', 'completed']);
export type TaskView = z.infer<typeof taskViewSchema>;

export const listTasksSchema = z.object({
  view: taskViewSchema.optional(),
  listId: z.string().optional(),
  projectId: z.string().optional(),
  status: taskStatusSchema.optional(),
  tag: z.string().optional(),
  search: z.string().max(80).optional(),
  /** Prazo dentro do intervalo, inclusive. */
  dueFrom: dateSchema.optional(),
  dueTo: dateSchema.optional(),
  /** Traz também as concluídas, que por padrão ficam de fora. */
  includeCompleted: z.boolean().optional(),
  limit: z.number().int().min(1).max(1000).optional(),
});
export type ListTasksQuery = z.input<typeof listTasksSchema>;

export const reorderTasksSchema = z.object({
  listId: z.string(),
  orderedIds: z.array(z.string()).min(1).max(1000),
});
export type ReorderTasksBody = z.input<typeof reorderTasksSchema>;

const projectFields = {
  name: z.string().trim().min(1, 'Informe o nome.').max(80),
  type: projectTypeSchema.optional(),
  description: z.string().max(2000).nullable().optional(),
  color: toneSchema,
  startDate: dateSchema.nullable().optional(),
  dueDate: dateSchema.nullable().optional(),
  calendarId: z.string().min(1).nullable().optional(),
};

export const createProjectSchema = z.object(projectFields);
export type CreateProjectBody = z.input<typeof createProjectSchema>;

export const updateProjectSchema = z
  .object(projectFields)
  .partial()
  .extend({ completed: z.boolean().optional(), status: projectStatusSchema.optional() });
export type UpdateProjectBody = z.input<typeof updateProjectSchema>;

export interface TaskResponse {
  id: string;
  listId: string;
  projectId: string | null;
  project: { id: string; name: string; color: Tone | null } | null;
  parentTaskId: string | null;
  title: string;
  notes: string | null;
  status: TaskStatus;
  priority: TaskPriority | null;
  dueDate: string | null;
  dueTime: string | null;
  rrule: string | null;
  sortOrder: number;
  /** Milissegundos desde a época, como `created_at`. */
  completedAt: number | null;
  tags: string[];
  subtasks: TaskResponse[];
}

export interface CompleteTaskResponse {
  task: TaskResponse;
  /** Próxima ocorrência criada ao concluir uma tarefa recorrente. */
  next: TaskResponse | null;
}

export interface TaskListResponse {
  id: string;
  name: string;
  color: Tone | null;
  sortOrder: number;
  isInbox: boolean;
  openCount: number;
}

export interface TagResponse {
  id: string;
  name: string;
  taskCount: number;
}

export interface TaskCounts {
  today: number;
  next7: number;
  overdue: number;
  nodate: number;
  all: number;
  completed: number;
}

export interface ProjectResponse {
  id: string;
  name: string;
  type: ProjectType;
  description: string | null;
  color: Tone | null;
  status: ProjectStatus;
  startDate: string | null;
  dueDate: string | null;
  createdAt: number;
  completedAt: number | null;
  /** Calendário da Agenda ligado ao projeto. Nulo também quando o calendário saiu. */
  calendarId: string | null;
  progress: { total: number; done: number; percent: number };
  nextTask: { id: string; title: string; dueDate: string | null; dueTime: string | null } | null;
}
