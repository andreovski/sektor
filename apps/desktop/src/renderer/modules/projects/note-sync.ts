import type { ProjectNoteResponse } from '@sektor/core/src/modules/projects/contract';
import { useCallback, useEffect, useRef, useState } from 'react';

import { call, useRpcMutation } from '../../lib/rpc';

const SAVE_DELAY_MS = 600;

export type SaveState = 'saved' | 'pending';

/**
 * O texto de uma nota aberta: guarda depois de uma pausa e na hora ao sair. A mesma nota pode estar
 * aberta no app e no pop-up; o que chega do banco entra no editor quando aqui não há nada por salvar.
 */
export function useNoteBody(note: ProjectNoteResponse) {
  const { mutate } = useRpcMutation('projectNotes.update');
  const [body, setBody] = useState(note.body);
  const saved = useRef(note.body);
  // Resposta de uma leitura começada antes do último salvamento traz texto velho: fica de fora.
  const savedAt = useRef(0);
  const latest = useRef(body);
  latest.current = body;
  const [state, setState] = useState<SaveState>('saved');

  const save = useCallback(() => {
    if (latest.current === saved.current) return null;
    saved.current = latest.current;
    savedAt.current = Date.now();
    return { id: note.id, body: latest.current };
  }, [note.id]);

  const flushSoon = useCallback(() => {
    const input = save();
    if (!input) return;
    mutate(input, {
      onSuccess: () => setState(latest.current === saved.current ? 'saved' : 'pending'),
    });
  }, [save, mutate]);

  /** Para quando a próxima tela precisa do texto já no banco (abrir o pop-up). */
  const flush = useCallback(async () => {
    const input = save();
    if (!input) return;
    await call('projectNotes.update', input);
    if (latest.current === saved.current) setState('saved');
  }, [save]);

  useEffect(() => {
    if (body === saved.current) return;
    setState('pending');
    const timer = setTimeout(flushSoon, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [body, flushSoon]);

  useEffect(() => flushSoon, [flushSoon]);

  useEffect(() => {
    if (note.body === saved.current || latest.current !== saved.current) return;
    if (note.updatedAt < savedAt.current) return;
    saved.current = note.body;
    setBody(note.body);
  }, [note.body, note.updatedAt]);

  return { body, setBody, state, flush };
}

/**
 * As duas janelas ficam visíveis ao mesmo tempo, então o foco da janela (e não a aba visível) é o
 * sinal de que a outra pode ter mudado a nota.
 */
export function useRefetchOnFocus(refetch: () => unknown) {
  useEffect(() => {
    const onFocus = () => void refetch();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refetch]);
}
