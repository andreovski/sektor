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

/** Os modelos que o provedor tem agora. Sem rede, as sugestões fixas. */
export async function providerModels(provider: Provider, ollamaUrl: string | null): Promise<string[]> {
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
      })(model);
    case 'ollama':
      return createOpenAICompatible({
        name: 'ollama',
        baseURL: config.baseUrl || OLLAMA_URL,
        supportsStructuredOutputs: true,
      })(model);
  }
}
