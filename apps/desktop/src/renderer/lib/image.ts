// Foto para o assistente: reduzida aqui, antes de ir ao núcleo. A foto vai ao modelo; a miniatura
// fica na conversa.

export interface PreparedImage {
  data: string;
  mediaType: 'image/jpeg';
  thumb: string;
}

const MAX_SIDE = 1600;
const THUMB_SIDE = 160;

function draw(bitmap: ImageBitmap, side: number, quality: number) {
  const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d')!;
  // Fundo branco: PNG transparente vira JPEG preto sem ele.
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

export async function prepareImage(file: Blob): Promise<PreparedImage> {
  if (!file.type.startsWith('image/')) throw new Error('Esse arquivo não é uma foto.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Não consegui abrir essa foto. Tente JPEG ou PNG.');
  }
  try {
    const full = draw(bitmap, MAX_SIDE, 0.85);
    return {
      data: full.slice(full.indexOf(',') + 1),
      mediaType: 'image/jpeg',
      thumb: draw(bitmap, THUMB_SIDE, 0.7),
    };
  } finally {
    bitmap.close();
  }
}
