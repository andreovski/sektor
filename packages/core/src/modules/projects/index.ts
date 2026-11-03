import type { AppCtx, Job } from '../../app';
import type { Ctx } from '../../services/context';
import { parse } from '../finance';

import {
  type AddFileBody,
  addFileSchema,
  type CreateFolderBody,
  createFolderSchema,
  type CreateNoteBody,
  createNoteSchema,
  type UpdateFolderBody,
  updateFolderSchema,
  type UpdateNoteBody,
  updateNoteSchema,
} from './contract';
import * as svc from './service';

export type * from './contract';

export const handlers = (ctx: AppCtx) => ({
  'projects.page': ({ id }: { id: string }) => svc.projectPage(ctx, id),

  'projectNotes.list': ({ projectId }: { projectId: string }) => svc.listNotes(ctx, projectId),
  'projectNotes.get': ({ id }: { id: string }) => svc.getNote(ctx, id),
  'projectNotes.create': (input: CreateNoteBody) =>
    svc.createNote(ctx, parse(createNoteSchema as never, input)),
  'projectNotes.update': ({ id, ...input }: UpdateNoteBody & { id: string }) =>
    svc.updateNote(ctx, id, parse(updateNoteSchema as never, input)),
  'projectNotes.delete': ({ id }: { id: string }) => svc.deleteNote(ctx, id),

  'projectNoteFolders.list': ({ projectId }: { projectId: string }) =>
    svc.listFolders(ctx, projectId),
  'projectNoteFolders.create': (input: CreateFolderBody) =>
    svc.createFolder(ctx, parse(createFolderSchema as never, input)),
  'projectNoteFolders.update': ({ id, ...input }: UpdateFolderBody & { id: string }) =>
    svc.renameFolder(ctx, id, parse(updateFolderSchema as never, input)),
  'projectNoteFolders.delete': ({ id }: { id: string }) => svc.deleteFolder(ctx, id),

  'projectFiles.list': ({ projectId }: { projectId: string }) => svc.listFiles(ctx, projectId),
});

// Fora do RPC: quem mexe na pasta dos arquivos é o main, e a tela só conhece o id.
export const addProjectFile = (ctx: Ctx, input: AddFileBody) =>
  svc.addFile(ctx, parse(addFileSchema as never, input));
export const {
  fileToOpen: projectFileToOpen,
  orphanStoredNames: orphanProjectFiles,
  removeFile: removeProjectFile,
} = svc;

export const jobs: Job[] = [];
