export type ToWorker = { type: 'load' } | { type: 'transcribe'; id: number; audio: Float32Array };

export type FromWorker =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready' }
  | { type: 'text'; id: number; text: string }
  | { type: 'error'; id: number | null; message: string };

export interface ModelChoice {
  model: string;
  device: 'webgpu' | 'wasm';
  dtype: 'q8' | Record<string, 'fp16' | 'q4f16' | 'q4' | 'fp32'>;
  /** O que baixa na primeira vez, para avisar antes. */
  megabytes: number;
}

/**
 * Com a GPU (os Macs com Apple Silicon), o large-v3-turbo, que entende bem o português. Sem ela, o
 * small, menor e mais lento, no processador.
 */
export function pickModel(gpu: { webgpu: boolean; f16: boolean }): ModelChoice {
  if (gpu.webgpu && gpu.f16) {
    return {
      model: 'onnx-community/whisper-large-v3-turbo',
      device: 'webgpu',
      dtype: { encoder_model: 'q4f16', decoder_model_merged: 'q4f16' },
      megabytes: 560,
    };
  }
  if (gpu.webgpu) {
    return {
      model: 'onnx-community/whisper-small',
      device: 'webgpu',
      dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
      megabytes: 590,
    };
  }
  return { model: 'onnx-community/whisper-small', device: 'wasm', dtype: 'q8', megabytes: 250 };
}
