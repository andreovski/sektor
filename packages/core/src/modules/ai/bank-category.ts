import { and, desc, eq, gte, isNotNull, isNull, ne, or } from 'drizzle-orm';
import { z } from 'zod';

import type { AppCtx } from '../../app';
import { looksLikeInvoicePayment, shortDescription } from '../../bank/movements';
import { bankAccounts, bankMovements, categories } from '../../db/schema';

import { askChoice, hasJev } from './jev';
import { ask, isReady } from './run';
import { allowedAreas, readSettings } from './settings';

// A IA na revisão do banco: os que esperam revisão sem sugestão do histórico passam pelo modelo
// escolhido, uma vez cada (`aiCheckedAt`). Com a chave do Jev, ele confere cada um e só fica a
// sugestão em que os dois concordam. É sempre sugestão: a pessoa confere antes de lançar.

const BATCH = 40;
/** Teto de segurança: quantos lançamentos a IA olha em 24 h. */
export const DAILY_LIMIT = 200;
/** Abaixo disto, a conferência do Jev descarta a sugestão. */
export const MIN_CONFIDENCE = 0.6;
const NONE = 'nenhuma';

export interface AiCategory {
  id: string;
  label: string;
  kind: 'INCOME' | 'EXPENSE';
  parentId: string | null;
}

export interface AiDecision {
  categoryId: string;
  confidence: number;
}

