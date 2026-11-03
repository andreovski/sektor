import type { ProjectNoteResponse } from '@sektor/core/src/modules/projects/contract';
import { noteTitle } from '@sektor/core/src/modules/projects/logic';
import { useParams } from '@tanstack/react-router';
import { X } from 'lucide-react';
import { useEffect } from 'react';

import { useRpc } from '../../lib/rpc';
import { cn } from '../../ui';
import { RichTextEditor } from '../../ui/rich-text';

import { useNoteBody, useRefetchOnFocus } from './note-sync';

function closeWindow() {
  void window.sektor.closeWindow();
}

function Header({ title, state }: { title: string; state?: 'saved' | 'pending' }) {
  return (
    <header className="note-window-drag flex h-9 shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-3">
      <span
        aria-hidden
        className={cn('size-1.5 shrink-0 rounded-full', state === 'pending' ? 'bg-warning' : 'bg-success')}
      />
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted">{title}</span>
      {state && (
        <span role="status" className="sr-only">
          {state === 'saved' ? 'Salvo' : 'Salvando…'}
        </span>
      )}
      <button
        type="button"
        aria-label="Fechar pop-up"
        title="Fechar (⌘W)"
        onClick={closeWindow}
        className="note-window-button grid size-6 place-items-center rounded-control text-subtle hover:bg-hover hover:text-foreground"
      >
        <X size={13} />
      </button>
    </header>
  );
}

function Body({ note }: { note: ProjectNoteResponse }) {
  const { body, setBody, state } = useNoteBody(note);
  return (
    <>
      <Header title={noteTitle(body)} state={state} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-3">
        <RichTextEditor
          variant="page"
          aria-label="Texto da nota"
          value={body}
          onChange={setBody}
        />
      </div>
    </>
  );
}

/** A nota numa janela própria, que o main deixa por cima de tudo. */
export function NoteWindow() {
  const { id } = useParams({ strict: false }) as { id: string };
  const note = useRpc('projectNotes.get', { id });
  useRefetchOnFocus(note.refetch);

  useEffect(() => {
    document.documentElement.dataset.window = 'note';
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'w') closeWindow();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (note.data) document.title = `${noteTitle(note.data.body)} · Sektor`;
  }, [note.data]);

  return (
    <div className="note-window flex h-full flex-col bg-surface">
      {note.data ? (
        <Body key={note.data.id} note={note.data} />
      ) : (
        <>
          <Header title="Nota" />
          <p className="p-6 text-center text-sm text-muted">
            {note.isPending ? 'Carregando…' : 'Esta nota não existe mais.'}
          </p>
        </>
      )}
    </div>
  );
}
