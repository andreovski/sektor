import type { Rpc, RpcResult } from '@sektor/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { toast } from 'sonner';

import type { CoreFailure } from '../../preload/api';

// Canal com o núcleo. A porta chega do preload; o que for pedido antes espera por ela.
let port: MessagePort | null = null;
let nextId = 1;
let failure: CoreFailure | null = null;
type Pending = { settle(result: RpcResult): void; send(): void };
const waiting = new Map<number, Pending>();
const failureListeners = new Set<() => void>();

const failureMessage = (cause: CoreFailure) =>
  `O núcleo do Sektor parou: ${cause.message} Esta chamada não foi concluída.`;

function onCoreFailure(cause: CoreFailure) {
  failure = cause;
  port = null;
  // Sem isso, tudo que estava pedido ficaria carregando para sempre.
  for (const { settle } of waiting.values()) {
    settle({ ok: false, status: 503, message: failureMessage(cause) });
  }
  waiting.clear();
  for (const listener of failureListeners) listener();
}

window.sektor.onFailure(onCoreFailure);
void window.sektor.failure().then((cause) => {
  if (cause) onCoreFailure(cause);
});

/** A falha do núcleo, para a tela de erro no lugar do app. */
export const useCoreFailure = () =>
  useSyncExternalStore(
    (listener) => {
      failureListeners.add(listener);
      return () => failureListeners.delete(listener);
    },
    () => failure
  );

window.addEventListener('message', (event) => {
  if (event.source !== window || event.data !== 'core-port' || !event.ports[0] || failure) return;
  port = event.ports[0];
  port.onmessage = (reply) => {
    const { id, result } = reply.data as { id: number; result: RpcResult };
    waiting.get(id)?.settle(result);
    waiting.delete(id);
  };
  for (const { send } of waiting.values()) send();
});

export class RpcError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export type Method = keyof Rpc;
type Input<M extends Method> = Parameters<Rpc[M]> extends [] ? undefined : Parameters<Rpc[M]>[0];
type Output<M extends Method> = Awaited<ReturnType<Rpc[M]>>;

export function call<M extends Method>(method: M, input?: Input<M>): Promise<Output<M>> {
  return new Promise((resolve, reject) => {
    if (failure) return reject(new RpcError(503, failureMessage(failure)));
    const id = nextId++;
    const send = () => port!.postMessage({ id, method, input });
    waiting.set(id, {
      send,
      settle(result) {
        if (result.ok) resolve(result.value as Output<M>);
        else reject(new RpcError(result.status, result.message));
      },
    });
    if (port) send();
  });
}

/** Leitura. A chave é o método e a entrada; qualquer escrita invalida tudo. */
export function useRpc<M extends Method>(method: M, input?: Input<M>) {
  return useQuery({ queryKey: [method, input], queryFn: () => call(method, input) });
}

/** Escrita. Mostra o erro em toast e atualiza as telas abertas. */
export function useRpcMutation<M extends Method>(method: M) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Input<M>) => call(method, input),
    onSuccess: () => client.invalidateQueries(),
    onError: (error) => toast.error(error.message),
  });
}