function categoriesOf(ctx: AppCtx): AiCategory[] {
  const rows = ctx.db
    .select({ id: categories.id, name: categories.name, kind: categories.kind, parentId: categories.parentId })
    .from(categories)
    .where(isNull(categories.deletedAt))
    .all();
  const names = new Map(rows.map((c) => [c.id, c.name]));
  return rows
    .map((c) => {
      const parentId = c.parentId && names.has(c.parentId) ? c.parentId : null;
      return {
        id: c.id,
        kind: c.kind,
        parentId,
        label: parentId ? `${names.get(parentId)} › ${c.name}` : c.name,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
}

/**
 * A decisão com o Jev, igual à do Jotta: os dois na mesma categoria; ou o modelo na mãe e o Jev,
 * seguro, numa filha dela; ou os dois na mesma família, somando as probabilidades da família.
 */
export function decide(
  pick: string | null,
  probabilities: Map<string, number>,
  parents: Map<string, string | null>
): AiDecision | null {
  if (!pick) return null;
  let best: AiDecision | null = null;
  for (const [categoryId, confidence] of probabilities) {
    if (!best || confidence > best.confidence) best = { categoryId, confidence };
  }
  if (!best) return null;
  if (best.categoryId === pick) return best.confidence >= MIN_CONFIDENCE ? best : null;
  const root = (id: string) => parents.get(id) ?? id;
  const family = root(pick);
  if (root(best.categoryId) !== family) return null;
  if (pick === family && best.confidence >= MIN_CONFIDENCE) return best;
  let total = 0;
  for (const [categoryId, confidence] of probabilities) {
    if (root(categoryId) === family) total += confidence;
  }
  const confidence = Math.min(1, total);
  return confidence >= MIN_CONFIDENCE ? { categoryId: family, confidence } : null;
}

const SYSTEM = (list: AiCategory[]) => {
  const of = (kind: AiCategory['kind']) =>
    list
      .filter((c) => c.kind === kind)
      .map((c) => `- ${c.label}`)
      .join('\n') || '- (nenhuma)';
  return `Você categoriza lançamentos importados do extrato bancário de uma pessoa no Brasil, no app de finanças pessoais Sektor. Para cada lançamento, escolha a categoria da pessoa que mais faz sentido.

Categorias de saída (dinheiro que saiu):
${of('EXPENSE')}

Categorias de entrada (dinheiro que entrou):
${of('INCOME')}

Regras:
- Use só uma categoria do mesmo tipo do lançamento, escrita exatamente como na lista (com o " › " das subcategorias).
- Prefira a subcategoria quando ela couber; a categoria-mãe só quando nenhuma subcategoria couber.
- Olhe o título e o texto do banco. Lojas, apps e serviços conhecidos têm categoria óbvia (Uber é transporte, iFood é alimentação, Netflix é assinatura).
- Na dúvida, responda "${NONE}". Errar é pior que deixar em branco: a pessoa confere tudo antes de lançar.
- Responda um item para cada lançamento, com o mesmo n.`;
};

const money = (centsValue: number) => `R$ ${(centsValue / 100).toFixed(2).replace('.', ',')}`;

interface Pending {
  id: string;
  kind: 'INCOME' | 'EXPENSE';
  amountCents: number;
  description: string;
  card: boolean;
}

/** Sugere pela IA. Devolve quantos ganharam sugestão. Falha da IA não sobe: fica para a próxima. */
export async function suggestCategories(ctx: AppCtx): Promise<number> {
  const settings = readSettings(ctx);
  if (settings.bankCategory !== 'on' || !isReady(settings)) return 0;
  if (!allowedAreas(settings).includes('finance')) return 0;

  const since = Date.now() - 24 * 60 * 60 * 1000;
  const checkedToday = ctx.db
    .select({ id: bankMovements.id })
    .from(bankMovements)
    .where(gte(bankMovements.aiCheckedAt, since))
    .all().length;
  const room = DAILY_LIMIT - checkedToday;
  if (room <= 0) return 0;

  const found: Pending[] = ctx.db
    .select({
      id: bankMovements.id,
      kind: bankMovements.kind,
      amountCents: bankMovements.amountCents,
      description: bankMovements.description,
      type: bankAccounts.type,
    })
    .from(bankMovements)
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankMovements.bankAccountId))
    .where(
      and(
        eq(bankMovements.status, 'PENDING'),
        isNull(bankMovements.aiCheckedAt),
        isNull(bankMovements.suggestedCategoryId),
        isNotNull(bankAccounts.accountId)
      )
    )
    .orderBy(desc(bankMovements.date))
    .limit(room)
    .all()
    .map((m) => ({ ...m, card: m.type === 'CREDIT' }));
  // Pagamento de fatura vira transferência para o cartão ao aceitar: não leva categoria.
  const movements = found.filter((m) => !(m.kind === 'EXPENSE' && looksLikeInvoicePayment(m.description)));
  const list = categoriesOf(ctx);
  if (!movements.length || !list.length) return 0;
  const parents = new Map(list.map((c) => [c.id, c.parentId]));
  const labels: [string, ...string[]] = [NONE, ...new Set(list.map((c) => c.label))];
  const schema = z.object({
    itens: z.array(z.object({ n: z.number().int(), categoria: z.enum(labels) })),
  });

  let suggested = 0;
  for (let start = 0; start < movements.length; start += BATCH) {
    const batch = movements.slice(start, start + BATCH);
    const input = batch.map((m, i) => ({
      n: i + 1,
      tipo: m.kind === 'INCOME' ? 'entrada' : 'saída',
      valor: money(m.amountCents),
      onde: m.card ? 'cartão de crédito' : 'conta',
      titulo: shortDescription(m.description),
      texto_do_banco: m.description,
    }));
    let picks: (string | null)[];
    try {
      const answer = await ask(ctx, {
        feature: 'bank.category',
        system: SYSTEM(list),
        prompt: JSON.stringify(input),
        areas: ['finance'],
        schema,
        maxOutputTokens: 4000,
      });
      picks = batch.map((m, i) => {
        const label = answer.itens.find((item) => item.n === i + 1)?.categoria;
        if (!label || label === NONE) return null;
        // O mesmo nome existe em entradas e saídas: vale o do tipo do lançamento.
        return list.find((c) => c.label === label && c.kind === m.kind)?.id ?? null;
      });
    } catch {
      break;
    }

    for (const [i, movement] of batch.entries()) {
      const pick = picks[i] ?? null;
      const decision = pick ? await checkWithJev(ctx, movement, pick, list, parents) : null;
      // O Jev configurado e fora do ar: fica para a próxima, sem marcar como visto.
      if (decision === undefined) continue;
      const now = Date.now();
      ctx.db
        .update(bankMovements)
        .set(
          decision
            ? {
                aiCheckedAt: now,
                updatedAt: now,
                suggestedCategoryId: decision.categoryId,
                suggestionSource: 'AI',
                suggestionConfidence: decision.confidence < 0 ? null : decision.confidence,
              }
            : { aiCheckedAt: now, updatedAt: now }
        )
        // Pode ter sido lançado ou ganhado sugestão do histórico enquanto a IA pensava.
        .where(
          and(
            eq(bankMovements.id, movement.id),
            eq(bankMovements.status, 'PENDING'),
            or(isNull(bankMovements.suggestionSource), ne(bankMovements.suggestionSource, 'HISTORY'))
          )
        )
        .run();
      if (decision) suggested++;
    }
  }
  return suggested;
}

/**
 * Sem a chave do Jev, a escolha do modelo vale como está (confiança -1 = não conferida). Com a
 * chave e o Jev sem responder, `undefined`: tenta de novo depois.
 */
async function checkWithJev(
  ctx: AppCtx,
  movement: Pending,
  pick: string,
  list: AiCategory[],
  parents: Map<string, string | null>
): Promise<AiDecision | null | undefined> {
  if (!hasJev(ctx)) return { categoryId: pick, confidence: -1 };
  const sameKind = list.filter((c) => c.kind === movement.kind);
  const title = shortDescription(movement.description);
  const text = [
    `${movement.kind === 'INCOME' ? 'Entrada' : 'Saída'} de ${money(movement.amountCents)}`,
    movement.card ? 'no cartão de crédito' : 'na conta',
    `· ${title}`,
    movement.description !== title ? `· texto do banco: ${movement.description}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const scores = await askChoice(
    ctx,
    'bank.category.jev',
    { movement: text },
    'This is a transaction imported from the user bank statement (in Brazilian Portuguese): a title, the raw text from the bank, the amount and whether money went out or came in. Which of the user budget categories fits it best?',
    sameKind.map((c) => `${c.label} (${c.kind === 'INCOME' ? 'income' : 'expense'})`),
    'None of these categories fits'
  );
  if (!scores) return undefined;
  const probabilities = new Map(sameKind.map((c, i) => [c.id, scores[i] ?? 0]));
  return decide(pick, probabilities, parents);
}

/** Quantos esperam revisão sem sugestão e ainda não passaram pela IA. */
export function pendingForAi(ctx: AppCtx) {
  return ctx.db
    .select({ id: bankMovements.id })
    .from(bankMovements)
    .where(
      and(
        eq(bankMovements.status, 'PENDING'),
        isNull(bankMovements.aiCheckedAt),
        isNull(bankMovements.suggestedCategoryId)
      )
    )
    .all().length;
}

