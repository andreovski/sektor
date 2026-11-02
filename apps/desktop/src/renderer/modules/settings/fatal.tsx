import { AlertTriangle } from 'lucide-react';

import type { CoreFailure } from '../../../preload/api';
import { Button, Card } from '../../ui';

import { useRestore } from './restore';

const TITLES: Record<CoreFailure['kind'], string> = {
  vault: 'O cofre do sistema não respondeu',
  database: 'O Sektor não conseguiu abrir seus dados',
  core: 'O núcleo do Sektor parou',
};

/** No lugar do app quando não há núcleo. Nada aqui apaga dados. */
export function FatalScreen({ failure }: { failure: CoreFailure }) {
  const restore = useRestore();
  return (
    <div className="flex h-full items-center justify-center p-8">
      <Card className="flex w-[560px] max-w-full flex-col gap-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="text-danger" size={22} />
          <h1 className="text-lg font-semibold">{TITLES[failure.kind]}</h1>
        </div>
        <div className="text-sm">
          <p className="text-muted">Causa</p>
          <p className="break-words">{failure.message}</p>
        </div>
        <div className="text-sm">
          <p className="text-muted">Pasta de dados</p>
          <p className="break-all">{failure.dataDir}</p>
        </div>
        <p className="text-sm text-muted">
          Nada foi apagado. Se a chave ou o banco se perderam, restaure um backup com a senha de
          recuperação.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void window.sektor.relaunch()}>
            Tentar de novo
          </Button>
          <Button onClick={() => void restore.pick()}>Restaurar um backup</Button>
          <Button onClick={() => void window.sektor.openDataDir()}>Abrir a pasta</Button>
        </div>
      </Card>
      {restore.dialog}
    </div>
  );
}
