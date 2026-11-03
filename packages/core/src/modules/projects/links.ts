import { and, eq, inArray, isNull } from 'drizzle-orm';

import { type Ctx, notFound } from '../../services/context';
import { calendars, events } from '../agenda/schema';
import { projects } from '../tasks/schema';

import { projectFiles, projectNoteFolders, projectNotes } from './schema';

/** Evento só se liga a projeto que existe. */
export function assertLinkableProject(ctx: Ctx, id: string | null | undefined) {
  if (!id) return;
  const found = ctx.db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, id), isNull(projects.deletedAt)))
    .get();
  if (!found) throw notFound('Projeto não encontrado.');
}

/** Projeto só se liga a calendário que existe. Pode ser um só de leitura: a página só mostra. */
export function assertLinkableCalendar(ctx: Ctx, id: string | null | undefined) {
  if (!id) return;
  if (!liveCalendarIds(ctx, [id]).size) throw notFound('Calendário não encontrado.');
}

/**
 * Dos calendários pedidos, os que ainda existem. Calendário apagado (ou de conta do Google
 * desconectada) não limpa o projeto: quem lê trata a ligação como vazia.
 */
export function liveCalendarIds(ctx: Ctx, ids: string[]) {
  if (!ids.length) return new Set<string>();
  return new Set(
    ctx.db
      .select({ id: calendars.id })
      .from(calendars)
      .where(and(inArray(calendars.id, ids), isNull(calendars.deletedAt)))
      .all()
      .map((row) => row.id)
  );
}

/** Roda na transação que apaga o projeto: eventos ficam sem projeto; notas, pastas e arquivos saem com ele. */
export function dropProjectContent(ctx: Ctx, id: string, now: number) {
  ctx.db
    .update(events)
    .set({ projectId: null, updatedAt: now })
    .where(eq(events.projectId, id))
    .run();
  for (const table of [projectNotes, projectNoteFolders, projectFiles]) {
    ctx.db
      .update(table)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(table.projectId, id), isNull(table.deletedAt)))
      .run();
  }
}
