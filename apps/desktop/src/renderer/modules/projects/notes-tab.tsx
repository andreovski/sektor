import type { ProjectNoteResponse } from '@sektor/core/src/modules/projects/contract';
import { noteTitle } from '@sektor/core/src/modules/projects/logic';
import { NotebookPen, Pin, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useRpc, useRpcMutation } from '../../lib/rpc';
import { Button, cn, EmptyState, Segmented, Textarea } from '../../ui';

import { ConfirmDialog } from './confirm-dialog';
import { MarkdownView } from './markdown-view';

const SAVE_DELAY_MS = 600;

type SaveState = 'saved' | 'pending';

/** Guarda o que foi digitado depois de uma pausa, e na hora ao sair da nota. */
function useAutosave(note: ProjectNoteResponse, body: string) {
  const { mutate } = useRpcMutation('projectNotes.update');
  const saved = useRef(note.body);
  const latest = useRef(body);
  latest.current = body;
  const [state, setState] = useState<SaveState>('saved');

  const flush = useCallback(() => {
    if (latest.current === saved.current) return;
    saved.current = latest.current;
    mutate(
      { id: note.id, body: latest.current },
      { onSuccess: () => setState(latest.current === saved.current ? 'saved' : 'pending') }
    );
  }, [note.id, mutate]);

  useEffect(() => {
    if (body === saved.current) return;
    setState('pending');
    const timer = setTimeout(flush, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [body, flush]);

  useEffect(() => flush, [flush]);
  return state;
}

function Editor({ note, onDeleted }: { note: ProjectNoteResponse; onDeleted(): void }) {
  const [body, setBody] = useState(note.body);
  const [view, setView] = useState<'editar' | 'ver'>(note.body ? 'ver' : 'editar');
  const [confirming, setConfirming] = useState(false);
  const state = useAutosave(note, body);
  const update = useRpcMutation('projectNotes.update');
  const remove = useRpcMutation('projectNotes.delete');

  return (
    <div className="flex min-h-[420px] min-w-0 flex-col rounded-panel border border-line bg-surface p-3 shadow-card">
      <div className="mb-3 flex items-center gap-2">
        <Segmented<'editar' | 'ver'>
          value={view}
          onChange={setView}
          options={[
            { value: 'editar', label: 'Editar' },
            { value: 'ver', label: 'Ver' },
          ]}
        />
        <span role="status" className="text-xs text-subtle">
          {state === 'saved' ? 'Salvo' : 'Salvando…'}
        </span>
        <Button
          className="ml-auto"
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
      {view === 'editar' ? (
        <Textarea
          autoFocus
          aria-label="Texto da nota"
          value={body}
          placeholder="# Título, - lista, **negrito**, *itálico*, `código`"
          onChange={(event) => setBody(event.target.value)}
          className="min-h-[360px] flex-1 resize-none font-mono"
        />
      ) : body.trim() ? (
        <MarkdownView source={body} />
      ) : (
        <p className="py-8 text-center text-sm text-muted">Nota vazia.</p>
      )}
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

export function NotesTab({ projectId }: { projectId: string }) {
  const notes = useRpc('projectNotes.list', { projectId });
  const create = useRpcMutation('projectNotes.create');
  const [chosen, setChosen] = useState<string | null>(null);
  const list = notes.data ?? [];
  const current = list.find((note) => note.id === chosen) ?? list[0];
  const add = () =>
    create.mutate({ projectId }, { onSuccess: (note) => setChosen(note.id) });

  if (notes.isPending) {
    return <p className="py-10 text-center text-sm text-muted">Carregando notas…</p>;
  }
  if (!current) {
    return (
      <EmptyState
        icon={NotebookPen}
        title="Nenhuma nota"
        text="Decisões, links e rascunhos do projeto ficam aqui, em Markdown simples."
        action={<Button onClick={add}>Criar nota</Button>}
      />
    );
  }
  return (
    <div className="grid grid-cols-[240px_minmax(0,1fr)] items-start gap-3">
      <div className="flex flex-col gap-2">
        <Button onClick={add} disabled={create.isPending}>
          <Plus size={14} />
          Nova nota
        </Button>
        <ul className="flex flex-col gap-0.5">
          {list.map((note) => (
            <li key={note.id}>
              <button
                type="button"
                aria-current={note.id === current.id ? 'true' : undefined}
                onClick={() => setChosen(note.id)}
                className={cn(
                  'flex h-8 w-full items-center gap-2 rounded-control px-2 text-left text-sm',
                  note.id === current.id
                    ? 'bg-active text-foreground'
                    : 'text-muted hover:bg-hover hover:text-foreground'
                )}
              >
                {note.pinned && <Pin size={12} className="shrink-0 fill-current text-primary" />}
                <span className="truncate">{noteTitle(note.body)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <Editor key={current.id} note={current} onDeleted={() => setChosen(null)} />
    </div>
  );
}
