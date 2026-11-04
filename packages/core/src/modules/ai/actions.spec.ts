import { MockLanguageModelV4 } from 'ai/test';
import { and, eq, isNull } from 'drizzle-orm';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type App, createApp } from '../../app';
import { categories, transactions } from '../../db/schema';
import { tasks } from '../tasks/schema';

import { setJevForTests } from './jev';
import { setModelForTests } from './providers';
import { aiProposals } from './schema';

// Quarta, 04/11/2026, 12h em São Paulo.
const NOW = new Date('2026-11-04T15:00:00Z');
const usage = {
  inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
};

/** Modelo de mentira: chama `call` no primeiro passo e responde no segundo. */
function scripted(call: { name: string; input: object } | null, answer = 'Confira e salve.') {
  const tools: string[][] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      tools.push((options.tools ?? []).map((t) => t.name));
      const answered = options.prompt.some((m) => m.role === 'tool');
      if (call && !answered) {
        return {
          content: [{ type: 'tool-call', toolCallId: 't1', toolName: call.name, input: JSON.stringify(call.input) }],
          finishReason: { unified: 'tool-calls', raw: undefined },
          usage,
          warnings: [],
        };
      }
      return { content: [{ type: 'text', text: answer }], finishReason: { unified: 'stop', raw: undefined }, usage, warnings: [] };
    },
  });
  return { model, tools };
}

/** Jev de mentira: responde a pergunta de tipo com `kind` e, nas outras, escolhe pelo rótulo. */
function fakeJev(kind: string, kindScore: number, pick: (label: string) => boolean, score = 0.93) {
  setJevForTests(async (_key, _state, questions) => {
    const { criteria, instructions } = questions.answer!;
    if (instructions.startsWith('The user wrote this request')) {
      const key = Object.entries(criteria).find(([, label]) => label.toLowerCase().startsWith(kind))![0];
      return { answers: { answer: { type: 'choice', choice: key, probabilities: { [key]: kindScore } } } };
    }
    const found = Object.entries(criteria).find(([, label]) => pick(label));
    const key = found ? found[0] : 'nenhuma';
    return { answers: { answer: { type: 'choice', choice: key, probabilities: { [key]: score } } } };
  });
}

