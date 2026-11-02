import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import type { RpcResponse } from '../core/protocol';

function App() {
  const [status, setStatus] = useState<RpcResponse['result'] | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const port = event.ports[0];
      if (event.data !== 'core-port' || !port) return;
      port.onmessage = (reply) => setStatus((reply.data as RpcResponse).result);
      port.postMessage({ id: 1, method: 'status' });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui', padding: 32 }}>
      <h1>Sektor</h1>
      <p>{status ? `Banco v${status.dbVersion}, aberto ${status.opens} vez(es).` : 'Abrindo…'}</p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
