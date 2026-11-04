import {
  Bell,
  CalendarCheck,
  CalendarDays,
  CheckSquare,
  FolderKanban,
  HeartPulse,
  type LucideIcon,
  Repeat2,
  Sparkles,
  Target,
  Timer,
  Wallet,
} from 'lucide-react';

import { type ModuleId, useModules } from '../../lib/modules';
import { useRpcMutation } from '../../lib/rpc';
import { Card, cn } from '../../ui';

const MODULES: { id: ModuleId; label: string; icon: LucideIcon; hint: string }[] = [
  { id: 'tasks', label: 'Tarefas', icon: CheckSquare, hint: 'Listas, prazos e o que foi concluído.' },
  { id: 'projects', label: 'Projetos', icon: FolderKanban, hint: 'Projetos com notas e arquivos.' },
  { id: 'agenda', label: 'Agenda', icon: CalendarDays, hint: 'Eventos e calendários.' },
  { id: 'finance', label: 'Finanças', icon: Wallet, hint: 'Contas, lançamentos, faturas e orçamentos.' },
  { id: 'habits', label: 'Hábitos', icon: Repeat2, hint: 'Hábitos do dia e sequências.' },
  { id: 'goals', label: 'Metas', icon: Target, hint: 'Metas e o ritmo para chegar nelas.' },
  { id: 'health', label: 'Saúde', icon: HeartPulse, hint: 'Check-in, sono, remédios e consultas.' },
  { id: 'focus', label: 'Foco', icon: Timer, hint: 'Sessões de foco e a meta do dia.' },
  { id: 'review', label: 'Revisão', icon: CalendarCheck, hint: 'A revisão da semana e o diário.' },
  { id: 'reminders', label: 'Lembretes', icon: Bell, hint: 'Avisos na hora marcada.' },
  {
    id: 'assistant',
    label: 'Assistente',
    icon: Sparkles,
    hint: 'A conversa com a IA no Início.',
  },
];

export function ModulesSettings() {
  const { isOn } = useModules();
  const save = useRpcMutation('modules.set');
  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-col divide-y divide-line py-1">
        {MODULES.map(({ id, label, icon: Icon, hint }) => {
          const on = isOn(id);
          return (
            <label
              key={id}
              className={cn('flex items-center gap-3 py-2.5 text-sm', !on && 'text-muted')}
            >
              <Icon size={16} className="shrink-0 text-muted" />
              <span className="flex-1">
                {label}
                <span className="block text-xs text-subtle">{hint}</span>
              </span>
              <input
                type="checkbox"
                data-testid={`module-${id}`}
                checked={on}
                disabled={save.isPending}
                onChange={(event) => save.mutate({ id, enabled: event.target.checked })}
              />
            </label>
          );
        })}
      </Card>
      <p className="text-xs text-subtle">
        Desligar tira o módulo do dock, do Início e do que a IA pode ler. Nada é apagado: ao ligar de
        novo, tudo volta como estava.
      </p>
    </div>
  );
}
