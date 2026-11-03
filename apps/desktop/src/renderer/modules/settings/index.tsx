import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import {
  CalendarSync,
  Landmark,
  DatabaseBackup,
  Info,
  type LucideIcon,
  Palette,
  Settings,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { type ComponentType, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useRpc, useRpcMutation } from '../../lib/rpc';
import {
  Button,
  Card,
  cn,
  Dialog,
  Field,
  Input,
  PageHeader,
  SectionLabel,
  Select,
} from '../../ui';

import { AiSettings } from '../ai/settings';
import { BanksPanel } from '../finance/banks';
import { Appearance } from './appearance';
import { GoogleSettings } from './google';
import { useRestore } from './restore';

const size = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;

const when = (at: number) =>
  new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(at);

function Profile() {
  const settings = useRpc('settings.get');
  const save = useRpcMutation('settings.set');
  const zones = useMemo(() => Intl.supportedValuesOf('timeZone'), []);
  const [name, setName] = useState('');
  const [timeZone, setTimeZone] = useState('');
  useEffect(() => {
    if (!settings.data) return;
    setName(settings.data.name);
    setTimeZone(settings.data.timeZone);
  }, [settings.data]);

  return (
    <Card className="flex flex-col gap-3">
      <Field label="Seu nome, para a saudação do Início">
        <Input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field label="Fuso horário">
        <Select value={timeZone} onChange={(event) => setTimeZone(event.target.value)}>
          <option value="">Do sistema ({settings.data?.systemTimeZone})</option>
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </Select>
      </Field>
      <div>
        <Button
          variant="primary"
          disabled={save.isPending}
          onClick={() =>
            save.mutate({ name, timeZone }, { onSuccess: () => toast.success('Ajustes salvos.') })
          }
        >
          Salvar
        </Button>
      </div>
    </Card>
  );
}

function RecoveryDialog({ password, onClose }: { password: string; onClose(): void }) {
  const [saved, setSaved] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && saved && onClose()}
      title="Senha de recuperação"
    >
      <div className="flex flex-col gap-3 text-sm">
        <p>
          Guarde esta senha fora deste computador. Ela só aparece agora. Sem ela, um backup não abre
          em outra máquina nem depois de perder o chaveiro.
        </p>
        <code
          data-testid="recovery-password"
          className="rounded-panel bg-sunken p-3 text-center text-base select-all"
        >
          {password}
        </code>
        <div className="flex justify-end gap-2">
          <Button
            onClick={() =>
              void navigator.clipboard.writeText(password).then(() => toast.success('Senha copiada.'))
            }
          >
            Copiar
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setSaved(true);
              onClose();
            }}
          >
            Já guardei
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function Backup() {
  const client = useQueryClient();
  const status = useRpc('backup.status');
  const runNow = useRpcMutation('backup.run');
  const renew = useRpcMutation('backup.newRecovery');
  const restore = useRestore();
  const [password, setPassword] = useState<string | null>(null);
  const data = status.data;

  const pickFolder = async () => {
    try {
      const choice = await window.sektor.pickBackupFolder();
      if (choice.canceled) return;
      setPassword(choice.recoveryPassword);
      await client.invalidateQueries();
      toast.success('Pasta de backup definida.');
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  return (
    <Card className="flex flex-col gap-3 text-sm">
      <div>
        <p className="text-muted">Pasta de backup</p>
        <p data-testid="backup-folder" className="break-all">
          {data?.folder ?? 'Nenhuma. Sem pasta, não há backup automático.'}
        </p>
      </div>
      <p className="text-muted">
        Um backup por dia, cifrado, enquanto o app estiver aberto ou na bandeja. Ficam os 7 últimos dias
        e 4 semanas. O que você faz à mão não entra nessa conta. Os arquivos de projeto vão junto, e
        a mesma senha de recuperação vale para eles.
      </p>
      {data?.lastAt && (
        <p>
          Último backup: {when(data.lastAt)} ({data.lastFile})
        </p>
      )}
      {data?.error && <p className="text-danger">Falhou: {data.error}</p>}
      {!!data?.files.length && (
        <p className="text-muted">
          {data.files.length} arquivo(s) na pasta,{' '}
          {size(data.files.reduce((sum, file) => sum + file.bytes, 0))}.
        </p>
      )}
      {!!data?.projectFiles && (
        <p className="text-muted" data-testid="backup-project-files">
          {data.projectFiles} arquivo(s) de projeto no backup.
        </p>
      )}
      {!!data?.projectFilesAbsent && (
        <p className="text-danger">
          {data.projectFilesAbsent} arquivo(s) de projeto não estão neste computador e ficaram de
          fora do backup.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => void pickFolder()}>
          Escolher pasta
        </Button>
        <Button
          disabled={!data?.folder || runNow.isPending}
          onClick={() =>
            runNow.mutate(undefined, { onSuccess: () => toast.success('Backup feito.') })
          }
        >
          {runNow.isPending ? 'Fazendo…' : 'Fazer backup agora'}
        </Button>
        <Button
          disabled={!data?.folder || renew.isPending}
          onClick={() =>
            renew.mutate(undefined, {
              onSuccess: ({ recoveryPassword }) => setPassword(recoveryPassword),
            })
          }
        >
          Nova senha de recuperação
        </Button>
        <Button onClick={() => void restore.pick()}>Restaurar de um arquivo</Button>
      </div>
      {password && <RecoveryDialog password={password} onClose={() => setPassword(null)} />}
      {restore.dialog}
    </Card>
  );
}

function About() {
  const info = useQuery({ queryKey: ['app-info'], queryFn: () => window.sektor.info() });
  return (
    <Card className="flex flex-col gap-3 text-sm">
      <div>
        <p className="text-muted">Pasta de dados</p>
        <p data-testid="data-dir" className="break-all">
          {info.data?.dataDir}
        </p>
      </div>
      <div>
        <p className="text-muted">Versão</p>
        <p>{info.data?.version}</p>
      </div>
      <div>
        <Button onClick={() => void window.sektor.openDataDir()}>Abrir a pasta</Button>
      </div>
    </Card>
  );
}

const GROUPS: {
  label: string;
  items: {
    value: string;
    label: string;
    icon: LucideIcon;
    description: string;
    panel: ComponentType;
  }[];
}[] = [
  {
    label: 'Conta',
    items: [
      {
        value: 'perfil',
        label: 'Perfil',
        icon: UserRound,
        description: 'Como o app chama você e em que horário ele trabalha.',
        panel: Profile,
      },
      {
        value: 'aparencia',
        label: 'Aparência',
        icon: Palette,
        description: 'Modo claro, escuro ou o do sistema, e a paleta de cores.',
        panel: Appearance,
      },
    ],
  },
  {
    label: 'Integrações',
    items: [
      {
        value: 'google',
        label: 'Google',
        icon: CalendarSync,
        description: 'Seus calendários e tarefas do Google aqui dentro.',
        panel: GoogleSettings,
      },
      {
        value: 'bancos',
        label: 'Bancos',
        icon: Landmark,
        description: 'A sua chave do Meu Pluggy, os bancos conectados e em que conta cada um entra.',
        panel: BanksPanel,
      },
      {
        value: 'ia',
        label: 'IA',
        icon: Sparkles,
        description: 'Um modelo à sua escolha, local ou com a sua chave, e o que ele pode ler.',
        panel: AiSettings,
      },
    ],
  },
  {
    label: 'Dados',
    items: [
      {
        value: 'backup',
        label: 'Backup',
        icon: DatabaseBackup,
        description: 'Cópias cifradas automáticas e restauração.',
        panel: Backup,
      },
    ],
  },
  {
    label: 'Sistema',
    items: [
      {
        value: 'sobre',
        label: 'Sobre',
        icon: Info,
        description: 'Onde seus dados ficam e a versão do app.',
        panel: About,
      },
    ],
  },
];

function SettingsPage() {
  const { secao } = useSearch({ strict: false }) as { secao?: string };
  const navigate = useNavigate();
  const items = GROUPS.flatMap((group) => group.items);
  const current = items.find((item) => item.value === secao) ?? items[0]!;
  const Panel = current.panel;

  return (
    <div>
      <PageHeader icon={Settings} title="Ajustes" />
      <div className="grid grid-cols-[200px_minmax(0,640px)] items-start gap-10">
        <aside aria-label="Seções dos ajustes" className="sticky top-8 flex flex-col gap-5">
          {GROUPS.map((group) => (
            <nav key={group.label} aria-label={group.label}>
              <SectionLabel>{group.label}</SectionLabel>
              <div className="flex flex-col gap-0.5">
                {group.items.map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    aria-current={value === current.value ? 'page' : undefined}
                    onClick={() =>
                      void navigate({ to: '/ajustes', search: { secao: value } as never, replace: true })
                    }
                    className={cn(
                      'flex h-8 items-center gap-2 rounded-control px-2 text-left text-sm transition-colors',
                      value === current.value
                        ? 'bg-active text-foreground'
                        : 'text-muted hover:bg-hover hover:text-foreground'
                    )}
                  >
                    <Icon size={15} />
                    {label}
                  </button>
                ))}
              </div>
            </nav>
          ))}
        </aside>
        <section key={current.value} aria-label={current.label} className="tab-panel">
          <h2 className="text-lg font-semibold">{current.label}</h2>
          <p className="mb-4 text-sm text-muted">{current.description}</p>
          <Panel />
        </section>
      </div>
    </div>
  );
}

export const routes = [{ path: '/ajustes', component: SettingsPage }];
