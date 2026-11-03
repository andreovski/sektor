import type { ReactNode } from 'react';

import { money } from '../../lib/format';
import { Button, Dialog } from '../../ui';

export type Provider = 'ollama' | 'openrouter' | 'anthropic' | 'openai';
export type Area = 'finance' | 'tasks' | 'agenda' | 'projects' | 'habits' | 'focus' | 'health' | 'journal';

export const PROVIDER_INFO: Record<
  Provider,
  { label: string; hint: string; policy: string | null; keyUrl: string | null; warning?: string }
> = {
  ollama: {
    label: 'Ollama (no seu computador)',
    hint: 'Grátis e nada sai da máquina. Instale o Ollama e baixe um modelo antes.',
    policy: null,
    keyUrl: null,
  },
  openrouter: {
    label: 'OpenRouter',
    hint: 'Uma chave para vários modelos, inclusive os gratuitos (terminam em :free).',
    policy: 'https://openrouter.ai/privacy',
    keyUrl: 'https://openrouter.ai/settings/keys',
    warning:
      'Os modelos gratuitos podem guardar os pedidos e usá-los para treino. Confira na página de cada modelo.',
  },
  anthropic: {
    label: 'Claude (Anthropic)',
    hint: 'Pago por uso, com a sua chave.',
    policy: 'https://privacy.anthropic.com',
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  openai: {
    label: 'GPT (OpenAI)',
    hint: 'Pago por uso, com a sua chave.',
    policy: 'https://platform.openai.com/docs/guides/your-data',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
};

export const AREA_LABELS: Record<Area, string> = {
  finance: 'Finanças',
  tasks: 'Tarefas',
  agenda: 'Agenda',
  projects: 'Projetos',
  habits: 'Hábitos',
  focus: 'Foco',
  health: 'Saúde',
  journal: 'Diário (textos da Revisão)',
};

/** O modelo escreve dinheiro como `[[centavos]]`; aqui vira R$ como no resto do app. */
export function AiText({ text }: { text: string }): ReactNode {
  const parts = text.split(/(\[\[-?\d+\]\])/g);
  return parts.map((part, i) => {
    const cents = /^\[\[(-?\d+)\]\]$/.exec(part);
    return cents ? (
      <span key={i} className="font-medium tabular-nums">
        {money(Number(cents[1]))}
      </span>
    ) : (
      part
    );
  });
}

/** Antes do primeiro uso de um provedor na nuvem: o que sai e para onde. */
export function NoticeDialog({
  provider,
  areas,
  onAccept,
  onClose,
}: {
  provider: Provider;
  areas: Area[];
  onAccept(): void;
  onClose(): void;
}) {
  const info = PROVIDER_INFO[provider];
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={`Usar ${info.label}`}>
      <div className="flex flex-col gap-3 text-sm">
        <p>
          Com um modelo na nuvem, os dados que a IA usa saem deste computador e vão para o{' '}
          {info.label}, pela sua chave. O Sektor não guarda nada fora daqui.
        </p>
        <p>
          Pode sair, em resumo:{' '}
          {areas.length ? areas.map((a) => AREA_LABELS[a]).join(', ') : 'nada, até você liberar uma área'}
          . CPF, CNPJ, cartão e número de conta são apagados do texto antes de enviar.
        </p>
        {info.warning && <p className="text-warning">{info.warning}</p>}
        {info.policy && (
          <p>
            <a href={info.policy} target="_blank" rel="noreferrer" className="text-primary underline">
              Política de dados do provedor
            </a>
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Agora não</Button>
          <Button variant="primary" onClick={onAccept}>
            Entendi, usar
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
