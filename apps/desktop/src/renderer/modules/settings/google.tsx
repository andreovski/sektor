import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import type { GoogleLoginResult } from '../../../preload/api';
import { type Method, useRpc, useRpcMutation } from '../../lib/rpc';
import { Button, Card, cn, Select } from '../../ui';
import { TonePicker } from '../agenda/calendars-dialog';
import { toneVar } from '../agenda/shared';

const when = (at: string) =>
  new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(at));

const LOGIN_MESSAGES: Partial<Record<GoogleLoginResult['status'], string>> = {
  denied: 'Entrada cancelada no Google.',
  timeout: 'O tempo acabou. Tente de novo.',
  'not-configured': 'O Google não está configurado neste build.',
};

/** Espera o navegador; a volta traz a conta já sincronizada. */
function useGoogleLogin() {
  const client = useQueryClient();
  const [waiting, setWaiting] = useState(false);
  const start = async (hint?: string) => {
    setWaiting(true);
    try {
      const result = await window.sektor.googleLogin(hint);
      if (result.status === 'ok') toast.success(`${result.email} conectada.`);
      else if (result.status === 'error') toast.error(result.message);
      else if (LOGIN_MESSAGES[result.status]) toast.error(LOGIN_MESSAGES[result.status]);
      await client.invalidateQueries();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setWaiting(false);
    }
  };
  return { waiting, start, cancel: () => void window.sektor.googleCancelLogin() };
}

/** O job roda no núcleo: a tela nota que ele terminou e relê o que estiver aberta. */
export function useGoogleRefresh() {
  const client = useQueryClient();
  const status = useRpc('google.status');
  const stamp = status.data?.accounts.map((account) => account.lastSyncAt).join();
  const seen = useRef(stamp);
  useEffect(() => {
    if (stamp !== undefined && seen.current !== undefined && stamp !== seen.current) {
      void client.invalidateQueries();
    }
    seen.current = stamp;
  }, [stamp, client]);
  useEffect(() => {
    const timer = setInterval(() => void client.invalidateQueries({ queryKey: ['google.status'] }), 60_000);
    return () => clearInterval(timer);
  }, [client]);
  return status.data;
}

type Status = NonNullable<ReturnType<typeof useRpc<'google.status'>>['data']>;
type Account = Status['accounts'][number];
type Calendar = Status['calendars'][number];

function CalendarLine({ calendar, repeatedIn }: { calendar: Calendar; repeatedIn?: string }) {
  const select = useRpcMutation('google.setCalendarSelected');
  const update = useRpcMutation('calendars.update');
  const setDefault = useRpcMutation('calendars.setDefault');
  return (
    <li className="flex flex-col gap-1 py-1.5">
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={calendar.selected}
          disabled={select.isPending}
          aria-label={`Sincronizar ${calendar.name}`}
          style={{ accentColor: toneVar(calendar.color) }}
          onChange={(event) => select.mutate({ id: calendar.id, selected: event.target.checked })}
        />
        <span className="min-w-0 flex-1 truncate text-sm">
          {calendar.name}
          {calendar.readOnly && <span className="text-muted"> · só leitura</span>}
          {repeatedIn && <span className="text-muted"> · também em {repeatedIn}</span>}
        </span>
        {calendar.isDefault ? (
          <span className="text-xs text-muted">Padrão</span>
        ) : (
          !calendar.readOnly && (
            <Button size="sm" variant="ghost" onClick={() => setDefault.mutate({ id: calendar.id })}>
              Usar como padrão
            </Button>
          )
        )}
      </div>
      <div className="pl-6">
        <TonePicker
          value={calendar.color}
          onChange={(color) => update.mutate({ id: calendar.id, color })}
        />
      </div>
      {calendar.lastError && <p className="pl-6 text-xs text-warning">{calendar.lastError}</p>}
    </li>
  );
}

