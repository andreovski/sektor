import type { AppCtx } from '../../app';
import { stamp } from '../../services/context';

import { aiCalls } from './schema';
import { readKey, readSettings } from './settings';
import { redact } from './redact';
import { scrub } from './run';

// Jev (TypeSafe, System One): responde perguntas de escolha com a probabilidade de cada opção.
// Opcional, com a chave da pessoa. Sem ela, nada no Sektor depende dele.

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const MODEL = 'jev-latest';
const TIMEOUT_MS = 6000;
const RETRIES = 2;
/** Dólares por milhão de tokens de entrada (a conta do Jotta). */
const INPUT_PRICE = 0.042;

export const optionKey = (i: number) => `opcao_${i + 1}`;
export const NONE = 'nenhuma';

interface ChoiceQuestion {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
}

interface JevResponse {
  answers: Record<string, { type: string; choice?: string; probabilities?: Record<string, number> }>;
  usage?: { input_tokens?: number };
}

export type JevCall = (
  apiKey: string,
  state: Record<string, string>,
  questions: Record<string, ChoiceQuestion>
) => Promise<JevResponse>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const callJev: JevCall = async (apiKey, state, questions) => {
  const body = JSON.stringify({ model: MODEL, state, questions });
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if ((response.status === 429 || response.status === 529) && attempt < RETRIES) {
      await sleep(300 * 2 ** attempt);
      continue;
    }
    if (!response.ok) throw new Error(`Jev ${response.status}`);
    return (await response.json()) as JevResponse;
  }
};

let jev: JevCall = callJev;

/** Só nos testes. */
export function setJevForTests(call: JevCall | null) {
  jev = call ?? callJev;
}

export const hasJev = (ctx: AppCtx) => Boolean(readKey(ctx, 'jev'));

/**
 * O Jev é um serviço na nuvem como os outros: só com a chave, o aviso aceito e Finanças liberada,
 * mesmo quando o modelo principal é local.
 */
export function jevUsable(ctx: AppCtx) {
  const settings = readSettings(ctx);
  return hasJev(ctx) && settings.noticeAccepted.includes('jev') && settings.areas.finance;
}

/**
 * A probabilidade de cada opção, pelo índice. Sem a chave ou com erro, `null`: quem chama segue
 * sem a conferência.
 */
export async function askChoice(
  ctx: AppCtx,
  feature: string,
  state: Record<string, string>,
  instructions: string,
  options: string[],
  noneLabel = 'None of these options fits'
): Promise<number[] | null> {
  const apiKey = readKey(ctx, 'jev');
  if (!apiKey || !jevUsable(ctx) || options.length === 0) return null;
  state = Object.fromEntries(Object.entries(state).map(([k, v]) => [k, redact(v)]));
  const criteria: Record<string, string> = {};
  options.forEach((label, i) => {
    criteria[optionKey(i)] = label;
  });
  criteria[NONE] = noneLabel;
  const started = Date.now();
  const log = (row: Partial<typeof aiCalls.$inferInsert>) =>
    ctx.db
      .insert(aiCalls)
      .values({
        ...stamp(),
        feature,
        provider: 'jev',
        model: MODEL,
        areas: 'finance',
        durationMs: Date.now() - started,
        ok: false,
        ...row,
      })
      .run();
  try {
    const data = await jev(apiKey, state, { answer: { type: 'choice', instructions, criteria } });
    const probabilities = data.answers?.answer?.probabilities;
    const inputTokens = data.usage?.input_tokens ?? 0;
    log({ ok: true, inputTokens, outputTokens: 0, costMicros: Math.round(inputTokens * INPUT_PRICE) });
    if (!probabilities) return null;
    return options.map((_, i) => probabilities[optionKey(i)] ?? 0);
  } catch (error) {
    log({ error: scrub(error instanceof Error ? error.message : String(error)) });
    return null;
  }
}
