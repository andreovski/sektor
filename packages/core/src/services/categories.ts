import type {
  CategoryResponse,
  CategorySystemKey,
  CreateCategoryBody,
  UpdateCategoryBody,
} from '@sektor/contract';
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';

import { budgets, categories, recurrences, transactions } from '../db/schema';

import { AppError, type Ctx, notFound, stamp } from './context';
import { DEFAULT_CATEGORIES } from './default-categories';

type Category = typeof categories.$inferSelect;

/** Transferência e as formas de pagamento, uma árvore em entradas e outra em saídas. */
const SYSTEM_CATEGORIES: {
  key: CategorySystemKey;
  name: string;
  icon: string;
  color?: string;
  parent?: CategorySystemKey;
}[] = [
  { key: 'TRANSFER', name: 'Transferência', icon: 'landmark', color: '#32ade6' },
  { key: 'TRANSFER_PIX', name: 'Pix', icon: 'pix', parent: 'TRANSFER' },
  { key: 'TRANSFER_DEBIT', name: 'Débito', icon: 'wallet', parent: 'TRANSFER' },
  { key: 'TRANSFER_CREDIT', name: 'Crédito', icon: 'credit-card', parent: 'TRANSFER' },
];

const KINDS = ['INCOME', 'EXPENSE'] as const;

/** Cria as categorias fixas que faltam e, num banco novo, as padrão. */
export function ensureCategories(ctx: Ctx) {
  const isNew = !ctx.db.select({ id: categories.id }).from(categories).get();
  ctx.db.transaction(() => {
    for (const kind of KINDS) {
      const existing = ctx.db.select().from(categories).where(eq(categories.kind, kind)).all();
      const ids = new Map(existing.map((c) => [c.systemKey, c.id]));
      for (const item of SYSTEM_CATEGORIES) {
        if (ids.has(item.key)) continue;
        const row = stamp();
        ctx.db
          .insert(categories)
          .values({
            ...row,
            kind,
            name: item.name,
            icon: item.icon,
            color: item.color ?? null,
            systemKey: item.key,
            parentId: item.parent ? (ids.get(item.parent) ?? null) : null,
          })
          .run();
        ids.set(item.key, row.id);
      }
      if (!isNew) continue;
      for (const item of DEFAULT_CATEGORIES[kind]) {
        const parent = stamp();
        ctx.db
          .insert(categories)
          .values({
            ...parent,
            kind,
            name: item.name,
            icon: item.icon,
            color: item.color ?? null,
            defaultKey: item.key,
          })
          .run();
        for (const child of item.children ?? []) {
          ctx.db
            .insert(categories)
            .values({
              ...stamp(),
              kind,
              name: child.name,
              icon: child.icon,
              parentId: parent.id,
              defaultKey: child.key,
            })
            .run();
        }
      }
    }
  });
}

const toCategory = (category: Category): CategoryResponse => ({
  id: category.id,
  name: category.name,
  kind: category.kind,
  parentId: category.parentId,
  icon: category.icon,
  color: category.color,
  systemKey: category.systemKey as CategorySystemKey | null,
  isDefault: category.defaultKey !== null,
});

function find(ctx: Ctx, id: string) {
  return ctx.db
    .select()
    .from(categories)
    .where(and(eq(categories.id, id), isNull(categories.deletedAt)))
    .get();
}

export function listCategories(ctx: Ctx): CategoryResponse[] {
  return ctx.db
    .select()
    .from(categories)
    .where(isNull(categories.deletedAt))
    .orderBy(asc(categories.kind), asc(categories.name))
    .all()
    .map(toCategory);
}

export function createCategory(ctx: Ctx, body: CreateCategoryBody): CategoryResponse {
  if (body.parentId) {
    const parent = find(ctx, body.parentId);
    if (!parent) throw notFound('Categoria-mãe não encontrada.');
    if (parent.parentId) throw new AppError(400, 'Subcategorias vão até um nível só.');
    if (parent.kind !== body.kind) {
      throw new AppError(400, 'A subcategoria precisa ser do mesmo tipo.');
    }
  }
  return toCategory(
    ctx.db
      .insert(categories)
      .values({
        ...stamp(),
        name: body.name,
        kind: body.kind,
        parentId: body.parentId ?? null,
        icon: body.icon ?? null,
        color: body.color ?? null,
      })
      .returning()
      .get()
  );
}

export function updateCategory(ctx: Ctx, id: string, body: UpdateCategoryBody): CategoryResponse {
  const category = find(ctx, id);
  if (!category) throw notFound('Categoria não encontrada.');
  if (body.parentId === id) throw new AppError(400, 'A categoria não pode ser mãe de si mesma.');
  // Fixa: muda cor e ícone, mas não o nome nem o lugar.
  if (
    category.systemKey &&
    ((body.name !== undefined && body.name !== category.name) ||
      (body.parentId !== undefined && body.parentId !== category.parentId))
  ) {
    throw new AppError(409, 'Esta categoria é fixa do app: dá para mudar só a cor e o ícone.');
  }
  return toCategory(
    ctx.db
      .update(categories)
      .set({ ...body, updatedAt: Date.now() })
      .where(eq(categories.id, id))
      .returning()
      .get()
  );
}

/** Os lançamentos e as recorrências ficam sem categoria; subcategorias e orçamentos saem junto. */
export function deleteCategory(ctx: Ctx, id: string) {
  const category = find(ctx, id);
  if (!category) throw notFound('Categoria não encontrada.');
  if (category.systemKey) {
    throw new AppError(409, 'Esta categoria é fixa do app e não pode ser apagada.');
  }
  const ids = ctx.db
    .select({ id: categories.id })
    .from(categories)
    .where(or(eq(categories.id, id), eq(categories.parentId, id)))
    .all()
    .map((row) => row.id);
  const now = Date.now();
  ctx.db.transaction(() => {
    ctx.db
      .update(transactions)
      .set({ categoryId: null, updatedAt: now })
      .where(inArray(transactions.categoryId, ids))
      .run();
    for (const recurrence of ctx.db.select().from(recurrences).all()) {
      const template = recurrence.template as { categoryId?: string | null };
      if (!template.categoryId || !ids.includes(template.categoryId)) continue;
      ctx.db
        .update(recurrences)
        .set({ template: { ...template, categoryId: null }, updatedAt: now })
        .where(eq(recurrences.id, recurrence.id))
        .run();
    }
    ctx.db
      .update(budgets)
      .set({ deletedAt: now, updatedAt: now })
      .where(inArray(budgets.categoryId, ids))
      .run();
    ctx.db
      .update(categories)
      .set({ deletedAt: now, updatedAt: now })
      .where(inArray(categories.id, ids))
      .run();
  });
}
