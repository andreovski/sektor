import { z } from 'zod';

/** Dia sem hora, como a pessoa pensa num lançamento: "2026-10-18". */
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (AAAA-MM-DD).');

/** Mês de referência: "2026-10". */
export const isoMonthSchema = z.string().regex(/^\d{4}-\d{2}$/, 'Mês inválido (AAAA-MM).');

/** Instante com fuso, como o JSON.stringify de um Date. */
export const isoDateTimeSchema = z.string().datetime({ offset: true });

export const idSchema = z.string().uuid();

export const colorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida (#RRGGBB).')
  .nullable()
  .optional();

/** Regra de recorrência no padrão RFC 5545, sem o prefixo "RRULE:": "FREQ=WEEKLY;BYDAY=MO". */
export const rruleSchema = z
  .string()
  .regex(/^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;[A-Z]+=[A-Za-z0-9,+-]+)*$/, 'Recorrência inválida.');

export const centsSchema = z.number().int();
export const positiveCentsSchema = z.number().int().positive('O valor precisa ser maior que zero.');

/** Minutos antes do início para lembrar. */
export const remindersSchema = z
  .array(
    z
      .number()
      .int()
      .min(0)
      .max(60 * 24 * 28)
  )
  .max(5);

export const messageResponseSchema = z.object({ message: z.string() });
export type MessageResponse = z.infer<typeof messageResponseSchema>;
