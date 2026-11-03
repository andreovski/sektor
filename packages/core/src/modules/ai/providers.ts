import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';

import type { AppCtx } from '../../app';
import { AppError } from '../../services/context';

import { type ModelConfig, needsKey, type Provider, readKey } from './settings';

export const OLLAMA_URL = 'http://localhost:11434/v1';

/** Modelos sugeridos na tela. A pessoa pode digitar outro. */
export const SUGGESTED_MODELS: Record<Provider, string[]> = {
  ollama: ['qwen3:8b', 'llama3.1:8b', 'gemma3:12b'],
  // Os do OpenRouter mudam toda semana: vêm da lista pública deles (`providerModels`).
  openrouter: [],
  anthropic: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
  openai: ['gpt-5', 'gpt-5-mini'],
};

/** Dólares por milhão de tokens (entrada, saída). Só os que conhecemos; o resto fica sem custo. */
const PRICES: Record<string, [number, number]> = {
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
  'claude-opus-5': [5, 25],
  'claude-sonnet-5': [2, 10],
  'claude-haiku-4-5': [1, 5],
};

/** Em milionésimos de dólar. Local e `:free` custam zero; modelo sem preço conhecido, `null`. */
export function costMicros(
  provider: Provider,
  model: string,
  inputTokens: number,
  outputTokens: number
): number | null {
  if (provider === 'ollama') return 0;
  if (provider === 'openrouter' && model.endsWith(':free')) return 0;
  const price = PRICES[model];
  if (!price) return null;
  return Math.round(inputTokens * price[0] + outputTokens * price[1]);
}

/**
 * Os gratuitos do OpenRouter que fazem sentido no Sektor, escolhidos pela ficha deles em 03/11/2026:
 * JSON com schema (a categoria do banco precisa), ferramentas (o assistente da 3b vai precisar),
 * imagem (recibo, na 3d) e português. Só aparecem os que ainda estão na lista ao vivo.
 */
export const RECOMMENDED: Partial<Record<Provider, { id: string; note: string }[]>> = {
  openrouter: [
    {
      id: 'nvidia/nemotron-3.5-super-vl:free',
      note: 'O mais completo: JSON, ferramentas e imagem. Bom para tudo.',
    },
    {
      id: 'google/gemma-4-31b-it:free',
      note: 'Melhor português para os resumos; o JSON é menos garantido.',
    },
    {
      id: 'dots-studio/dots-3-note-preview:free',
      note: 'JSON, ferramentas e imagem. É prévia: pode sair do ar.',
    },
    {
      id: 'xingchen-agi/xing4.0-29b-a4b:free',
      note: 'JSON e ferramentas, só texto. Alternativa quando os outros limitarem.',
    },
  ],
  anthropic: [
    { id: 'claude-haiku-5-5', note: 'Rápido e barato. Dá conta da categoria do banco e dos resumos.' },
    { id: 'claude-sonnet-5-5', note: 'Textos e ferramentas melhores, por um custo maior.' },
    { id: 'claude-opus-5-5', note: 'O mais capaz e o mais caro. Raramente precisa aqui.' },
  ],
};

export interface ProviderModels {
  models: string[];
  recommended: { id: string; note: string }[];
}

/** Os modelos que o provedor tem agora, com os recomendados primeiro. Sem rede, as sugestões fixas. */
export async function providerModels(provider: Provider, ollamaUrl: string | null): Promise<ProviderModels> {
  const models = await listModels(provider, ollamaUrl);
  const recommended = (RECOMMENDED[provider] ?? []).filter((r) => models.includes(r.id));
  const picked = new Set(recommended.map((r) => r.id));
  return { recommended, models: models.filter((id) => !picked.has(id)) };
}

async function listModels(provider: Provider, ollamaUrl: string | null): Promise<string[]> {
  try {
    if (provider === 'ollama') {
      const base = (ollamaUrl || OLLAMA_URL).replace(/\/v1\/?$/, '');
      if (!/^https?:\/\//.test(base)) return [];
      const response = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!response.ok) return [];
      const data = (await response.json()) as { models?: { name: string }[] };
      return (data.models ?? []).map((m) => m.name);
    }
    if (provider === 'openrouter') {
      // Lista pública, sem chave. Os gratuitos primeiro.
      const response = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(5000) });
      if (!response.ok) return SUGGESTED_MODELS.openrouter;
      const data = (await response.json()) as { data?: { id: string }[] };
      const ids = (data.data ?? []).map((m) => m.id);
      return [...ids.filter((id) => id.endsWith(':free')), ...ids.filter((id) => !id.endsWith(':free'))];
    }
  } catch {
    return provider === 'ollama' ? [] : SUGGESTED_MODELS[provider];
  }
  return SUGGESTED_MODELS[provider];
}

let testModel: LanguageModel | null = null;

/** Só nos testes: troca qualquer provedor por este modelo. */
export function setModelForTests(model: LanguageModel | null) {
  testModel = model;
}

export function languageModel(ctx: AppCtx, config: ModelConfig): LanguageModel {
  if (testModel) return testModel;
  const { provider, model } = config;
  const apiKey = needsKey(provider) ? readKey(ctx, provider) : null;
  if (needsKey(provider) && !apiKey) {
    throw new AppError(409, 'Falta a chave do provedor de IA em Ajustes › IA.');
  }
  switch (provider) {
    case 'anthropic':
      return createAnthropic({ apiKey: apiKey! })(model);
    case 'openai':
      return createOpenAI({ apiKey: apiKey! })(model);
    case 'openrouter':
      return createOpenAICompatible({
        name: 'openrouter',
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: apiKey!,
        supportsStructuredOutputs: true,
        // Um mesmo modelo roda em vários servidores, e nem todos aceitam o JSON com schema: pedido
        // com formato só vai para os que aceitam.
        transformRequestBody: (body) =>
          body.response_format ? { ...body, provider: { require_parameters: true } } : body,
      })(model);
    case 'ollama':
      return createOpenAICompatible({
        name: 'ollama',
        baseURL: config.baseUrl || OLLAMA_URL,
        supportsStructuredOutputs: true,
      })(model);
  }
}
