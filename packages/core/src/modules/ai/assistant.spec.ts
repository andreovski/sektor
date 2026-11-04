import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { eq, sql } from 'drizzle-orm';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppCtx } from '../../app';
import { type DbHandle, openDatabase } from '../../db/client';
import { accounts, categories } from '../../db/schema';
import { ensureCategories } from '../../services/categories';
import * as fin from '../../services/finance';

import { handlers } from '.';
import { purgeOld } from './assistant';
import { setModelForTests } from './providers';
import { aiConversations, aiMessages } from './schema';
import { createEvent } from '../agenda/service';
import { createGoal } from '../goals/service';
import { upsertBudget } from '../../services/reports';
import { handlers as toggles } from '../toggles';

// Quarta, 04/11/2026, 12h em São Paulo.
const NOW = new Date('2026-11-04T15:00:00Z');

const usage = {
  inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
};

interface Seen {
  tools: string[];
  prompt: string;
}

/** Modelo de mentira: no primeiro passo chama `call` (se houver), no segundo responde `answer`. */
function scripted(call: { name: string; input: object } | null, answer: (toolResult: string) => string) {
  const seen: Seen[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      const prompt = JSON.stringify(options.prompt);
      seen.push({ tools: (options.tools ?? []).map((t) => t.name), prompt });
      const toolResult = options.prompt
        .filter((m) => m.role === 'tool')
        .flatMap((m) => m.content)
        .map((part) => JSON.stringify(part))
        .join('');
      if (call && !toolResult) {
        return {
          content: [
            { type: 'tool-call', toolCallId: 't1', toolName: call.name, input: JSON.stringify(call.input) },
          ],
          finishReason: { unified: 'tool-calls', raw: undefined },
          usage,
          warnings: [],
        };
      }
      return {
        content: [{ type: 'text', text: answer(toolResult) }],
        finishReason: { unified: 'stop', raw: undefined },
        usage,
        warnings: [],
      };
    },
  });
  return { model, seen };
}