function AccountCard({ account, status }: { account: Account; status: Status }) {
  const login = useGoogleLogin();
  const sync = useRpcMutation('google.sync');
  const disconnect = useRpcMutation('google.disconnect');
  const [confirming, setConfirming] = useState(false);
  const mine = status.calendars.filter((calendar) => calendar.accountId === account.id);
  const emailOf = (id: string) => {
    const owner = status.calendars.find((calendar) => calendar.id === id)?.accountId;
    return status.accounts.find((other) => other.id === owner)?.email;
  };

  return (
    <Card className="flex flex-col gap-2 text-sm" aria-label={account.email}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{account.email}</p>
          <p className="text-xs text-muted">
            {account.lastSyncAt ? `Sincronizada ${when(account.lastSyncAt)}` : 'Ainda não sincronizada'}
          </p>
        </div>
        {!account.needsReconnect && (
          <Button
            size="sm"
            disabled={sync.isPending}
            onClick={() => sync.mutate({ accountId: account.id })}
          >
            <RefreshCw size={13} className={cn(sync.isPending && 'animate-spin')} />
            Sincronizar
          </Button>
        )}
      </div>

      {account.lastError && (
        <p className="flex items-start gap-1.5 text-xs text-warning">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          {account.lastError}
        </p>
      )}
      {account.needsReconnect && (
        <div className="flex gap-2">
          {login.waiting ? (
            <Button onClick={login.cancel}>Cancelar</Button>
          ) : (
            <Button variant="primary" onClick={() => void login.start(account.email)}>
              Entrar de novo
            </Button>
          )}
        </div>
      )}

      {mine.length > 0 && (
        <ul className="divide-y divide-line">
          {mine.map((calendar) => (
            <CalendarLine
              key={calendar.id}
              calendar={calendar}
              repeatedIn={calendar.alsoIn[0] && emailOf(calendar.alsoIn[0])}
            />
          ))}
        </ul>
      )}

      {confirming ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted">
            Os calendários desta conta saem do Sektor, com os eventos que vieram deles e o que ainda
            não subiu. Nada é apagado no Google, e seus calendários locais ficam como estão.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Voltar
            </Button>
            <Button
              variant="danger"
              disabled={disconnect.isPending}
              onClick={() => disconnect.mutate({ id: account.id })}
            >
              Desconectar
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
            Desconectar
          </Button>
        </div>
      )}
    </Card>
  );
}

function TasksAccount({ status }: { status: Status }) {
  const set = useRpcMutation('google.setTasksAccount');
  return (
    <Card className="flex flex-col gap-2 text-sm">
      <label className="flex flex-col gap-1">
        <span className="text-muted">Conta do Google Tarefas</span>
        <Select
          value={status.tasksAccountId ?? ''}
          disabled={set.isPending}
          onChange={(event) => set.mutate({ accountId: event.target.value || null })}
        >
          <option value="">Nenhuma: as tarefas ficam só no Sektor</option>
          {status.accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.email}
            </option>
          ))}
        </Select>
      </label>
      <p className="text-xs text-muted">
        Uma conta por vez. Prazo com hora, repetição e prioridade ficam só aqui: o Google guarda o dia.
      </p>
      {status.tasksSyncedAt && (
        <p className="text-xs text-muted">Sincronizadas {when(status.tasksSyncedAt)}</p>
      )}
    </Card>
  );
}

export function GoogleSettings() {
  const status = useRpc('google.status');
  const login = useGoogleLogin();
  const sync = useRpcMutation('google.sync' satisfies Method);
  useGoogleRefresh();
  const data = status.data;
  if (!data) return <Card className="text-sm text-muted">Carregando…</Card>;
  if (!data.configured) {
    return <Card className="text-sm text-muted">O Google não está configurado neste build.</Card>;
  }

  return (
    <div className="flex flex-col gap-3">
      {data.accounts.map((account) => (
        <AccountCard key={account.id} account={account} status={data} />
      ))}
      {data.accounts.length > 0 && <TasksAccount status={data} />}
      <Card className="flex flex-col gap-2 text-sm">
        {!data.accounts.length && (
          <p className="text-muted">
            Conecte uma conta para ver e editar seus calendários e tarefas do Google aqui. A entrada
            acontece no seu navegador; a chave fica no cofre do sistema.
          </p>
        )}
        {data.pending > 0 && (
          <p className="text-xs text-muted">{data.pending} mudança(s) esperando subir.</p>
        )}
        {login.waiting && (
          <p className="text-xs text-muted">Continue no navegador. Esperando o Google responder…</p>
        )}
        <div className="flex flex-wrap gap-2">
          {login.waiting ? (
            <Button onClick={login.cancel}>Cancelar</Button>
          ) : (
            <Button variant="primary" onClick={() => void login.start()}>
              Conectar conta Google
            </Button>
          )}
          {data.accounts.length > 1 && (
            <Button disabled={sync.isPending} onClick={() => sync.mutate(undefined)}>
              Sincronizar tudo
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
