import { MockLanguageModelV4 } from 'ai/test';
import { eq, sql } from 'drizzle-orm';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppCtx } from '../../app';
import { type DbHandle, openDatabase } from '../../db/client';
import { accounts, bankAccounts, bankMovements, categories, pluggyItems } from '../../db/schema';
import { ensureCategories } from '../../services/categories';
import { stamp } from '../../services/context';
import * as fin from '../../services/finance';
import * as bank from '../../bank';

import { handlers } from '.';
import { DAILY_CALLS, decide } from './bank-category';
import { setJevForTests } from './jev';
import { costMicros, setModelForTests } from './providers';
import { redact } from './redact';
import { aiCalls } from './schema';

// Quarta, 04/11/2026, 12h em São Paulo.
const NOW = new Date('2026-11-04T15:00:00Z');

interface Call {
  prompt: string;
  system: string;
}

/** Modelo de mentira: responde o que `reply` mandar e guarda o que recebeu. */
function fakeModel(reply: (call: Call) => string) {
  const calls: Call[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      const system = options.prompt
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n');
      const prompt = options.prompt
        .filter((m) => m.role === 'user')
        .flatMap((m) => m.content)
        .map((part) => (part.type === 'text' ? part.text : ''))
        .join('\n');
      const call = { system, prompt };
      calls.push(call);
      return {
        content: [{ type: 'text', text: reply(call) }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 200, text: 200, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });
  return { model, calls };
}

describe('IA', () => {
  let dir: string;
  let handle: DbHandle;
  let ctx: AppCtx;
  let rpc: ReturnType<typeof handlers>;
  let secrets: Map<string, string>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    dir = mkdtempSync(join(tmpdir(), 'sektor-ai-'));
    handle = openDatabase(join(dir, 'a.db'), 'd'.repeat(64));
    secrets = new Map();
    ctx = {
      db: handle.orm,
      timeZone: 'America/Sao_Paulo',
      secrets: {
        get: (name: string) => secrets.get(name) ?? null,
        set: (name: string, value: string | null) =>
          value === null ? secrets.delete(name) : secrets.set(name, value),
      },
      keys: { get: () => null, set: () => {} },
      notify: () => {},
    } as unknown as AppCtx;
    ensureCategories(ctx);
    rpc = handlers(ctx);
  });

  afterEach(() => {
    setModelForTests(null);
    setJevForTests(null);
    vi.useRealTimers();
    handle.raw.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const useClaude = (model = 'claude-haiku-5-5') => {
    rpc['ai.setKey']({ provider: 'anthropic', key: 'sk-teste' });
    rpc['ai.acceptNotice']({ provider: 'anthropic' });
    return rpc['ai.models.add']({ provider: 'anthropic', model }).added;
  };
  const useOllama = (baseUrl?: string) =>
    rpc['ai.models.add']({ provider: 'ollama', model: 'qwen3:8b', baseUrl }).added;

  describe('configuração', () => {
    it('nasce sem modelo, com saúde e diário desligados e categoria do banco a perguntar', () => {
      const status = rpc['ai.status']();
      expect(status.models).toEqual([]);
      expect(status.ready).toBe(false);
      expect(status.areas.health).toBe(false);
      expect(status.areas.journal).toBe(false);
      expect(status.areas.finance).toBe(true);
      expect(status.bankCategory).toBe('ask');
    });

    it('a chave vai para o cofre e a tela só sabe que ela existe', () => {
      rpc['ai.setKey']({ provider: 'anthropic', key: 'sk-segredo' });
      expect(secrets.get('ai.key.anthropic')).toBe('sk-segredo');
      expect(JSON.stringify(rpc['ai.status']())).not.toContain('sk-segredo');
      expect(rpc['ai.status']().keys.anthropic).toBe(true);
      rpc['ai.setKey']({ provider: 'anthropic', key: null });
      expect(secrets.has('ai.key.anthropic')).toBe(false);
    });

    it('nuvem só fica pronta com chave e aviso aceito; o Ollama dispensa os dois', async () => {
      setModelForTests(fakeModel(() => 'oi').model);
      const claude = rpc['ai.models.add']({ provider: 'anthropic', model: 'claude-haiku-5-5' }).added;
      expect(rpc['ai.status']().ready).toBe(false);
      await expect(rpc['ai.test']({ id: claude })).rejects.toThrow(/chave/);
      rpc['ai.setKey']({ provider: 'anthropic', key: 'sk' });
      await expect(rpc['ai.test']({ id: claude })).rejects.toThrow(/aviso de privacidade/);
      rpc['ai.acceptNotice']({ provider: 'anthropic' });
      expect(rpc['ai.status']().ready).toBe(true);

      const local = useOllama();
      const status = rpc['ai.status']();
      expect(status.models.find((m) => m.id === local)).toMatchObject({ local: true, problem: null });
    });

    it('vários modelos juntos: o primeiro é o padrão e cada uso pode ter o seu', async () => {
      const local = useOllama();
      const sonnet = useClaude('claude-sonnet-5-5');
      const haiku = useClaude('claude-haiku-5-5');
      expect(rpc['ai.status']().defaultModelId).toBe(local);
      rpc['ai.update']({ uses: { weekly: sonnet, bankCategory: haiku } });
      const status = rpc['ai.status']();
      expect(status.resolved.weekly.modelId).toBe(sonnet);
      expect(status.resolved.bankCategory.modelId).toBe(haiku);
      expect(status.resolved.financeChanges).toMatchObject({ modelId: local, local: true });

      // Tirar um modelo devolve o uso dele ao padrão.
      rpc['ai.models.remove']({ id: sonnet });
      expect(rpc['ai.status']().resolved.weekly.modelId).toBe(local);
      rpc['ai.models.remove']({ id: local });
      expect(rpc['ai.status']().defaultModelId).toBe(haiku);
      expect(() => rpc['ai.models.add']({ provider: 'anthropic', model: 'claude-haiku-5-5' })).toThrow(/já está/);
    });

    it('as áreas seguem o modelo de cada chamada: local lê tudo, nuvem respeita as chaves', async () => {
      const local = useOllama();
      const claude = useClaude();
      const { model, calls } = fakeModel(() => '{"journal":"ok"}');
      setModelForTests(model);
      ctx.db.run(
        sql`INSERT INTO reviews (id, created_at, updated_at, week_start, went_well, blocked, priorities)
            VALUES ('r1', 0, 0, '2026-11-02', 'Dormi melhor', '', '[]')`
      );
      await rpc['ai.insight.generate']({ kind: 'weekly', modelId: local });
      expect(calls[0]!.prompt).toContain('Dormi melhor');
      await rpc['ai.insight.generate']({ kind: 'weekly', modelId: claude });
      expect(calls[1]!.prompt).not.toContain('Dormi melhor');
      expect(rpc['ai.insight']({ kind: 'weekly' }).model).toBe('claude-haiku-5-5');
    });

    it('o formato antigo, de um modelo só, vira a lista com ele como padrão', () => {
      ctx.db.run(
        sql`INSERT INTO app_meta (key, value, updated_at)
            VALUES ('ai.settings', '{"provider":"ollama","model":"qwen3:8b","baseUrl":null}', 0)`
      );
      const status = rpc['ai.status']();
      expect(status.models).toMatchObject([{ provider: 'ollama', model: 'qwen3:8b' }]);
      expect(status.defaultModelId).toBe(status.models[0]!.id);
    });

    it('Ollama em outro computador conta como nuvem; o endereço ganha /v1', () => {
      const remote = useOllama('http://192.168.0.10:11434');
      const model = rpc['ai.status']().models.find((m) => m.id === remote)!;
      expect(model).toMatchObject({ baseUrl: 'http://192.168.0.10:11434/v1', local: false });
      expect(model.problem).toMatch(/aviso/);
      const local = rpc['ai.models.add']({ provider: 'ollama', model: 'qwen3:8b', baseUrl: 'http://localhost:11434/' }).added;
      expect(rpc['ai.status']().models.find((m) => m.id === local)!.local).toBe(true);
    });

    it('sem o modo dev, o total do mês não sai do núcleo', async () => {
      useClaude();
      setModelForTests(fakeModel(() => 'oi').model);
      await rpc['ai.test']().catch(() => {});
      expect(rpc['ai.calls']().month).toEqual([]);
    });
  });

  describe('chamada', () => {
    it('limpa CPF, CNPJ, cartão e conta antes de enviar', () => {
      expect(redact('Pix para 123.456.789-09 e 12.345.678/0001-90')).toBe('Pix para [CPF] e [CNPJ]');
      expect(redact('cartão 4111 1111 1111 1111')).toBe('cartão [CARTÃO]');
      expect(redact('Conta 12345-6 ag 0001')).toBe('Conta [NÚMERO] ag [NÚMERO]');
      expect(redact('Uber R$ 23,90 dia 12/10')).toBe('Uber R$ 23,90 dia 12/10');
    });

    it('registra tokens e custo, e só guarda o conteúdo com a depuração ligada', async () => {
      useClaude();
      const { model } = fakeModel((call) => (call.system.includes('objeto') ? '{"soma":5,"capital":"Brasília"}' : 'Olá!'));
      setModelForTests(model);
      const result = await rpc['ai.test']();
      expect(result).toMatchObject({ text: 'Olá!', json: true });
      const rows = ctx.db.select().from(aiCalls).all();
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ ok: true, inputTokens: 1000, outputTokens: 200, content: null });
      // Haiku 5.5: US$ 0,10 e 0,50 por milhão.
      expect(rows[0]!.costMicros).toBe(200);

      rpc['ai.update']({ debug: true });
      await rpc['ai.test']();
      expect(ctx.db.select().from(aiCalls).all().some((r) => r.content?.includes('Olá'))).toBe(true);
    });

    it('tokens e custo só saem no modo dev', async () => {
      useClaude();
      setModelForTests(fakeModel(() => 'oi').model);
      await rpc['ai.test']().catch(() => {});
      const ok = () => rpc['ai.calls']().rows.find((row) => row.ok)!;
      expect(ok().costMicros).toBeNull();
      rpc['ai.update']({ devMode: true });
      expect(ok().inputTokens).toBe(1000);
    });

    it('local e :free custam zero; modelo sem preço conhecido fica sem custo', () => {
      expect(costMicros('ollama', 'qwen3:8b', 5000, 5000)).toBe(0);
      expect(costMicros('openrouter', 'x/y:free', 5000, 5000)).toBe(0);
      expect(costMicros('openai', 'modelo-novo', 5000, 5000)).toBeNull();
    });

    it('falha do provedor vira mensagem para a pessoa e fica no registro', async () => {
      useClaude();
      setModelForTests(
        new MockLanguageModelV4({
          doGenerate: async () => {
            throw new Error('401 invalid x-api-key');
          },
        })
      );
      await expect(rpc['ai.test']()).rejects.toThrow(/não respondeu/);
      expect(ctx.db.select().from(aiCalls).get()).toMatchObject({ ok: false });
    });
  });

  describe('insights', () => {
    const spend = (date: string, amountCents: number, category = 'Mercado') => {
      const account =
        ctx.db.select().from(accounts).get() ??
        fin.createAccount(ctx, { name: 'Conta', type: 'CHECKING', initialBalanceCents: 0 });
      const categoryId = ctx.db.select().from(categories).where(eq(categories.name, category)).get()!.id;
      fin.createTransactions(ctx, {
        kind: 'EXPENSE',
        amountCents,
        date,
        accountId: account.id,
        categoryId,
        description: 'Compra',
        status: 'DONE',
      } as never);
    };

    it('o resumo da semana manda só as áreas liberadas e volta guardado', async () => {
      useClaude();
      spend('2026-11-03', 12_345);
      spend('2026-10-28', 5_000);
      const { model, calls } = fakeModel(
        () => '{"finance":"Você gastou [[12345]] nesta semana.","tasks":"Nenhuma tarefa concluída."}'
      );
      setModelForTests(model);

      expect(rpc['ai.insight']({ kind: 'weekly' })).toMatchObject({ period: '2026-11-02', text: null });
      const generated = await rpc['ai.insight.generate']({ kind: 'weekly' });
      expect(generated.stale).toBe(false);
      // Um cartão por área, na ordem das áreas, com o texto de cada uma.
      expect(generated.sections).toEqual([
        { area: 'finance', text: 'Você gastou [[12345]] nesta semana.' },
        { area: 'tasks', text: 'Nenhuma tarefa concluída.' },
      ]);
      expect(calls[0]!.prompt).toContain('[[12345]]');
      expect(calls[0]!.prompt).not.toContain('humor');
      expect(ctx.db.select().from(aiCalls).get()!.areas).not.toContain('health');

      // Gasto novo: o texto guardado fica marcado como desatualizado, sem chamar o modelo.
      spend('2026-11-04', 1_000);
      expect(rpc['ai.insight']({ kind: 'weekly' }).stale).toBe(true);
      expect(calls).toHaveLength(1);
    });

    it('o que mudou no financeiro compara as categorias com o mês passado', async () => {
      useClaude();
      spend('2026-11-02', 30_000);
      spend('2026-10-10', 10_000);
      const { model, calls } = fakeModel(() => 'Mercado subiu.');
      setModelForTests(model);
      await rpc['ai.insight.generate']({ kind: 'financeChanges', period: '2026-11' });
      const sent = JSON.parse(calls[0]!.prompt);
      expect(sent.maioresMudancasPorCategoria[0]).toEqual({
        categoria: 'Mercado',
        esteMes: '[[30000]]',
        mesPassado: '[[10000]]',
      });
      expect(sent.diaDeHojeNoMesCorrente).toBe(4);
    });

    it('o texto guardado não fica desatualizado só porque o dia virou', async () => {
      useClaude();
      spend('2026-11-03', 12_345);
      setModelForTests(fakeModel(() => 'ok').model);
      await rpc['ai.insight.generate']({ kind: 'financeChanges', period: '2026-11' });
      vi.setSystemTime(new Date('2026-11-05T15:00:00Z'));
      expect(rpc['ai.insight']({ kind: 'financeChanges', period: '2026-11' }).stale).toBe(false);
    });

    it('com finanças desligada, o insight do financeiro é recusado', async () => {
      useClaude();
      rpc['ai.update']({ areas: { finance: false } });
      expect(() => rpc['ai.insight']({ kind: 'financeChanges' })).toThrow(/desligada/);
    });
  });

  describe('categoria na revisão do banco', () => {
    let account: string;
    let bankAccountId: string;

    beforeEach(() => {
      account = fin.createAccount(ctx, { name: 'Conta', type: 'CHECKING', initialBalanceCents: 0 }).id;
      const item = ctx.db
        .insert(pluggyItems)
        .values({ ...stamp(), itemId: 'item', name: 'Banco' })
        .returning()
        .get();
      bankAccountId = ctx.db
        .insert(bankAccounts)
        .values({ ...stamp(), itemId: item.id, externalId: 'ext', name: 'Conta', type: 'BANK', accountId: account })
        .returning()
        .get().id;
    });

    const movement = (description: string, kind: 'INCOME' | 'EXPENSE' = 'EXPENSE') =>
      ctx.db
        .insert(bankMovements)
        .values({
          ...stamp(),
          bankAccountId,
          externalId: description,
          kind,
          amountCents: 2390,
          date: '2026-11-03',
          description,
          status: 'PENDING',
        })
        .returning()
        .get().id;

    const find = (id: string) => ctx.db.select().from(bankMovements).where(eq(bankMovements.id, id)).get()!;

    it('não roda enquanto a pessoa não ligar', async () => {
      useClaude();
      movement('UBER *TRIP');
      const { model, calls } = fakeModel(() => '{"itens":[]}');
      setModelForTests(model);
      expect(await rpc['ai.bankCategory.run']()).toEqual({ suggested: 0 });
      expect(calls).toHaveLength(0);
    });

    it('sem o Jev, a escolha do modelo vira sugestão sem confiança, uma vez só', async () => {
      useClaude();
      rpc['ai.update']({ bankCategory: 'on' });
      const uber = movement('UBER *TRIP');
      const odd = movement('PIX XPTO');
      const { model, calls } = fakeModel(() =>
        JSON.stringify({ itens: [{ n: 1, categoria: 'Transporte › Aplicativos de mobilidade' }, { n: 2, categoria: 'nenhuma' }] })
      );
      setModelForTests(model);
      const expected = ctx.db.select().from(categories).where(eq(categories.name, 'Aplicativos de mobilidade')).get();
      expect(await rpc['ai.bankCategory.run']()).toEqual({ suggested: expected ? 1 : 0 });
      if (expected) {
        expect(find(uber)).toMatchObject({
          suggestedCategoryId: expected.id,
          suggestionSource: 'AI',
          suggestionConfidence: null,
        });
      }
      expect(find(odd).aiCheckedAt).not.toBeNull();
      await rpc['ai.bankCategory.run']();
      expect(calls).toHaveLength(1);

      const listed = bank.listMovements(ctx).find((m) => m.id === uber)!;
      if (expected) expect(listed.suggestionSource).toBe('AI');
    });

    it('com o Jev, só fica a sugestão em que os dois concordam', async () => {
      useClaude();
      rpc['ai.update']({ bankCategory: 'on' });
      rpc['ai.setKey']({ provider: 'jev', key: 'jev-chave' });
      rpc['ai.acceptNotice']({ provider: 'jev' });
      const id = movement('PADARIA DO ZE 123.456.789-09');
      let sent = '';
      const market = ctx.db.select().from(categories).where(eq(categories.name, 'Mercado')).get()!;
      setModelForTests(fakeModel(() => JSON.stringify({ itens: [{ n: 1, categoria: 'Mercado' }] })).model);
      setJevForTests(async (_key, state, questions) => {
        sent = JSON.stringify(state);
        const criteria = questions.answer!.criteria;
        const key = Object.entries(criteria).find(([, label]) => label.startsWith('Mercado'))![0];
        return { answers: { answer: { type: 'choice', choice: key, probabilities: { [key]: 0.9 } } } };
      });
      expect(await rpc['ai.bankCategory.run']()).toEqual({ suggested: 1 });
      expect(find(id)).toMatchObject({ suggestedCategoryId: market.id, suggestionConfidence: 0.9 });
      expect(sent).toContain('[CPF]');
      expect(sent).not.toContain('123.456.789-09');
    });

    it('sem o aviso do Jev aceito, ele não é chamado, nem com o modelo local', async () => {
      useOllama();
      rpc['ai.update']({ bankCategory: 'on' });
      rpc['ai.setKey']({ provider: 'jev', key: 'jev-chave' });
      movement('PADARIA DO ZE');
      setModelForTests(fakeModel(() => JSON.stringify({ itens: [{ n: 1, categoria: 'Mercado' }] })).model);
      let called = false;
      setJevForTests(async () => {
        called = true;
        return { answers: {} };
      });
      await rpc['ai.bankCategory.run']();
      expect(called).toBe(false);
      expect(rpc['ai.status']().jevReady).toBe(false);
    });

    it('com o Jev fora do ar, não decide: fica sem sugestão e não volta a ser enviado', async () => {
      useClaude();
      rpc['ai.update']({ bankCategory: 'on' });
      rpc['ai.setKey']({ provider: 'jev', key: 'jev-chave' });
      rpc['ai.acceptNotice']({ provider: 'jev' });
      const id = movement('PADARIA DO ZE');
      const { model, calls } = fakeModel(() => JSON.stringify({ itens: [{ n: 1, categoria: 'Mercado' }] }));
      setModelForTests(model);
      setJevForTests(async () => {
        throw new Error('Jev 503');
      });
      await rpc['ai.bankCategory.run']();
      expect(find(id)).toMatchObject({ suggestedCategoryId: null });
      expect(find(id).aiCheckedAt).not.toBeNull();
      await rpc['ai.bankCategory.run']();
      expect(calls).toHaveLength(1);
    });

    it('falha repetida do modelo para no teto de chamadas do dia', async () => {
      useClaude();
      rpc['ai.update']({ bankCategory: 'on' });
      movement('PADARIA DO ZE');
      let tries = 0;
      setModelForTests(
        new MockLanguageModelV4({
          doGenerate: async () => {
            tries++;
            throw new Error('fora do ar');
          },
        })
      );
      for (let i = 0; i < 15; i++) await rpc['ai.bankCategory.run']();
      expect(tries).toBe(DAILY_CALLS);
    });

    it('o botão e o job ao mesmo tempo mandam uma vez só', async () => {
      useClaude();
      rpc['ai.update']({ bankCategory: 'on' });
      movement('UBER *TRIP');
      const { model, calls } = fakeModel(() => JSON.stringify({ itens: [{ n: 1, categoria: 'nenhuma' }] }));
      setModelForTests(model);
      await Promise.all([rpc['ai.bankCategory.run'](), rpc['ai.bankCategory.run']()]);
      expect(calls).toHaveLength(1);
    });

    it('pagamento de fatura não conta como pendente nem ocupa a IA', async () => {
      useClaude();
      rpc['ai.update']({ bankCategory: 'on' });
      movement('PAGAMENTO DE FATURA');
      expect(rpc['ai.status']().bankPending).toBe(0);
    });

    it('a sugestão da IA de uma categoria apagada sai na próxima leitura', () => {
      const id = movement('UBER *TRIP');
      const market = ctx.db.select().from(categories).where(eq(categories.name, 'Mercado')).get()!;
      ctx.db
        .update(bankMovements)
        .set({ suggestedCategoryId: market.id, suggestionSource: 'AI', aiCheckedAt: Date.now() })
        .where(eq(bankMovements.id, id))
        .run();
      expect(bank.listMovements(ctx).find((m) => m.id === id)!.suggestionSource).toBe('AI');
      ctx.db.update(categories).set({ deletedAt: Date.now() }).where(eq(categories.id, market.id)).run();
      expect(bank.listMovements(ctx).find((m) => m.id === id)!.suggestedCategoryId).not.toBe(market.id);
    });

    it('decide como o Jotta: mesma categoria, filha da mãe escolhida ou soma da família', () => {
      const parents = new Map<string, string | null>([
        ['food', null],
        ['market', 'food'],
        ['bakery', 'food'],
        ['car', null],
      ]);
      expect(decide('market', new Map([['market', 0.7]]), parents)).toEqual({ categoryId: 'market', confidence: 0.7 });
      expect(decide('market', new Map([['market', 0.5]]), parents)).toBeNull();
      expect(decide('food', new Map([['bakery', 0.8]]), parents)).toEqual({ categoryId: 'bakery', confidence: 0.8 });
      expect(
        decide('market', new Map([['bakery', 0.4], ['market', 0.3]]), parents)
      ).toEqual({ categoryId: 'food', confidence: 0.7 });
      expect(decide('market', new Map([['car', 0.9]]), parents)).toBeNull();
    });
  });
});
