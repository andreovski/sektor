import { dateStringInZone } from '@sektor/finance-engine';
import { randomBytes } from 'node:crypto';

import type { DbHandle } from '../db/client';

export interface Ctx {
  db: DbHandle['orm'];
  timeZone: string;
}

export const todayIn = (ctx: Ctx, now = new Date()) => dateStringInZone(now, ctx.timeZone);

/** Erro de regra: `status` segue os códigos HTTP do JP, que a tela já sabe mostrar. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new AppError(404, `${what} não encontrado(a).`);

/** UUID v7: ordena pelo tempo, o que ajuda índices e a sincronização. */
export function newId(now = Date.now()): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(now, 0, 6);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const stamp = () => {
  const now = Date.now();
  return { id: newId(now), createdAt: now, updatedAt: now };
};
