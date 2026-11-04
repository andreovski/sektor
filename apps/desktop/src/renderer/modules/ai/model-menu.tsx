import { Check, ChevronDown } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';

import { cn } from '../../ui';

import { type Provider, PROVIDER_INFO } from './shared';

// O nome do modelo como a pessoa lê, e uma marca de quem fez. Só letras e cor: logo de empresa
// não entra no app.

interface Maker {
  name: string;
  letter: string;
  /** Classes de cor da marca: fundo e letra. */
  tone: string;
}

const MAKERS: { match: RegExp; maker: Maker }[] = [
  { match: /claude|anthropic/i, maker: { name: 'Anthropic', letter: 'C', tone: 'bg-[#d97757]/20 text-[#e8a184]' } },
  { match: /gpt|openai|^o\d/i, maker: { name: 'OpenAI', letter: 'G', tone: 'bg-[#10a37f]/20 text-[#5fd0b0]' } },
  { match: /nemotron|nvidia/i, maker: { name: 'NVIDIA', letter: 'N', tone: 'bg-[#76b900]/20 text-[#a6d856]' } },
  { match: /gemma|gemini|google/i, maker: { name: 'Google', letter: 'G', tone: 'bg-[#4285f4]/20 text-[#8ab4f8]' } },
  { match: /qwen/i, maker: { name: 'Qwen', letter: 'Q', tone: 'bg-[#615ced]/20 text-[#a3a0f7]' } },
  { match: /llama|meta/i, maker: { name: 'Meta', letter: 'L', tone: 'bg-[#0668e1]/20 text-[#7fb2f5]' } },
  { match: /deepseek/i, maker: { name: 'DeepSeek', letter: 'D', tone: 'bg-[#4d6bfe]/20 text-[#93a6ff]' } },
  { match: /dots/i, maker: { name: 'Dots', letter: 'D', tone: 'bg-[#ff2442]/20 text-[#ff8a99]' } },
  { match: /xing|tele/i, maker: { name: 'TeleAI', letter: 'X', tone: 'bg-[#e0a030]/20 text-[#f0c070]' } },
  { match: /mistral/i, maker: { name: 'Mistral', letter: 'M', tone: 'bg-[#fa520f]/20 text-[#ff9a6a]' } },
];
const UNKNOWN: Maker = { name: '', letter: '?', tone: 'bg-hover text-muted' };

const makerOf = (model: string) => MAKERS.find((m) => m.match.test(model))?.maker ?? UNKNOWN;

const WORDS: Record<string, string> = { vl: 'VL', it: '', gpt: 'GPT', ai: 'AI' };

/** "claude-haiku-5-5" → "Claude Haiku 5.5"; "nvidia/nemotron-3.5-super-vl:free" → "Nemotron 3.5 Super VL". */
export function modelName(model: string) {
  const base = model.split('/').pop()!.replace(/:free$/, '').replace(/:latest$/, '');
  // Versão escrita com hífen entre números ("5-5") vira ponto.
  const versioned = base.replace(/(\d)-(\d)(?=$|-)/g, '$1.$2');
  // Tamanho do Ollama ("qwen3:8b") vira " 8B".
  const sized = versioned.replace(/:(\d+(?:\.\d+)?)([bm])$/i, (_, n, unit) => ` ${n}${unit.toUpperCase()}`);
  return sized
    .split(/[-_\s]+/)
    .map((word) => {
      const lower = word.toLowerCase();
      if (lower in WORDS) return WORDS[lower];
      if (/^\d+(\.\d+)?[bm]$/i.test(word)) return word.toUpperCase();
      if (/^gpt\d/i.test(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .filter(Boolean)
    .join(' ');
}

export interface MenuModel {
  id: string;
  provider: Provider;
  model: string;
  local: boolean;
  problem: string | null;
}

function Mark({ model, size = 'md' }: { model: string; size?: 'sm' | 'md' }) {
  const maker = makerOf(model);
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-[7px] font-semibold',
        size === 'sm' ? 'size-5 rounded-full text-[10px]' : 'size-7 text-[13px]',
        maker.tone
      )}
    >
      {maker.letter}
    </span>
  );
}

function Badges({ model }: { model: MenuModel }) {
  return (
    <>
      {model.local && (
        <span className="rounded-full bg-success/15 px-1.5 text-[9px] font-medium text-success">local</span>
      )}
      {model.model.endsWith(':free') && (
        <span className="rounded-full bg-info/15 px-1.5 text-[9px] font-medium text-info">grátis</span>
      )}
    </>
  );
}

/** O seletor de modelo: o nome legível, a marca de quem fez e se é local ou grátis. */
export function ModelMenu({
  models,
  value,
  onChange,
  side = 'top',
  align = 'start',
}: {
  models: MenuModel[];
  value: string | null;
  onChange(id: string): void;
  side?: 'top' | 'bottom';
  align?: 'start' | 'end';
}) {
  const current = models.find((m) => m.id === value) ?? models[0];
  if (!current) return null;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={`Modelo: ${modelName(current.model)}`}
          className="flex h-8 items-center gap-2 rounded-full border border-line bg-raised/80 py-0 pr-2.5 pl-1.5 text-[12px] text-muted transition-colors hover:bg-hover hover:text-foreground data-[state=open]:bg-hover"
        >
          <Mark model={current.model} size="sm" />
          <span className="text-foreground">{modelName(current.model)}</span>
          <Badges model={current} />
          <ChevronDown size={13} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side={side}
          align={align}
          sideOffset={8}
          className="z-50 w-80 rounded-panel border border-line bg-raised p-1.5 shadow-popover"
        >
          <DropdownMenu.Label className="px-2 pt-1 pb-1.5 font-mono text-[10px] tracking-[0.12em] text-subtle">
            MODELO DESTA CONVERSA
          </DropdownMenu.Label>
          {models.map((model) => {
            const maker = makerOf(model.model);
            return (
              <DropdownMenu.Item
                key={model.id}
                disabled={Boolean(model.problem)}
                onSelect={() => onChange(model.id)}
                className="flex cursor-pointer items-center gap-2.5 rounded-control px-2 py-1.5 outline-none data-[disabled]:cursor-default data-[disabled]:opacity-50 data-[highlighted]:bg-hover"
              >
                <Mark model={model.model} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-1.5 text-[13px] text-foreground">
                    <span className="truncate">{modelName(model.model)}</span>
                    <Badges model={model} />
                  </span>
                  <span className="truncate text-[11px] text-subtle">
                    {model.problem ??
                      [maker.name, `via ${PROVIDER_INFO[model.provider].short}`].filter(Boolean).join(' · ')}
                  </span>
                </span>
                {model.id === current.id && <Check size={14} className="text-primary" />}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
