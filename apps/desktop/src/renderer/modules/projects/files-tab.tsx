import {
  PROJECT_FILE_MAX_BYTES,
  type ProjectFileResponse,
} from '@sektor/core/src/modules/projects/contract';
import { formatBytes } from '@sektor/core/src/modules/projects/logic';
import { useQueryClient } from '@tanstack/react-query';
import { File as FileIcon, Paperclip, Trash2, Upload } from 'lucide-react';
import { type DragEvent, useState } from 'react';
import { toast } from 'sonner';

import { useRpc } from '../../lib/rpc';
import { Button, cn } from '../../ui';

import { ConfirmDialog } from './confirm-dialog';

const LIMIT = formatBytes(PROJECT_FILE_MAX_BYTES);

function report({ added, errors }: { added: number; errors: string[] }) {
  if (added) toast.success(added === 1 ? 'Arquivo anexado' : `${added} arquivos anexados`);
  for (const message of errors) toast.error(message);
}

async function sendDropped(projectId: string, file: File) {
  if (file.size > PROJECT_FILE_MAX_BYTES) {
    return { added: 0, errors: [`${file.name} passa de ${LIMIT}.`] };
  }
  try {
    return await window.sektor.addProjectFile(projectId, file.name, await file.arrayBuffer());
  } catch {
    return { added: 0, errors: [`Não deu para ler ${file.name}. Pastas não são aceitas.`] };
  }
}

function FileRow({ file, onRemove }: { file: ProjectFileResponse; onRemove(): void }) {
  const added = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(file.createdAt);
  const open = async () => {
    const error = await window.sektor.openProjectFile(file.id);
    if (error) toast.error(error);
  };
  return (
    <li className="group flex items-center gap-2.5 border-b border-line px-3 py-2 last:border-b-0 hover:bg-hover">
      <FileIcon size={15} className="shrink-0 text-muted" />
      <button
        type="button"
        title="Abrir"
        onClick={() => void open()}
        className="min-w-0 flex-1 truncate text-left text-sm hover:underline"
      >
        {file.name}
      </button>
      <span className="text-xs tabular-nums text-subtle">{formatBytes(file.sizeBytes)}</span>
      <span className="w-16 text-right text-xs tabular-nums text-subtle">{added}</span>
      <button
        type="button"
        aria-label={`Remover ${file.name}`}
        title="Remover"
        onClick={onRemove}
        className="grid size-6 place-items-center rounded-[6px] text-subtle hover:text-danger"
      >
        <Trash2 size={13} />
      </button>
    </li>
  );
}

export function FilesTab({ projectId }: { projectId: string }) {
  const files = useRpc('projectFiles.list', { projectId });
  const client = useQueryClient();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<ProjectFileResponse | null>(null);

  async function attach(run: () => Promise<{ added: number; errors: string[] }>) {
    setBusy(true);
    try {
      report(await run());
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
      void client.invalidateQueries();
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setOver(false);
    const dropped = [...event.dataTransfer.files];
    void attach(async () => {
      const total = { added: 0, errors: [] as string[] };
      for (const file of dropped) {
        const { added, errors } = await sendDropped(projectId, file);
        total.added += added;
        total.errors.push(...errors);
      }
      return total;
    });
  }

  async function remove(file: ProjectFileResponse) {
    const error = await window.sektor.removeProjectFile(file.id);
    if (error) toast.error(error);
    void client.invalidateQueries();
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        data-file-drop
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn(
          'flex flex-col items-center gap-2 rounded-panel border border-dashed p-6 text-center',
          over ? 'border-primary bg-primary/10' : 'border-line-strong'
        )}
      >
        <Upload size={18} className="text-muted" />
        <p className="text-sm text-muted">Solte arquivos aqui, até {LIMIT} cada.</p>
        <Button
          disabled={busy}
          onClick={() => void attach(() => window.sektor.pickProjectFiles(projectId))}
        >
          <Paperclip size={14} />
          Anexar arquivo
        </Button>
      </div>

      {files.data?.length ? (
        <ul className="overflow-hidden rounded-panel border border-line bg-surface shadow-card">
          {files.data.map((file) => (
            <FileRow key={file.id} file={file} onRemove={() => setRemoving(file)} />
          ))}
        </ul>
      ) : (
        !files.isPending && (
          <p className="py-4 text-center text-sm text-muted">Nenhum arquivo neste projeto.</p>
        )
      )}

      {removing && (
        <ConfirmDialog
          title="Remover arquivo"
          text={`${removing.name} sai do projeto, e a cópia guardada pelo Sektor também. O original no seu computador não muda.`}
          action="Remover"
          onConfirm={() => void remove(removing)}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}
