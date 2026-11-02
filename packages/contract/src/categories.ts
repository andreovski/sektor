import { z } from 'zod';

import { colorSchema, idSchema } from './common';

export const categoryKindSchema = z.enum(['INCOME', 'EXPENSE']);
export type CategoryKind = z.infer<typeof categoryKindSchema>;

/** Categorias fixas do app (Transferência e as suas): não se apagam nem se renomeiam. */
export const categorySystemKeySchema = z.enum([
  'TRANSFER',
  'TRANSFER_PIX',
  'TRANSFER_DEBIT',
  'TRANSFER_CREDIT',
]);
export type CategorySystemKey = z.infer<typeof categorySystemKeySchema>;

export const createCategoryBodySchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome.').max(60),
  kind: categoryKindSchema,
  parentId: idSchema.nullable().optional(),
  icon: z.string().max(40).nullable().optional(),
  color: colorSchema,
});
export type CreateCategoryBody = z.infer<typeof createCategoryBodySchema>;

export const updateCategoryBodySchema = createCategoryBodySchema.omit({ kind: true }).partial();
export type UpdateCategoryBody = z.infer<typeof updateCategoryBodySchema>;

export const categoryResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: categoryKindSchema,
  parentId: z.string().nullable(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  systemKey: categorySystemKeySchema.nullable(),
  /** Veio com o app (categoria padrão); a pessoa edita e apaga como as dela. */
  isDefault: z.boolean(),
});
export type CategoryResponse = z.infer<typeof categoryResponseSchema>;
