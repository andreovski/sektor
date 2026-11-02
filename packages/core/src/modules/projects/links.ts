import { and, eq, isNull } from 'drizzle-orm';

import { type Ctx, notFound } from '../../services/context';
import { events } from '../agenda/schema';
import { projects } from '../tasks/schema';

import { projectFiles, projectNotes } from './schema';

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

/** Roda na transação que apaga o projeto: eventos ficam sem projeto; notas e arquivos saem com ele. */
export function dropProjectContent(ctx: Ctx, id: string, now: number) {
  ctx.db
    .update(events)
    .set({ projectId: null, updatedAt: now })
    .where(eq(events.projectId, id))
    .run();
  for (const table of [projectNotes, projectFiles]) {
    ctx.db
      .update(table)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(table.projectId, id), isNull(table.deletedAt)))
      .run();
  }
}