describe('assistente', () => {
  let dir: string;
  let handle: DbHandle;
  let ctx: AppCtx;
  let rpc: ReturnType<typeof handlers>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    dir = mkdtempSync(join(tmpdir(), 'sektor-assistant-'));
    handle = openDatabase(join(dir, 'a.db'), 'e'.repeat(64));
    const secrets = new Map<string, string>();
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
    vi.useRealTimers();
    handle.raw.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const useClaude = () => {
    rpc['ai.setKey']({ provider: 'anthropic', key: 'sk' });
    rpc['ai.acceptNotice']({ provider: 'anthropic' });
    return rpc['ai.models.add']({ provider: 'anthropic', model: 'claude-haiku-5-5' }).added;
  };

  const spend = (date: string, amountCents: number, description = 'Compra') => {
    const account =
      ctx.db.select().from(accounts).get() ??
      fin.createAccount(ctx, { name: 'Conta', type: 'CHECKING', initialBalanceCents: 0 });
    const categoryId = ctx.db.select().from(categories).where(eq(categories.name, 'Mercado')).get()!.id;
    fin.createTransactions(ctx, {
      kind: 'EXPENSE',
      amountCents,
      date,
      accountId: account.id,
      categoryId,
      description,
      status: 'DONE',
    } as never);
  };

  it('responde consultando os gastos e guarda a conversa com a consulta feita', async () => {
    useClaude();
    spend('2026-10-05', 12_000);
    spend('2026-10-20', 8_000);
    const { model, seen } = scripted(
      { name: 'gastos_por_categoria', input: { de: '2026-10-01', ate: '2026-10-31', tipo: 'gastos' } },
      (result) => (result.includes('20000') ? 'Você gastou [[20000]] com Mercado em outubro.' : 'não achei')
    );
    setModelForTests(model);

    const conversation = await rpc['ai.chat.send']({ text: 'Quanto gastei com mercado em outubro?' });
    expect(conversation.title).toBe('Quanto gastei com mercado em outubro?');
    expect(conversation.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(conversation.messages[1]).toMatchObject({
      text: 'Você gastou [[20000]] com Mercado em outubro.',
      tools: ['gastos por categoria'],
    });
    expect(seen[0]!.prompt).toContain('2026-11-04');
    expect(rpc['ai.chat.list']()).toHaveLength(1);

    // A pergunta seguinte vai com o histórico.
    const next = scripted(null, () => 'Foi em duas compras.');
    setModelForTests(next.model);
    await rpc['ai.chat.send']({ conversationId: conversation.id, text: 'E em quantas compras?' });
    expect(next.seen[0]!.prompt).toContain('Quanto gastei com mercado');
  });

  it('só oferece as consultas das áreas liberadas para o modelo', async () => {
    useClaude();
    const { model, seen } = scripted(null, () => 'ok');
    setModelForTests(model);
    await rpc['ai.chat.send']({ text: 'Como dormi?' });
    expect(seen[0]!.tools).toContain('gastos_por_categoria');
    expect(seen[0]!.tools).not.toContain('saude');
    expect(seen[0]!.tools).not.toContain('diario');

    const local = rpc['ai.models.add']({ provider: 'ollama', model: 'qwen3:8b' }).added;
    const again = scripted(null, () => 'ok');
    setModelForTests(again.model);
    await rpc['ai.chat.send']({ text: 'Como dormi?', modelId: local });
    expect(again.seen[0]!.tools).toEqual(expect.arrayContaining(['saude', 'diario']));
  });

  it('módulo desligado some das consultas, até para o modelo local', async () => {
    const modules = toggles(ctx);
    modules['modules.set']({ id: 'finance', enabled: false });
    modules['modules.set']({ id: 'goals', enabled: false });
    modules['modules.set']({ id: 'reminders', enabled: false });
    expect(modules['modules.get']()).toEqual({ disabled: ['finance', 'goals', 'reminders'] });

    const local = rpc['ai.models.add']({ provider: 'ollama', model: 'qwen3:8b' }).added;
    const { model, seen } = scripted(null, () => 'ok');
    setModelForTests(model);
    await rpc['ai.chat.send']({ text: 'Oi', modelId: local });
    expect(seen[0]!.tools).toContain('tarefas');
    expect(seen[0]!.tools).not.toContain('gastos_por_categoria');
    expect(seen[0]!.tools).not.toContain('metas');
    expect(seen[0]!.tools).not.toContain('propor_lembrete');

    modules['modules.set']({ id: 'finance', enabled: true });
    expect(modules['modules.get']()).toEqual({ disabled: ['goals', 'reminders'] });
  });

  it('com o Assistente desligado, a pergunta é recusada', async () => {
    useClaude();
    toggles(ctx)['modules.set']({ id: 'assistant', enabled: false });
    await expect(rpc['ai.chat.send']({ text: 'Oi' })).rejects.toThrow('O Assistente está desligado');
    expect(ctx.db.select().from(aiConversations).all()).toHaveLength(0);
  });

  it('área desligada no meio não roda a consulta', async () => {
    useClaude();
    spend('2026-10-05', 12_000);
    const { model } = scripted(
      { name: 'lancamentos', input: { de: '2026-10-01', ate: '2026-10-31' } },
      (result) => (result.includes('desligada') ? 'Finanças está desligada.' : 'vi os lançamentos')
    );
    setModelForTests(
      new MockLanguageModelV4({
        doGenerate: async (options) => {
          // Entre o pedido e a consulta, a pessoa desliga Finanças.
          if (!options.prompt.some((m) => m.role === 'tool')) rpc['ai.update']({ areas: { finance: false } });
          return model.doGenerate(options);
        },
      })
    );
    const conversation = await rpc['ai.chat.send']({ text: 'Lançamentos de outubro?' });
    expect(conversation.messages[1]!.text).toBe('Finanças está desligada.');
  });

  it('CPF que aparece num lançamento não chega ao modelo', async () => {
    useClaude();
    spend('2026-10-05', 5_000, 'PIX 123.456.789-09 FULANO');
    const { model, seen } = scripted({ name: 'lancamentos', input: { de: '2026-10-01', ate: '2026-10-31' } }, () => 'ok');
    setModelForTests(model);
    await rpc['ai.chat.send']({ text: 'Pix de outubro?' });
    expect(seen[1]!.prompt).toContain('[CPF]');
    expect(seen[1]!.prompt).not.toContain('123.456.789-09');
  });

  it('apagar some com a conversa; parada há 30 dias some sozinha', async () => {
    useClaude();
    setModelForTests(scripted(null, () => 'ok').model);
    const first = await rpc['ai.chat.send']({ text: 'Oi' });
    rpc['ai.chat.delete']({ id: first.id });
    expect(rpc['ai.chat.list']()).toEqual([]);

    await rpc['ai.chat.send']({ text: 'Oi de novo' });
    expect(purgeOld(ctx, Date.now() + 31 * 24 * 60 * 60 * 1000)).toBe(1);
    expect(ctx.db.select().from(aiConversations).all()).toEqual([]);
    expect(ctx.db.select().from(aiMessages).all()).toEqual([]);
  });

  /** Roda uma consulta pelo modelo de mentira e devolve o que ela devolveu ao modelo. */
  const runTool = async (name: string, input: object, modelId?: string) => {
    let seen = '';
    setModelForTests(scripted({ name, input }, (result) => ((seen = result), 'ok')).model);
    await rpc['ai.chat.send']({ text: 'pergunta', modelId });
    return seen;
  };

  it('agenda de um dia só traz o evento do dia, na hora local', async () => {
    useClaude();
    createEvent(ctx, {
      title: 'Dentista',
      startAt: '2026-11-04T13:00:00.000Z',
      endAt: '2026-11-04T14:00:00.000Z',
    });
    const result = await runTool('eventos', { de: '2026-11-04', ate: '2026-11-04' });
    expect(result).toContain('Dentista');
    expect(result).toContain('2026-11-04 às 10:00');
  });

  it('orçamento com fração não quebra a consulta', async () => {
    useClaude();
    spend('2026-11-02', 10_000);
    const market = ctx.db.select().from(categories).where(eq(categories.name, 'Mercado')).get()!.id;
    upsertBudget(ctx, { categoryId: market, month: '2026-11', limitCents: 30_000 });
    const result = await runTool('orcamentos', { mes: '2026-11' });
    expect(result).toContain('Mercado');
    expect(result).not.toContain('CARTÃO');
    expect(result).not.toContain('erro');
  });

  it('meta de saldo não sai com Finanças desligada', async () => {
    useClaude();
    createGoal(ctx, {
      title: 'Reserva',
      area: 'FINANCAS',
      target: 1_000_000,
      unit: 'R$',
      color: 'green',
      source: 'MANUAL',
      manualValue: 250_000,
    } as never);
    expect(await runTool('metas', {})).toContain('alvoCentavos');
    rpc['ai.update']({ areas: { finance: false } });
    const hidden = await runTool('metas', {});
    expect(hidden).not.toContain('Reserva');
  });

  it('resposta do modelo local com dado de saúde não vai no histórico para a nuvem', async () => {
    const claude = useClaude();
    const local = rpc['ai.models.add']({ provider: 'ollama', model: 'qwen3:8b' }).added;
    ctx.db.run(
      sql`INSERT INTO health_days (id, created_at, updated_at, date, mood, water_ml)
          VALUES ('h1', 0, 0, '2026-11-03', 2, 0)`
    );
    setModelForTests(
      scripted({ name: 'saude', input: { de: '2026-11-03', ate: '2026-11-03' } }, () => 'Seu humor foi 2 ontem.').model
    );
    const first = await rpc['ai.chat.send']({ text: 'Como estava meu humor?', modelId: local });
    const cloud = scripted(null, () => 'ok');
    setModelForTests(cloud.model);
    await rpc['ai.chat.send']({ conversationId: first.id, text: 'E hoje?', modelId: claude });
    expect(cloud.seen[0]!.prompt).not.toContain('humor foi 2');
    expect(cloud.seen[0]!.prompt).toContain('Como estava meu humor?');
  });

  it('falha do provedor não deixa pergunta nem conversa órfã', async () => {
    useClaude();
    setModelForTests(
      new MockLanguageModelV4({
        doGenerate: async () => {
          throw new Error('fora do ar');
        },
      })
    );
    await expect(rpc['ai.chat.send']({ text: 'Oi' })).rejects.toThrow();
    expect(rpc['ai.chat.list']()).toEqual([]);
  });

  it('a foto vai ao modelo, a miniatura fica e a foto não volta no histórico', async () => {
    useClaude();
    const first = scripted(null, () => 'Vi a nota.');
    setModelForTests(first.model);
    const photo = { data: 'aGVsbG8=', mediaType: 'image/jpeg' as const, thumb: 'data:image/jpeg;base64,aGk=' };
    const conversation = await rpc['ai.chat.send']({ text: '', images: [photo] });
    expect(conversation.title).toBe('Foto');
    expect(conversation.messages[0]).toMatchObject({ text: '', images: [photo.thumb], source: 'text' });
    expect(first.seen[0]!.prompt).toContain('aGVsbG8=');

    const next = scripted(null, () => 'Ok.');
    setModelForTests(next.model);
    await rpc['ai.chat.send']({ conversationId: conversation.id, text: 'e o total?', source: 'voice' });
    expect(next.seen[0]!.prompt).not.toContain('aGVsbG8=');
    expect(next.seen[0]!.prompt).toContain('mandou uma foto');
    const saved = rpc['ai.chat.get']({ id: conversation.id });
    expect(saved.messages[2]!.source).toBe('voice');
  });

  it('modelo que não lê foto dá um aviso claro', async () => {
    useClaude();
    setModelForTests(
      new MockLanguageModelV4({
        doGenerate: async () => {
          throw new APICallError({
            message: 'image input is not supported',
            url: 'x',
            requestBodyValues: {},
            statusCode: 400,
            isRetryable: false,
          });
        },
      })
    );
    await expect(
      rpc['ai.chat.send']({
        text: 'olha',
        images: [{ data: 'aGVsbG8=', mediaType: 'image/png', thumb: 'data:image/png;base64,aGk=' }],
      })
    ).rejects.toThrow(/não lê foto/);
    expect(rpc['ai.chat.list']()).toHaveLength(0);
  });

  it('pergunta vazia é recusada', async () => {
    useClaude();
    expect(() => rpc['ai.chat.send']({ text: '   ' })).toThrow(/Escreva/);
  });
});
