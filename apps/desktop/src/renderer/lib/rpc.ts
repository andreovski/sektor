import type { Rpc, RpcResult } from '@sektor/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

// Canal com o núcleo. A porta chega do preload; o que for pedido antes espera por ela.
let port: MessagePort | null = null;
let nextId = 1;
const waiting = new Map<number, (result: RpcResult) => void>();
const queue: (() => void)[] = [];

window.addEventListener('message', (event) => {
  if (event.data !== 'core-port' || !event.ports[0]) return;
  port = event.ports[0];
  port.onmessage = (reply) => {
    const { id, result } = reply.data as { id: number; result: RpcResult };
    waiting.get(id)?.(result);
    waiting.delete(id);
  };
  for (const run of queue.splice(0)) run();
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
    const id = nextId++;
    waiting.set(id, (result) => {
      if (result.ok) resolve(result.value as Output<M>);
      else reject(new RpcError(result.status, result.message));
    });
    const send = () => port!.postMessage({ id, method, input });
    if (port) send();
    else queue.push(send);
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
