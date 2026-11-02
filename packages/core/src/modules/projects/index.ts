import type { AppCtx, Job } from '../../app';
import type { Ctx } from '../../services/context';
import { parse } from '../finance';

import {
  type AddFileBody,
  addFileSchema,
  type CreateNoteBody,
  createNoteSchema,
  type UpdateNoteBody,
  updateNoteSchema,
} from './contract';
import * as svc from './service';

export type * from './contract';

export const handlers = (ctx: AppCtx) => ({
  'projects.page': ({ id }: { id: string }) => svc.projectPage(ctx, id),

  'projectNotes.list': ({ projectId }: { projectId: string }) => svc.listNotes(ctx, projectId),
  'projectNotes.create': (input: CreateNoteBody) =>
    svc.createNote(ctx, parse(createNoteSchema as never, input)),
  'projectNotes.update': ({ id, ...input }: UpdateNoteBody & { id: string }) =>
    svc.updateNote(ctx, id, parse(updateNoteSchema as never, input)),
  'projectNotes.delete': ({ id }: { id: string }) => svc.deleteNote(ctx, id),

  'projectFiles.list': ({ projectId }: { projectId: string }) => svc.listFiles(ctx, projectId),
});

// Fora do RPC: quem mexe na pasta dos arquivos é o main, e a tela só conhece o id.
export const addProjectFile = (ctx: Ctx, input: AddFileBody) =>
  svc.addFile(ctx, parse(addFileSchema as never, input));
export const {
  fileStoredName: projectFileStoredName,
  orphanStoredNames: orphanProjectFiles,
  removeFile: removeProjectFile,
} = svc;

export const jobs: Job[] = [];
