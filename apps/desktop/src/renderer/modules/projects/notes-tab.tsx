import type {
  ProjectNoteFolderResponse,
  ProjectNoteResponse,
} from '@sektor/core/src/modules/projects/contract';
import { noteTitle } from '@sektor/core/src/modules/projects/logic';
import {
  ChevronRight,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  NotebookPen,
  Pencil,
  PictureInPicture2,
  Pin,
  Plus,
  Trash2,
} from 'lucide-react';
import { type KeyboardEvent, useRef, useState } from 'react';

import { useRpc, useRpcMutation } from '../../lib/rpc';
import { Button, cn, EmptyState, Input, Select } from '../../ui';
import { RichTextEditor } from '../../ui/rich-text';

import { ConfirmDialog } from './confirm-dialog';
import { useNoteBody, useRefetchOnFocus } from './note-sync';

function Editor({
  note,
  folders,
  onDeleted,
}: {
  note: ProjectNoteResponse;
  folders: ProjectNoteFolderResponse[];
  onDeleted(): void;
}) {
  const { body, setBody, state, flush } = useNoteBody(note);
  const [confirming, setConfirming] = useState(false);
  const update = useRpcMutation('projectNotes.update');
  const remove = useRpcMutation('projectNotes.delete');

  return (
    <div className="flex min-h-[460px] min-w-0 flex-col rounded-panel border border-line bg-surface px-6 py-4 shadow-card">
      <div className="mb-4 flex items-center gap-2 border-b border-line pb-3">
        {folders.length > 0 && (
          <Select
            aria-label="Pasta da nota"
            className="h-7 w-44 text-xs"
            value={note.folderId ?? ''}
            onChange={(event) =>
              update.mutate({ id: note.id, folderId: event.target.value || null })
            }
          >
            <option value="">Sem pasta</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </Select>
        )}
        <span role="status" className="text-xs text-subtle">
          {state === 'saved' ? 'Salvo' : 'Salvando…'}
        </span>
        <span className="ml-auto hidden text-xs text-subtle lg:inline">
          Digite <kbd className="rounded border border-line px-1 font-mono">/</kbd> para blocos
        </span>
        <Button
          variant="ghost"
          size="sm"
          title="Abre a nota numa janelinha que fica por cima de tudo"
          onClick={() => void flush().then(() => window.sektor.popOutNote(note.id))}
        >
          <PictureInPicture2 size={13} />
          Pop-up
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={note.pinned}
          onClick={() => update.mutate({ id: note.id, pinned: !note.pinned })}
        >
          <Pin size={13} className={cn(note.pinned && 'fill-current text-primary')} />
          {note.pinned ? 'Fixada' : 'Fixar'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Apagar nota"
          onClick={() => setConfirming(true)}
        >
          <Trash2 size={13} />
        </Button>
      </div>
      <RichTextEditor
        variant="page"
        autoFocus={!note.body}
        aria-label="Texto da nota"
        placeholder={'Comece com um título, ou digite "/" para blocos'}
        value={body}
        onChange={setBody}
        className="flex-1"
      />
      {confirming && (
        <ConfirmDialog
          title="Apagar nota"
          text={`"${noteTitle(body)}" sai deste projeto.`}
          action="Apagar"
          onConfirm={() => remove.mutate({ id: note.id }, { onSuccess: onDeleted })}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

function NoteRow({
  note,
  current,
  nested,
  onOpen,
}: {
  note: ProjectNoteResponse;
  current: boolean;
  nested?: boolean;
  onOpen(): void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-current={current ? 'true' : undefined}
        onClick={onOpen}
        className={cn(
          'flex h-8 w-full items-center gap-2 rounded-control px-2 text-left text-sm',
          nested && 'pl-7',
          current ? 'bg-active text-foreground' : 'text-muted hover:bg-hover hover:text-foreground'
        )}
      >
        {note.pinned ? (
          <Pin size={12} className="shrink-0 fill-current text-primary" />
        ) : (
          <FileText size={13} className="shrink-0 text-subtle" />
        )}
        <span className="truncate">{noteTitle(note.body)}</span>
      </button>
    </li>
  );
}

/** Nome da pasta editado no lugar: Enter guarda, Esc desiste. */
function FolderName({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave(name: string): void;
  onCancel(): void;
}) {
  const [name, setName] = useState(initial);
  const done = useRef(false);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save && name.trim() && name.trim() !== initial) onSave(name.trim());
    else onCancel();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') finish(true);
    if (event.key === 'Escape') {
      event.stopPropagation();
      finish(false);
    }
  };
  return (
    <Input
      autoFocus
      aria-label="Nome da pasta"
      placeholder="Nome da pasta"
      className="h-8 text-sm"
      value={name}
      maxLength={80}
      onFocus={(event) => event.target.select()}
      onChange={(event) => setName(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => finish(true)}
    />
  );
}

function FolderRow({
  folder,
  open,
  renaming,
  onToggle,
  onAddNote,
  onRename,
  onRenamed,
  onCancelRename,
  onDelete,
}: {
  folder: ProjectNoteFolderResponse;
  open: boolean;
  renaming: boolean;
  onToggle(): void;
  onAddNote(): void;
  onRename(): void;
  onRenamed(name: string): void;
  onCancelRename(): void;
  onDelete(): void;
}) {
  if (renaming) {
    return <FolderName initial={folder.name} onSave={onRenamed} onCancel={onCancelRename} />;
  }
  const Icon = open ? FolderOpen : Folder;
  return (
    <div className="group flex h-8 items-center rounded-control text-sm text-muted hover:bg-hover hover:text-foreground">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        onDoubleClick={onRename}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-1 text-left"
      >
        <ChevronRight
          size={13}
          className={cn('shrink-0 text-subtle transition-transform', open && 'rotate-90')}
        />
        <Icon size={14} className="shrink-0" />
        <span className="truncate">{folder.name}</span>
        <span aria-hidden className="ml-1 text-[11px] tabular-nums text-subtle group-hover:hidden">
          {folder.noteCount}
        </span>
      </button>
      <span className="hidden shrink-0 items-center pr-1 group-focus-within:flex group-hover:flex">
        {[
          { icon: Plus, label: `Nova nota em ${folder.name}`, run: onAddNote },
          { icon: Pencil, label: 'Renomear pasta', run: onRename },
          { icon: Trash2, label: 'Apagar pasta', run: onDelete },
        ].map(({ icon: ActionIcon, label, run }) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            title={label}
            onClick={run}
            className="grid size-6 place-items-center rounded-control text-subtle hover:bg-active hover:text-foreground"
          >
            <ActionIcon size={12} />
          </button>
        ))}
      </span>
    </div>
  );
}

export function NotesTab({ projectId }: { projectId: string }) {
  const notes = useRpc('projectNotes.list', { projectId });
  useRefetchOnFocus(notes.refetch);
  const folderList = useRpc('projectNoteFolders.list', { projectId });
  const create = useRpcMutation('projectNotes.create');
  const createFolder = useRpcMutation('projectNoteFolders.create');
  const renameFolder = useRpcMutation('projectNoteFolders.update');
  const deleteFolder = useRpcMutation('projectNoteFolders.delete');
  const [chosen, setChosen] = useState<string | null>(null);
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [deleting, setDeleting] = useState<ProjectNoteFolderResponse | null>(null);
  const list = notes.data ?? [];
  const folders = folderList.data ?? [];
  const current = list.find((note) => note.id === chosen) ?? list[0];

  const add = (folderId: string | null = null) => {
    if (folderId) setClosed((set) => new Set([...set].filter((id) => id !== folderId)));
    create.mutate({ projectId, folderId }, { onSuccess: (note) => setChosen(note.id) });
  };
  const toggle = (id: string) =>
    setClosed((set) => {
      const next = new Set(set);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  if (notes.isPending || folderList.isPending) {
    return <p className="py-10 text-center text-sm text-muted">Carregando notas…</p>;
  }
  if (!current && !folders.length && !naming) {
    return (
      <EmptyState
        icon={NotebookPen}
        title="Nenhuma nota"
        text="Decisões, links e rascunhos do projeto ficam aqui. Organize em pastas e digite / para títulos, listas e tarefas."
        action={
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => add()}>
              Criar nota
            </Button>
            <Button onClick={() => setNaming(true)}>
              <FolderPlus size={14} />
              Criar pasta
            </Button>
          </div>
        }
      />
    );
  }

  const known = new Set(folders.map((folder) => folder.id));
  const loose = list.filter((note) => !note.folderId || !known.has(note.folderId));
  const row = (note: ProjectNoteResponse, nested?: boolean) => (
    <NoteRow
      key={note.id}
      note={note}
      nested={nested}
      current={note.id === current?.id}
      onOpen={() => setChosen(note.id)}
    />
  );

  return (
    <div className="grid grid-cols-[250px_minmax(0,1fr)] items-start gap-3">
      <nav aria-label="Notas do projeto" className="flex flex-col gap-2">
        <div className="flex gap-1.5">
          <Button className="flex-1" onClick={() => add()} disabled={create.isPending}>
            <FilePlus size={14} />
            Nova nota
          </Button>
          <Button aria-label="Nova pasta" title="Nova pasta" onClick={() => setNaming(true)}>
            <FolderPlus size={14} />
          </Button>
        </div>
        {naming && (
          <FolderName
            initial=""
            onSave={(name) =>
              createFolder.mutate({ projectId, name }, { onSettled: () => setNaming(false) })
            }
            onCancel={() => setNaming(false)}
          />
        )}
        <ul className="flex flex-col gap-0.5">
          {folders.map((folder) => {
            const open = !closed.has(folder.id);
            const inside = list.filter((note) => note.folderId === folder.id);
            return (
              <li key={folder.id}>
                <FolderRow
                  folder={folder}
                  open={open}
                  renaming={renaming === folder.id}
                  onToggle={() => toggle(folder.id)}
                  onAddNote={() => add(folder.id)}
                  onRename={() => setRenaming(folder.id)}
                  onRenamed={(name) =>
                    renameFolder.mutate(
                      { id: folder.id, name },
                      { onSettled: () => setRenaming(null) }
                    )
                  }
                  onCancelRename={() => setRenaming(null)}
                  onDelete={() => setDeleting(folder)}
                />
                {open && (
                  <ul className="flex flex-col gap-0.5">
                    {inside.length ? (
                      inside.map((note) => row(note, true))
                    ) : (
                      <li className="py-1 pl-7 text-xs text-subtle">Pasta vazia</li>
                    )}
                  </ul>
                )}
              </li>
            );
          })}
          {loose.map((note) => row(note))}
        </ul>
      </nav>
      {current ? (
        <Editor
          key={current.id}
          note={current}
          folders={folders}
          onDeleted={() => setChosen(null)}
        />
      ) : (
        <EmptyState
          icon={NotebookPen}
          title="Nenhuma nota ainda"
          text="Crie a primeira nota, solta ou dentro de uma pasta."
          action={<Button onClick={() => add()}>Criar nota</Button>}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Apagar pasta"
          text={
            deleting.noteCount
              ? `A pasta "${deleting.name}" sai, e as notas dela (${deleting.noteCount}) ficam sem pasta.`
              : `A pasta "${deleting.name}" sai do projeto.`
          }
          action="Apagar pasta"
          onConfirm={() => deleteFolder.mutate({ id: deleting.id })}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
