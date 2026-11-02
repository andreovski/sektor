import { z } from 'zod';

import type { EventOccurrence } from '../agenda/view';
import type { ProjectResponse, TaskResponse } from '../tasks/contract';

export const PROJECT_FILE_MAX_BYTES = 25 * 1024 * 1024;

export const createNoteSchema = z.object({
  projectId: z.string().min(1),
  body: z.string().max(50_000).optional(),
});
export type CreateNoteBody = z.input<typeof createNoteSchema>;

export const updateNoteSchema = z.object({
  body: z.string().max(50_000).optional(),
  pinned: z.boolean().optional(),
});
export type UpdateNoteBody = z.input<typeof updateNoteSchema>;

export const addFileSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().min(0).max(PROJECT_FILE_MAX_BYTES),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  storedName: z.string().regex(/^[0-9a-f]{64}(\.[a-z0-9]{1,12})?$/),
});
export type AddFileBody = z.input<typeof addFileSchema>;

export interface ProjectNoteResponse {
  id: string;
  projectId: string;
  body: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectFileResponse {
  id: string;
  projectId: string;
  name: string;
  sizeBytes: number;
  createdAt: number;
}

export interface ProjectPageResponse {
  project: ProjectResponse;
  counts: { open: number; overdue: number; notes: number; files: number };
  upcomingTasks: TaskResponse[];
  upcomingEvents: EventOccurrence[];
}
