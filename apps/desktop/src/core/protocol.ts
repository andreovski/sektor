/** Mensagens do main para o núcleo. A chave do banco nunca vai por argumento ou ambiente. */
export type CoreInit = { type: 'init'; dbPath: string; keyHex: string };
export type CoreSmoke = { type: 'smoke'; wrongKeyHex: string };
export type CoreCommand = CoreInit | CoreSmoke | { type: 'port' };

export type CoreEvent =
  | { type: 'ready' }
  | { type: 'failed'; message: string }
  | { type: 'smoke-result'; wrote: string; read: string | null; wrongKeyRefused: boolean };

export type RpcRequest = { id: number; method: 'status' };
export type RpcResponse = { id: number; result: { dbVersion: number; opens: number } };