describe('ações do assistente', () => {
  let dir: string;
  let app: App;
  const secrets = new Map<string, string>();

  const value = async <T = any>(method: string, input?: unknown): Promise<T> => {
    const result = await app.call(method, input);
    if (!result.ok) throw new Error(result.message);
    return result.value as T;
  };

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    dir = mkdtempSync(join(tmpdir(), 'sektor-actions-'));
    secrets.clear();
    app = createApp({
      dbPath: join(dir, 'a.db'),
      keyHex: 'f'.repeat(64),
      timeZone: 'America/Sao_Paulo',
      secrets: {
        get: (name) => secrets.get(name) ?? null,
        set: (name, v) => (v === null ? secrets.delete(name) : secrets.set(name, v)),
      },
      notify: () => {},
    });
    await value('ai.setKey', { provider: 'anthropic', key: 'sk' });
    await value('ai.acceptNotice', { provider: 'anthropic' });
    await value('ai.models.add', { provider: 'anthropic', model: 'claude-haiku-5-5' });
  });

  afterEach(() => {
    setModelForTests(null);
    setJevForTests(null);
    vi.useRealTimers();
    app.handle.raw.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const ask = async (call: { name: string; input: object }) => {
    const script = scripted(call);
    setModelForTests(script.model);
    const conversation = await value('ai.chat.send', { text: 'pedido' });
    return { conversation, proposal: conversation.messages[1].proposals[0], tools: script.tools };
  };

  const openTasks = () =>
    app.handle.orm.select().from(tasks).where(isNull(tasks.deletedAt)).all();

  it('propor tarefa não grava; salvar cria, desfazer apaga', async () => {
    const { proposal } = await ask({ name: 'propor_tarefa', input: { titulo: 'Comprar queijo', prazo: '2026-11-05' } });
    expect(proposal).toMatchObject({ status: 'PENDING', card: { kind: 'Tarefa', title: 'Comprar queijo' } });
    expect(openTasks()).toHaveLength(0);

    const saved = await value('ai.proposal.apply', { id: proposal.id });
    expect(saved).toMatchObject({ status: 'APPLIED', undoable: true });
    expect(openTasks().map((t) => t.title)).toEqual(['Comprar queijo']);
    await expect(value('ai.proposal.apply', { id: proposal.id })).rejects.toThrow(/já foi resolvida/);

    await value('ai.proposal.undo', { id: proposal.id });
    expect(openTasks()).toHaveLength(0);
  });

  it('tarefa num projeto que não existe volta erro ao modelo, sem proposta', async () => {
    const { conversation } = await ask({ name: 'propor_tarefa', input: { titulo: 'X', lista: 'Projeto Fantasma' } });
    expect(conversation.messages[1].proposals).toEqual([]);
  });

  it('lançamento sem conta pede a escolha no cartão', async () => {
    const account = await value('accounts.create', { name: 'Nubank', type: 'CHECKING', initialBalanceCents: 0 });
    const { proposal } = await ask({
      name: 'propor_lancamento',
      input: { tipo: 'gasto', valorCentavos: 3200, descricao: 'Mercado' },
    });
    expect(proposal.needs).toMatchObject({ account: true, category: true });
    await expect(value('ai.proposal.apply', { id: proposal.id })).rejects.toThrow(/Escolha a conta/);
    const market = app.handle.orm.select().from(categories).where(eq(categories.name, 'Mercado')).get()!;
    await value('ai.proposal.apply', { id: proposal.id, accountId: account.id, categoryId: market.id });
    const tx = app.handle.orm.select().from(transactions).where(isNull(transactions.deletedAt)).get()!;
    expect(tx).toMatchObject({ amountCents: 3200, accountId: account.id, categoryId: market.id, date: '2026-11-04' });
  });

  it('com o Jev seguro, o lançamento novo salva sozinho e dá para desfazer', async () => {
    await value('accounts.create', { name: 'Nubank', type: 'CHECKING', initialBalanceCents: 0 });
    await value('ai.setKey', { provider: 'jev', key: 'jev' });
    await value('ai.acceptNotice', { provider: 'jev' });
    fakeJev('money spent', 0.95, (label) => label === 'Nubank' || label === 'Mercado');
    const { proposal } = await ask({
      name: 'propor_lancamento',
      input: { tipo: 'gasto', valorCentavos: 3200, descricao: 'Mercado do bairro' },
    });
    expect(proposal).toMatchObject({ status: 'APPLIED', auto: true });
    expect(app.handle.orm.select().from(transactions).where(isNull(transactions.deletedAt)).all()).toHaveLength(1);
    await value('ai.proposal.undo', { id: proposal.id });
    expect(app.handle.orm.select().from(transactions).where(isNull(transactions.deletedAt)).all()).toHaveLength(0);
  });

  it('com o Jev seguro, tarefa e evento novos também salvam sozinhos', async () => {
    await value('ai.setKey', { provider: 'jev', key: 'jev' });
    await value('ai.acceptNotice', { provider: 'jev' });
    fakeJev('something to do', 0.92, () => false);
    const task = await ask({ name: 'propor_tarefa', input: { titulo: 'Marcar exames', prazo: '2026-11-05' } });
    expect(task.proposal).toMatchObject({ status: 'APPLIED', auto: true });
    expect(openTasks().map((t) => t.title)).toEqual(['Marcar exames']);

    fakeJev('a calendar appointment', 0.9, () => false);
    const event = await ask({ name: 'propor_evento', input: { titulo: 'Dentista', dia: '2026-11-05', inicio: '10:00' } });
    expect(event.proposal).toMatchObject({ status: 'APPLIED', auto: true });
  });

  it('lançamento lido de uma foto espera a confirmação, mesmo com o Jev seguro', async () => {
    await value('accounts.create', { name: 'Nubank', type: 'CHECKING', initialBalanceCents: 0 });
    await value('ai.setKey', { provider: 'jev', key: 'jev' });
    await value('ai.acceptNotice', { provider: 'jev' });
    fakeJev('money spent', 0.99, () => true);
    const script = scripted({
      name: 'propor_lancamento',
      input: { tipo: 'gasto', valorCentavos: 4590, descricao: 'Padaria', conta: 'Nubank', categoria: 'Mercado' },
    });
    setModelForTests(script.model);
    const conversation = await value('ai.chat.send', {
      text: 'registra',
      images: [{ data: 'aGVsbG8=', mediaType: 'image/jpeg', thumb: 'data:image/jpeg;base64,aGk=' }],
    });
    expect(conversation.messages[1].proposals[0].status).toBe('PENDING');
    expect(app.handle.orm.select().from(transactions).all()).toHaveLength(0);
  });

  it('Jev em dúvida sobre o tipo: a tarefa espera a confirmação', async () => {
    await value('ai.setKey', { provider: 'jev', key: 'jev' });
    await value('ai.acceptNotice', { provider: 'jev' });
    fakeJev('something to do', 0.6, () => false);
    const { proposal } = await ask({ name: 'propor_tarefa', input: { titulo: 'Talvez' } });
    expect(proposal.status).toBe('PENDING');
    expect(openTasks()).toHaveLength(0);
  });

  it('mudar lançamento mostra o antes, grava e desfaz para o antes', async () => {
    const account = await value('accounts.create', { name: 'Nubank', type: 'CHECKING', initialBalanceCents: 0 });
    const [tx] = await value('transactions.create', {
      kind: 'EXPENSE',
      amountCents: 3000,
      date: '2026-11-03',
      accountId: account.id,
      description: 'Uber',
    });
    const { proposal } = await ask({ name: 'propor_mudar_lancamento', input: { id: tx.id, valorCentavos: 3500 } });
    expect(proposal.card.rows[0]).toMatchObject({ label: 'Valor', value: expect.stringContaining('35,00'), before: expect.stringContaining('30,00') });
    await value('ai.proposal.apply', { id: proposal.id });
    expect(app.handle.orm.select().from(transactions).where(eq(transactions.id, tx.id)).get()!.amountCents).toBe(3500);
    await value('ai.proposal.undo', { id: proposal.id });
    expect(app.handle.orm.select().from(transactions).where(eq(transactions.id, tx.id)).get()!.amountCents).toBe(3000);
  });

  it('apagar tarefa só com confirmação, e sem desfazer', async () => {
    const task = await value('tasks.create', { title: 'Velha' });
    const { proposal } = await ask({ name: 'propor_apagar', input: { tipo: 'tarefa', id: task.id } });
    expect(openTasks()).toHaveLength(1);
    const saved = await value('ai.proposal.apply', { id: proposal.id });
    expect(saved.undoable).toBe(false);
    expect(openTasks()).toHaveLength(0);
    await expect(value('ai.proposal.undo', { id: proposal.id })).rejects.toThrow(/não tem desfazer/);
  });

  it('descartar deixa tudo como estava', async () => {
    const { proposal } = await ask({ name: 'propor_tarefa', input: { titulo: 'Talvez' } });
    expect((await value('ai.proposal.discard', { id: proposal.id })).status).toBe('DISCARDED');
    expect(openTasks()).toHaveLength(0);
  });

  it('evento com hora vira o horário local; sem hora, dia inteiro', async () => {
    const { proposal } = await ask({ name: 'propor_evento', input: { titulo: 'Dentista', dia: '2026-11-05', inicio: '10:00' } });
    await value('ai.proposal.apply', { id: proposal.id });
    const list = await value<any[]>('events.list', { from: '2026-11-05', to: '2026-11-06' });
    expect(list[0]).toMatchObject({ title: 'Dentista', startAt: '2026-11-05T13:00:00.000Z', endAt: '2026-11-05T14:00:00.000Z' });
  });

  it('área desligada não oferece a ação', async () => {
    await value('ai.update', { areas: { finance: false } });
    const { tools } = await ask({ name: 'propor_tarefa', input: { titulo: 'ok' } });
    expect(tools[0]).toContain('propor_tarefa');
    expect(tools[0]).not.toContain('propor_lancamento');
  });

  it('área desligada depois de propor não deixa salvar', async () => {
    const { proposal } = await ask({ name: 'propor_tarefa', input: { titulo: 'Bloqueada' } });
    await value('ai.update', { areas: { tasks: false } });
    await expect(value('ai.proposal.apply', { id: proposal.id })).rejects.toThrow(/desligada/);
    expect(openTasks()).toHaveLength(0);
  });

  it('Jev seguro mas a resposta falha: nada fica salvo', async () => {
    await value('accounts.create', { name: 'Nubank', type: 'CHECKING', initialBalanceCents: 0 });
    await value('ai.setKey', { provider: 'jev', key: 'jev' });
    await value('ai.acceptNotice', { provider: 'jev' });
    fakeJev('money spent', 0.95, (label) => label === 'Nubank' || label === 'Mercado', 0.95);
    let step = 0;
    setModelForTests(
      new MockLanguageModelV4({
        doGenerate: async () => {
          step++;
          if (step === 1) {
            return {
              content: [{ type: 'tool-call', toolCallId: 't1', toolName: 'propor_lancamento', input: JSON.stringify({ tipo: 'gasto', valorCentavos: 900, descricao: 'Mercado' }) }],
              finishReason: { unified: 'tool-calls', raw: undefined },
              usage,
              warnings: [],
            };
          }
          throw new Error('caiu');
        },
      })
    );
    await expect(value('ai.chat.send', { text: 'gastei 9 no mercado' })).rejects.toThrow();
    expect(app.handle.orm.select().from(transactions).where(isNull(transactions.deletedAt)).all()).toHaveLength(0);
    expect(app.handle.orm.select().from(aiProposals).all()).toHaveLength(0);
  });

  it('concluir tarefa já feita é recusado; desfazer devolve a situação de antes', async () => {
    const task = await value('tasks.create', { title: 'Em andamento', status: 'IN_PROGRESS' });
    const { proposal } = await ask({ name: 'propor_concluir_tarefa', input: { id: task.id } });
    await value('ai.proposal.apply', { id: proposal.id });
    await value('ai.proposal.undo', { id: proposal.id });
    expect((await value('tasks.get', { id: task.id })).status).toBe('IN_PROGRESS');
    await value('tasks.complete', { id: task.id });
    const again = await ask({ name: 'propor_concluir_tarefa', input: { id: task.id } });
    expect(again.proposal).toBeUndefined();
  });

  it('hábito marcado na tela antes de salvar não é desmarcado', async () => {
    const habit = await value('habits.create', { name: 'Água', kind: 'CONTINUOUS', color: 'blue', frequency: 'DAILY' });
    const { proposal } = await ask({ name: 'propor_habito_feito', input: { habito: 'Água' } });
    await value('habits.toggle', { id: habit.id, date: '2026-11-04' });
    await expect(value('ai.proposal.apply', { id: proposal.id })).rejects.toThrow(/já está marcado/);
  });

  it('evento com fim antes do início é recusado', async () => {
    const { conversation } = await ask({ name: 'propor_evento', input: { titulo: 'X', dia: '2026-11-05', inicio: '10:00', fim: '09:00' } });
    expect(conversation.messages[1].proposals).toEqual([]);
  });

  it('apagar a conversa leva as propostas; o que foi salvo continua', async () => {
    const { conversation, proposal } = await ask({ name: 'propor_tarefa', input: { titulo: 'Fica' } });
    await value('ai.proposal.apply', { id: proposal.id });
    await value('ai.chat.delete', { id: conversation.id });
    expect(app.handle.orm.select().from(aiProposals).where(and(eq(aiProposals.id, proposal.id))).all()).toEqual([]);
    expect(openTasks().map((t) => t.title)).toEqual(['Fica']);
  });
});
