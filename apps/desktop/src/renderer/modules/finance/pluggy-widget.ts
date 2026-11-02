import { call } from '../../lib/rpc';

/** Abre o widget da Pluggy no conector do Meu Pluggy. Devolve o id do item, ou null se fechou. */
export async function openPluggyConnect(): Promise<string | null> {
  const [{ PluggyConnect }, token] = await Promise.all([
    import('pluggy-connect-sdk'),
    call('bank.connectToken'),
  ]);
  return new Promise((resolve, reject) => {
    let done = false;
    const widget = new PluggyConnect({
      connectToken: token.accessToken,
      ...(token.connectorIds
        ? { connectorIds: token.connectorIds, selectedConnectorId: token.connectorIds[0] }
        : {}),
      language: 'pt',
      theme: 'dark',
      onSuccess: ({ item }) => {
        done = true;
        resolve(item.id);
      },
      onError: ({ message }) => {
        done = true;
        reject(new Error(message || 'A Pluggy não conseguiu conectar o banco.'));
      },
      onClose: () => {
        if (!done) resolve(null);
      },
    });
    widget.init().catch(reject);
  });
}
