import type { AppCtx, Job } from '../../app';
import { parse } from '../finance';

import type {
  CaptureTaskBody,
  CreateProjectBody,
  CreateTaskBody,
  CreateTaskListBody,
  ListTasksQuery,
  ReorderTasksBody,
  TaskStatus,
  UpdateProjectBody,
  UpdateTaskBody,
  UpdateTaskListBody,
} from './contract';
import {
  captureTaskSchema,
  createProjectSchema,
  createTaskListSchema,
  createTaskSchema,
  listTasksSchema,
  reorderTasksSchema,
  updateProjectSchema,
  updateTaskListSchema,
  updateTaskSchema,
} from './contract';
import * as svc from './service';

export { type ParsedCapture, parseCapture } from './capture';
export type * from './contract';
export { getProject, getTask, listProjects, listTasks } from './service';

export const handlers = (ctx: AppCtx) => {
  svc.inboxId(ctx);
  return {
    'taskLists.list': () => svc.listTaskLists(ctx),
    'taskLists.create': (input: CreateTaskListBody) =>
      svc.createTaskList(ctx, parse(createTaskListSchema as never, input)),
    'taskLists.update': ({ id, ...input }: UpdateTaskListBody & { id: string }) =>
      svc.updateTaskList(ctx, id, parse(updateTaskListSchema as never, input)),
    'taskLists.delete': ({ id }: { id: string }) => svc.deleteTaskList(ctx, id),

    'tasks.list': (input?: ListTasksQuery) =>
      svc.listTasks(ctx, parse(listTasksSchema as never, input ?? {})),
    'tasks.get': ({ id }: { id: string }) => svc.getTask(ctx, id),
    'tasks.counts': () => svc.taskCounts(ctx),
    'tasks.tags': () => svc.listTags(ctx),
    'tasks.create': (input: CreateTaskBody) =>
      svc.createTask(ctx, parse(createTaskSchema as never, input)),
    'tasks.capture': (input: CaptureTaskBody) =>
      svc.captureTask(ctx, parse(captureTaskSchema as never, input)),
    'tasks.update': ({ id, ...input }: UpdateTaskBody & { id: string }) =>
      svc.updateTask(ctx, id, parse(updateTaskSchema as never, input)),
    'tasks.complete': ({ id }: { id: string }) => svc.completeTask(ctx, id),
    'tasks.reopen': ({ id, status }: { id: string; status?: TaskStatus }) =>
      svc.reopenTask(ctx, id, status),
    'tasks.delete': ({ id }: { id: string }) => svc.deleteTask(ctx, id),
    'tasks.reorder': (input: ReorderTasksBody) =>
      svc.reorderTasks(ctx, parse(reorderTasksSchema as never, input)),

    'projects.list': (input?: { includeCompleted?: boolean }) => svc.listProjects(ctx, input),
    'projects.get': ({ id }: { id: string }) => svc.getProject(ctx, id),
    'projects.create': (input: CreateProjectBody) =>
      svc.createProject(ctx, parse(createProjectSchema as never, input)),
    'projects.update': ({ id, ...input }: UpdateProjectBody & { id: string }) =>
      svc.updateProject(ctx, id, parse(updateProjectSchema as never, input)),
    'projects.delete': ({ id }: { id: string }) => svc.deleteProject(ctx, id),
  };
};

export const jobs: Job[] = [];
