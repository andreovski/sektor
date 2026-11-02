/** Mensagens entre main e núcleo. A chave do banco nunca vai por argumento ou ambiente. */
export type CoreInit = {
  type: 'init';
  dbPath: string;
  keyHex: string;
  timeZone: string;
  secrets: Record<string, string>;
};
export type CoreSmoke = { type: 'smoke'; wrongKeyHex: string };
export type CoreCommand = CoreInit | CoreSmoke | { type: 'port' };

export type CoreEvent =
  | { type: 'ready' }
  | { type: 'failed'; message: string }
  | { type: 'secrets'; secrets: Record<string, string> }
  | { type: 'notify'; title: string; body: string }
  | { type: 'smoke-result'; wrote: string; read: string | null; wrongKeyRefused: boolean };

export type RpcRequest = { id: number; method: string; input: unknown };
export type RpcResponse = { id: number; result: import('@sektor/core').RpcResult };
