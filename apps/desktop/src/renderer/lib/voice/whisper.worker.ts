/// <reference lib="webworker" />
import { type AutomaticSpeechRecognitionPipeline, env, pipeline } from '@huggingface/transformers';
import ortMjs from 'ort-dist/ort-wasm-simd-threaded.asyncify.mjs?url';
import ortWasm from 'ort-dist/ort-wasm-simd-threaded.asyncify.wasm?url';

import { type FromWorker, pickModel, type ToWorker } from './protocol';

// O Whisper roda aqui, longe da tela: baixa o modelo uma vez (fica no cache do app) e transcreve no
// computador. O áudio nunca sai da máquina.

env.allowLocalModels = false;
// O cache de arquivos do motor não aceita endereço `file:`; ele já vem do disco.
env.useWasmCache = false;
// O motor vai junto com o app, em vez de vir de um CDN.
env.backends.onnx.wasm!.wasmPaths = { mjs: ortMjs, wasm: ortWasm };

const post = (message: FromWorker) => postMessage(message);

let loading: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

async function load() {
  const adapter = 'gpu' in navigator ? await navigator.gpu.requestAdapter().catch(() => null) : null;
  const choice = pickModel({ webgpu: Boolean(adapter), f16: Boolean(adapter?.features.has('shader-f16')) });
  return (await pipeline('automatic-speech-recognition', choice.model, {
    device: choice.device,
    dtype: choice.dtype,
    progress_callback: (info) => {
      if (info.status === 'progress_total') post({ type: 'progress', loaded: info.loaded, total: info.total });
    },
  })) as AutomaticSpeechRecognitionPipeline;
}

const ready = () => {
  loading ??= load().catch((error) => {
    loading = null;
    throw error;
  });
  return loading;
};

self.onmessage = async (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  try {
    const transcriber = await ready();
    post({ type: 'ready' });
    if (message.type === 'load') return;
    const result = await transcriber(message.audio, { language: 'portuguese', task: 'transcribe' });
    const text = (Array.isArray(result) ? result.map((r) => r.text).join(' ') : result.text).trim();
    post({ type: 'text', id: message.id, text });
  } catch (error) {
    post({ type: 'error', id: message.type === 'transcribe' ? message.id : null, message: String(error) });
  }
};
