import { addDays } from '@sektor/finance-engine';
import { and, count, desc, eq, isNotNull, isNull, notInArray } from 'drizzle-orm';
import type { z } from 'zod';

import { AppError, type Ctx, notFound, stamp, todayIn } from '../../services/context';
import { listOccurrences } from '../agenda/service';
import { getProject, listTasks } from '../tasks/service';

import type {
  addFileSchema,
  createNoteSchema,
  ProjectFileResponse,
  ProjectNoteResponse,
  ProjectPageResponse,
  updateNoteSchema,
} from './contract';
import { byDueDate, upcomingOfProject } from './logic';
import { projectFiles, projectNotes } from './schema';

const UPCOMING_TASKS = 6;
const UPCOMING_EVENTS = 5;
const EVENT_WINDOW_DAYS = 120;

type NoteRow = typeof projectNotes.$inferSelect;
type FileRow = typeof projectFiles.$inferSelect;

function tally(ctx: Ctx, table: typeof projectNotes | typeof projectFiles, projectId: string) {
  return (
    ctx.db
      .select({ n: count() })
      .from(table)
      .where(and(eq(table.projectId, projectId), isNull(table.deletedAt)))
      .get()?.n ?? 0
  );
}

export function projectPage(ctx: Ctx, id: string, now = new Date()): ProjectPageResponse {
  const project = getProject(ctx, id);
  const open = listTasks(ctx, { projectId: id });
  const today = todayIn(ctx, now);
  const occurrences = listOccurrences(ctx, {
    from: today,
    to: addDays(today, EVENT_WINDOW_DAYS),
  });
  return {
    project,
    counts: {
      open: open.length,
      overdue: listTasks(ctx, { projectId: id, view: 'overdue' }).length,
      notes: tally(ctx, projectNotes, id),
      files: tally(ctx, projectFiles, id),
    },
    upcomingTasks: byDueDate(open).slice(0, UPCOMING_TASKS),
    upcomingEvents: upcomingOfProject(occurrences, id, today, now).slice(0, UPCOMING_EVENTS),
  };
}

// ------------------------------------------------------------------ notas

const toNote = (row: NoteRow): ProjectNoteResponse => ({
  id: row.id,
  projectId: row.projectId,
  body: row.body,
  pinned: row.pinned,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

function findNote(ctx: Ctx, id: string) {
  const note = ctx.db
    .select()
    .from(projectNotes)
    .where(and(eq(projectNotes.id, id), isNull(projectNotes.deletedAt)))
    .get();
  if (!note) throw notFound('Nota não encontrada.');
  return note;
}

/** A ordem não usa `updatedAt`: a nota não pode pular de lugar enquanto se escreve nela. */
export function listNotes(ctx: Ctx, projectId: string) {
  return ctx.db
    .select()
    .from(projectNotes)
    .where(and(eq(projectNotes.projectId, projectId), isNull(projectNotes.deletedAt)))
    .orderBy(desc(projectNotes.pinned), desc(projectNotes.createdAt), desc(projectNotes.id))
    .all()
    .map(toNote);
}

export function createNote(ctx: Ctx, body: z.output<typeof createNoteSchema>) {
  getProject(ctx, body.projectId);
  const row = { ...stamp(), projectId: body.projectId, body: body.body ?? '' };
  ctx.db.insert(projectNotes).values(row).run();
  return toNote(findNote(ctx, row.id));
}

export function updateNote(ctx: Ctx, id: string, body: z.output<typeof updateNoteSchema>) {
  findNote(ctx, id);
  ctx.db
    .update(projectNotes)
    .set({ ...body, updatedAt: Date.now() })
    .where(eq(projectNotes.id, id))
    .run();
  return toNote(findNote(ctx, id));
}

export function deleteNote(ctx: Ctx, id: string) {
  findNote(ctx, id);
  const now = Date.now();
  ctx.db
    .update(projectNotes)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(projectNotes.id, id))
    .run();
}

// ------------------------------------------------------------------ arquivos

const toFile = (row: FileRow): ProjectFileResponse => ({
  id: row.id,
  projectId: row.projectId,
  name: row.name,
  sizeBytes: row.sizeBytes,
  createdAt: row.createdAt,
});

export function listFiles(ctx: Ctx, projectId: string) {
  return ctx.db
    .select()
    .from(projectFiles)
    .where(and(eq(projectFiles.projectId, projectId), isNull(projectFiles.deletedAt)))
    .orderBy(desc(projectFiles.createdAt), desc(projectFiles.id))
    .all()
    .map(toFile);
}

function liveFile(ctx: Ctx, id: string) {
  const file = ctx.db
    .select()
    .from(projectFiles)
    .where(and(eq(projectFiles.id, id), isNull(projectFiles.deletedAt)))
    .get();
  if (!file) throw notFound('Arquivo não encontrado.');
  return file;
}

/** Quem chama é o main, depois de gravar a cópia. A tela não informa hash nem nome na pasta. */
export function addFile(ctx: Ctx, body: z.output<typeof addFileSchema>) {
  getProject(ctx, body.projectId);
  const twin = ctx.db
    .select({ id: projectFiles.id })
    .from(projectFiles)
    .where(
      and(
        eq(projectFiles.projectId, body.projectId),
        eq(projectFiles.contentHash, body.contentHash),
        isNull(projectFiles.deletedAt)
      )
    )
    .get();
  if (twin) throw new AppError(409, `${body.name} já está neste projeto.`);
  const row = { ...stamp(), ...body };
  ctx.db.insert(projectFiles).values(row).run();
  return toFile(row as FileRow);
}

export function fileStoredName(ctx: Ctx, id: string) {
  return liveFile(ctx, id).storedName;
}

export function removeFile(ctx: Ctx, id: string) {
  liveFile(ctx, id);
  const now = Date.now();
  ctx.db
    .update(projectFiles)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(projectFiles.id, id))
    .run();
}

/**
 * Cópias que só linhas apagadas usam, e que o main pode tirar da pasta. Só sai o que o banco conhece:
 * depois de restaurar um backup antigo, cópia sem linha fica, porque um backup novo pode precisar dela.
 */
export function orphanStoredNames(ctx: Ctx) {
  const used = ctx.db
    .select({ name: projectFiles.storedName })
    .from(projectFiles)
    .where(isNull(projectFiles.deletedAt));
  return ctx.db
    .selectDistinct({ name: projectFiles.storedName })
    .from(projectFiles)
    .where(and(isNotNull(projectFiles.deletedAt), notInArray(projectFiles.storedName, used)))
    .all()
    .map((row) => row.name);
}
