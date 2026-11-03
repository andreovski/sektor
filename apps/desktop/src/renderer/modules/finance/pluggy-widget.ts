import { call } from '../../lib/rpc';

const CONNECT_ORIGIN = 'https://connect.pluggy.ai';

/** Abre o widget da Pluggy no conector do Meu Pluggy. Devolve o id do item, ou null se fechou. */
export async function openPluggyConnect(): Promise<string | null> {
  const [{ PluggyConnect }, token] = await Promise.all([
    import('pluggy-connect-sdk'),
    call('bank.connectToken'),
  ]);
  // O widget pede o login do banco por mensagem quando não está num navegador comum; o app abre
  // a janela e devolve a volta para ele, como o SDK faz no Cordova.
  let lastLink = { url: '', at: 0 };
  const onMessage = (event: MessageEvent) => {
    if (event.origin !== CONNECT_ORIGIN) return;
    let message: { type?: string; message?: string };
    try {
      message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
    } catch {
      void window.sektor.pluggyLog(`texto: ${String(event.data).slice(0, 40)}`);
      return;
    }
    // O Conectar do Meu Pluggy pede para abrir o site deles: vai para o navegador, e o widget
    // segue sozinho quando a autorização termina lá.
    if (message?.type === 'LINK_OPEN' && typeof message.message === 'string') {
      // Clique repetido não abre uma aba por clique.
      if (message.message === lastLink.url && Date.now() - lastLink.at < 5000) return;
      lastLink = { url: message.message, at: Date.now() };
      void window.sektor.pluggyOpenLink(message.message);
      return;
    }
    if (message?.type !== 'OAUTH_OPEN' || typeof message.message !== 'string') return;
    const source = event.source as Window | null;
    void window.sektor.pluggyOauth(message.message).then((result) => {
      if (result) source?.postMessage(result, CONNECT_ORIGIN);
    });
  };
  window.addEventListener('message', onMessage);
  const stop = () => window.removeEventListener('message', onMessage);

  return new Promise<string | null>((resolve, reject) => {
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
  }).finally(stop);
}
