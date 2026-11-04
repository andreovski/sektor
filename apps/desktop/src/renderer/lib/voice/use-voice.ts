import { useEffect, useRef, useState } from 'react';

import { MAX_SECONDS, startRecording, toPcm } from './audio';
import type { FromWorker, ToWorker } from './protocol';

// O botão do microfone: grava, transcreve no computador e devolve o texto. O modelo do Whisper é
// baixado uma vez, com aviso antes; o `localStorage` só lembra que o aviso já foi aceito.

const ACCEPTED = 'sektor.voice.accepted';

export type VoiceState =
  | { step: 'idle' }
  | { step: 'confirm' }
  | { step: 'recording'; startedAt: number }
  | { step: 'loading'; progress: number | null }
  | { step: 'transcribing' };

let worker: Worker | null = null;
const listeners = new Set<(message: FromWorker) => void>();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<FromWorker>) => listeners.forEach((l) => l(event.data));
  }
  return worker;
}

const send = (message: ToWorker, transfer: Transferable[] = []) => getWorker().postMessage(message, transfer);

function remembered() {
  try {
    return localStorage.getItem(ACCEPTED) === '1';
  } catch {
    return false;
  }
}

let nextId = 1;
let warmed = false;

function warm() {
  if (warmed) return;
  warmed = true;
  send({ type: 'load' });
}

export function useVoice(onText: (text: string) => void, onError: (message: string) => void) {
  const [state, setState] = useState<VoiceState>({ step: 'idle' });
  const recording = useRef<Awaited<ReturnType<typeof startRecording>> | null>(null);
  const callbacks = useRef({ onText, onError });
  callbacks.current = { onText, onError };

  const transcribe = (audio: Float32Array) =>
    new Promise<string>((resolve, reject) => {
      const id = nextId++;
      const listen = (message: FromWorker) => {
        if (message.type === 'progress') {
          setState({ step: 'loading', progress: message.total ? message.loaded / message.total : null });
        } else if (message.type === 'ready') {
          setState({ step: 'transcribing' });
        } else if ('id' in message && (message.id === id || message.id === null)) {
          listeners.delete(listen);
          if (message.type === 'text') resolve(message.text);
          else reject(new Error(message.message));
        }
      };
      listeners.add(listen);
      send({ type: 'transcribe', id, audio }, [audio.buffer]);
    });

  const stop = async (cancel = false) => {
    const current = recording.current;
    recording.current = null;
    if (!current) return;
    const blob = await current.stop();
    if (cancel) {
      setState({ step: 'idle' });
      return;
    }
    setState({ step: 'transcribing' });
    try {
      const audio = await toPcm(blob);
      if (audio.length < 16_000 * 0.4) throw new Error('Não ouvi nada. Segure um pouco mais e fale.');
      const text = await transcribe(audio);
      setState({ step: 'idle' });
      if (!text) throw new Error('Não entendi o que foi dito. Tente de novo.');
      callbacks.current.onText(text);
    } catch (error) {
      setState({ step: 'idle' });
      callbacks.current.onError(friendly(error));
    }
  };

  const start = async () => {
    if (!remembered()) {
      setState({ step: 'confirm' });
      return;
    }
    // Enquanto a pessoa fala, o modelo já carrega (do cache, depois da primeira vez).
    warm();
    try {
      recording.current = await startRecording();
      setState({ step: 'recording', startedAt: Date.now() });
    } catch (error) {
      setState({ step: 'idle' });
      callbacks.current.onError((error as Error).message);
    }
  };

  // Gravação longa para sozinha.
  useEffect(() => {
    if (state.step !== 'recording') return;
    const timer = setTimeout(() => void stop(), MAX_SECONDS * 1000);
    return () => clearTimeout(timer);
  }, [state]);

  useEffect(() => () => void recording.current?.stop(), []);

  return {
    state,
    toggle: () => (state.step === 'recording' ? void stop() : void start()),
    cancel: () => (state.step === 'confirm' ? setState({ step: 'idle' }) : void stop(true)),
    accept: () => {
      try {
        localStorage.setItem(ACCEPTED, '1');
      } catch {
        // Sem armazenamento, pergunta de novo na próxima vez.
      }
      void start();
    },
  };
}

function friendly(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/fetch|network|Failed to/i.test(message)) {
    return 'Não consegui baixar o modelo de voz. Confira a internet e tente de novo.';
  }
  return message.length > 160 ? 'A transcrição falhou. Tente de novo.' : message;
}
