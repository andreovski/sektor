import { useState } from 'react';

import { Button, Dialog, Field, Input } from '../../ui';

/** Escolhe o arquivo, confirma e reinicia. Serve aos Ajustes e à tela de erro. */
export function useRestore() {
  const [file, setFile] = useState<string | null>(null);
  const pick = async () => setFile(await window.sektor.pickRestoreFile());
  const dialog = file ? <RestoreDialog file={file} onClose={() => setFile(null)} /> : null;
  return { pick, dialog };
}

function RestoreDialog({ file, onClose }: { file: string; onClose(): void }) {
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    setMessage(null);
    const result = await window.sektor.restore(password || undefined);
    setBusy(false);
    if (result.status === 'needs-password') {
      setNeedsPassword(true);
      setMessage('Este backup foi feito com outra chave. Digite a senha de recuperação.');
    } else if (result.status === 'error') setMessage(result.message);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title="Restaurar backup">
      <div className="flex flex-col gap-3 text-sm">
        <p className="break-all text-muted">{file}</p>
        <p>
          Os dados de agora serão trocados pelos deste backup e o Sektor vai reiniciar. A base atual
          não é apagada: ela fica na pasta <code>antes-da-restauracao</code>, dentro da pasta de
          dados.
        </p>
        {needsPassword && (
          <Field label="Senha de recuperação">
            <Input
              value={password}
              autoFocus
              onChange={(event) => setPassword(event.target.value)}
              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
            />
          </Field>
        )}
        {message && <p className="text-danger">{message}</p>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={busy} onClick={() => void confirm()}>
            {busy ? 'Conferindo…' : 'Restaurar e reiniciar'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
