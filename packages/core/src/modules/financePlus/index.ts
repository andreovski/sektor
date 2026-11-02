import { idSchema, isoDateSchema } from '@sektor/contract';
import { z } from 'zod';

import type { AppCtx, Job } from '../../app';
import { parse } from '../finance';

import * as svc from './service';
import { MAX_BYTES } from './statement';

const cents = z.number().int().min(0).max(1e12);

const debtBody = z.object({
  name: z.string().trim().min(1, 'Informe o nome.').max(120),
  balanceCents: cents,
  rateBp: z.number().int().min(0).max(10_000, 'Juros acima de 100% ao mês.'),
  minPaymentCents: cents,
  dueDay: z.number().int().min(1, 'Dia inválido.').max(31, 'Dia inválido.'),
});

const ruleBody = z.object({
  pattern: z.string().trim().min(2, 'Escreva ao menos 2 letras.').max(80),
  categoryId: idSchema,
});

const settingsBody = z.object({
  dailyCapCents: cents.positive('O teto precisa ser maior que zero.').nullable(),
});

const renegotiationBody = z.object({
  id: idSchema,
  rateBp: z.number().int().min(0).max(10_000),
  termMonths: z.number().int().min(1, 'Informe o prazo.').max(360, 'Prazo acima de 30 anos.'),
});

// Texto decodificado pode crescer um pouco em relação aos bytes: a conta exata é do parser.
const importBody = z.object({
  text: z.string().max(MAX_BYTES * 2, 'O arquivo passa de 5 MB.'),
  fileName: z.string().max(260).optional(),
  accountId: idSchema,
  mode: z.enum(['statement', 'invoice']),
  invert: z.boolean().optional(),
  dueDate: isoDateSchema.optional(),
});

const confirmBody = importBody.extend({
  selected: z.array(z.number().int().min(0)).max(5000),
  categories: z.record(z.string(), idSchema.nullable()).optional(),
});

const schema = <T>(value: z.ZodType<T>) => value as never;

export const handlers = (ctx: AppCtx) => ({
  'plus.available': () => svc.available(ctx),
  'plus.available.settings': (input: z.input<typeof settingsBody>) =>
    svc.saveAvailableSettings(ctx, parse(schema(settingsBody), input)),

  'plus.debts.list': () => svc.listDebts(ctx),
  'plus.debts.create': (input: svc.DebtBody) =>
    svc.createDebt(ctx, parse(schema(debtBody), input)),
  'plus.debts.update': ({ id, ...input }: svc.DebtBody & { id: string }) =>
    svc.updateDebt(ctx, id, parse(schema(debtBody), input)),
  'plus.debts.delete': ({ id }: { id: string }) => svc.deleteDebt(ctx, id),
  'plus.debts.plan': ({ extraCents }: { extraCents: number }) =>
    svc.debtPlan(ctx, parse(schema(cents), extraCents)),
  'plus.debts.renegotiate': (input: z.input<typeof renegotiationBody>) => {
    const body = parse<z.output<typeof renegotiationBody>>(schema(renegotiationBody), input);
    return svc.renegotiate(ctx, body.id, body.rateBp, body.termMonths);
  },

  'plus.rules.list': () => svc.listRules(ctx),
  'plus.rules.create': (input: z.input<typeof ruleBody>) =>
    svc.createRule(ctx, parse(schema(ruleBody), input)),
  'plus.rules.update': ({ id, ...input }: z.input<typeof ruleBody> & { id: string }) =>
    svc.updateRule(ctx, id, parse(schema(ruleBody), input)),
  'plus.rules.delete': ({ id }: { id: string }) => svc.deleteRule(ctx, id),
  'plus.rules.preview': () => svc.previewRules(ctx),
  'plus.rules.apply': ({ overwrite }: { overwrite: boolean }) =>
    svc.applyRules(ctx, overwrite === true),

  'plus.recurring.suggestions': () => svc.recurringSuggestions(ctx),
  'plus.recurring.accept': ({ key }: { key: string }) => svc.acceptRecurring(ctx, key),
  'plus.recurring.dismiss': ({ key }: { key: string }) => svc.dismissRecurring(ctx, key),

  'plus.import.preview': (input: z.input<typeof importBody>) =>
    svc.previewImport(ctx, parse(schema(importBody), input)),
  'plus.import.confirm': (input: z.input<typeof confirmBody>) =>
    svc.confirmImport(ctx, parse(schema(confirmBody), input)),
  'plus.import.nextDue': ({ accountId }: { accountId: string }) =>
    svc.nextInvoiceDue(ctx, accountId),
});

export const jobs: Job[] = [];
