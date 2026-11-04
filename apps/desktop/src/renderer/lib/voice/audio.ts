// Do microfone ao áudio que o Whisper lê: mono, 16 kHz, em Float32.

export const MAX_SECONDS = 60;
const SAMPLE_RATE = 16_000;

export async function startRecording() {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true } });
  } catch {
    throw new Error('Sem acesso ao microfone. Libere o Sektor em Ajustes do Sistema › Privacidade › Microfone.');
  }
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
  recorder.start();
  const done = new Promise<Blob>((resolve) => {
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      resolve(new Blob(chunks, { type: recorder.mimeType }));
    };
  });
  return {
    stop: () => {
      if (recorder.state !== 'inactive') recorder.stop();
      return done;
    },
  };
}

export async function toPcm(blob: Blob): Promise<Float32Array> {
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    if (decoded.numberOfChannels === 1) return decoded.getChannelData(0);
    const left = decoded.getChannelData(0);
    const right = decoded.getChannelData(1);
    return left.map((sample, i) => (sample + right[i]!) / 2);
  } finally {
    void context.close();
  }
}
