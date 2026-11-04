import { FileUp, Upload } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { money, shortDate } from '../../../lib/format';
import { call, useRpc, useRpcMutation } from '../../../lib/rpc';
import { Button, cn, Dialog, EmptyState, Field, Input, Segmented, Select } from '../../../ui';
import { decodeText, type Out } from './format';
import { categoryOptions } from './rules';

type Preview = Out<'plus.import.preview'>;
type Line = Preview['lines'][number];
type Mode = 'statement' | 'invoice';

const MAX_BYTES = 5 * 1024 * 1024;
const PAGE = 100;

const STATUS: Record<Line['status'], { label: string; tone: string } | null> = {
  NEW: null,
  DUPLICATE: { label: 'Já importado', tone: 'text-subtle' },
  POSSIBLE: { label: 'Possível duplicado', tone: 'text-warning' },
  PAYMENT: { label: 'Pagamento de fatura', tone: 'text-info' },
};

function Setup({ onPreview }: { onPreview(preview: Preview, request: Request): void }) {
  const accounts = useRpc('accounts.list').data ?? [];
  const [mode, setMode] = useState<Mode>('statement');
  const options = accounts.filter((a) => (a.type === 'CREDIT_CARD') === (mode === 'invoice'));
  const [accountId, setAccountId] = useState('');
  const chosen = options.some((a) => a.id === accountId) ? accountId : (options[0]?.id ?? '');
  const [dueDate, setDueDate] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode !== 'invoice' || !chosen) return;
    void call('plus.import.nextDue', { accountId: chosen }).then((next) =>
      setDueDate(next.dueDate ?? '')
    );
  }, [mode, chosen]);

  const read = async () => {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      toast.error('O arquivo passa de 5 MB.');
      return;
    }
    setBusy(true);
    try {
      const request: Request = {
        text: decodeText(await file.arrayBuffer()),
        fileName: file.name,
        accountId: chosen,
        mode,
        dueDate: mode === 'invoice' && dueDate ? dueDate : undefined,
      };
      onPreview(await call('plus.import.preview', request), request);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Segmented<Mode>
        value={mode}
        onChange={setMode}
        options={[
          { value: 'statement', label: 'Extrato de conta' },
          { value: 'invoice', label: 'Fatura de cartão' },
        ]}
      />
      {options.length === 0 ? (
        <p className="text-sm text-muted">
          {mode === 'invoice' ? 'Cadastre um cartão primeiro.' : 'Cadastre uma conta primeiro.'}
        </p>
      ) : (
        <>
          <Field label={mode === 'invoice' ? 'Cartão' : 'Conta de destino'}>
            <Select value={chosen} onChange={(event) => setAccountId(event.target.value)}>
              {options.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          </Field>
          {mode === 'invoice' && (
            <Field label="Vencimento da fatura">
              <Input
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </Field>
          )}
          <Field label="Arquivo CSV ou OFX, até 5 MB e 5.000 linhas">
            <input
              type="file"
              accept=".csv,.ofx,.qfx,.txt"
              className="text-sm text-foreground file:mr-3 file:h-8 file:rounded-control file:border file:border-line-strong file:bg-sunken file:px-3 file:text-sm file:text-foreground"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </Field>
          <p className="text-xs text-muted">O arquivo é lido aqui mesmo e não sai do seu computador.</p>
          <div className="flex justify-end">
            <Button variant="primary" onClick={read} disabled={!file || !chosen || busy}>
              {busy ? 'Lendo...' : 'Ver prévia'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

type Request = {
  text: string;
  fileName: string;
  accountId: string;
  mode: Mode;
  invert?: boolean;
  dueDate?: string;
};

const initialSelection = (preview: Preview) =>
  new Set(preview.lines.filter((line) => line.status === 'NEW').map((line) => line.index));

function Review({
  preview: initial,
  request: initialRequest,
  onBack,
  onDone,
}: {
  preview: Preview;
  request: Request;
  onBack(): void;
  onDone(imported: number): void;
}) {
  const categories = useRpc('categories.list').data ?? [];
  const confirm = useRpcMutation('plus.import.confirm');
  const [preview, setPreview] = useState(initial);
  const [request, setRequest] = useState(initialRequest);
  const [selected, setSelected] = useState(() => initialSelection(initial));
  const [overrides, setOverrides] = useState<Record<string, string | null>>({});
  const [visible, setVisible] = useState(PAGE);

  const totals = useMemo(() => {
    let net = 0;
    for (const line of preview.lines) {
      if (selected.has(line.index)) {
        net += line.kind === 'EXPENSE' ? -line.amountCents : line.amountCents;
      }
    }
    return net;
  }, [preview, selected]);

  const toggleInvert = async () => {
    const next = { ...request, invert: !request.invert };
    try {
      const result = await call('plus.import.preview', next);
      setRequest(next);
      setPreview(result);
      setSelected(initialSelection(result));
      setOverrides({});
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const toggle = (index: number) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(index)) next.add(index);
      return next;
    });

  const { counts, lines } = preview;
  const plural = (count: number, one: string, many: string) =>
    `${count} ${count === 1 ? one : many}`;
  const summary = [
    plural(counts.new, 'novo', 'novos'),
    counts.duplicate && plural(counts.duplicate, 'já importado', 'já importados'),
    counts.possible && plural(counts.possible, 'possível duplicado', 'possíveis duplicados'),
    counts.payment && plural(counts.payment, 'pagamento de fatura', 'pagamentos de fatura'),
    preview.ignored && plural(preview.ignored, 'linha ignorada', 'linhas ignoradas'),
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">{summary.join(' · ')}</p>
      {preview.unreadable > 0 && (
        <p className="text-xs text-warning">
          {preview.unreadable === 1
            ? '1 linha não pôde ser lida e ficou de fora.'
            : `${preview.unreadable} linhas não puderam ser lidas e ficaram de fora.`}
        </p>
      )}
      {preview.invoicePaid && (
        <p className="text-xs text-warning">
          Esta fatura já consta como paga: o que entrar agora muda o total dela.
        </p>
      )}
      {request.mode === 'invoice' && (
        <label className="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={Boolean(request.invert)} onChange={toggleInvert} />
          Compras e estornos vieram trocados
        </label>
      )}

      <ul className="flex flex-col divide-y divide-line">
        {lines.slice(0, visible).map((line) => {
          const status = STATUS[line.status];
          const locked = line.status === 'DUPLICATE';
          const category = overrides[line.index] ?? (line.index in overrides ? null : line.categoryId);
          return (
            <li key={line.index} className={cn('flex gap-2 py-2', locked && 'opacity-60')}>
              <input
                type="checkbox"
                className="mt-1 self-start"
                aria-label={`Importar ${line.description}`}
                disabled={locked}
                checked={selected.has(line.index)}
                onChange={() => toggle(line.index)}
              />
              <div className="min-w-0 flex-1">
                <div className="flex gap-2 text-sm">
                  <span className="text-subtle tabular-nums">{shortDate(line.date)}</span>
                  <span className="min-w-0 truncate">{line.description}</span>
                  <span
                    className={cn(
                      'ml-auto whitespace-nowrap tabular-nums',
                      line.kind === 'INCOME' && 'text-success'
                    )}
                  >
                    {line.kind === 'EXPENSE' ? '− ' : '+ '}
                    {money(line.amountCents)}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  {!locked && (
                    <Select
                      aria-label={`Categoria de ${line.description}`}
                      className="h-7 max-w-52 text-xs"
                      value={category ?? ''}
                      onChange={(event) =>
                        setOverrides((current) => ({
                          ...current,
                          [line.index]: event.target.value || null,
                        }))
                      }
                    >
                      <option value="">Sem categoria</option>
                      {categoryOptions(categories, line.kind)}
                    </Select>
                  )}
                  {status && <span className={cn('text-xs', status.tone)}>{status.label}</span>}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {lines.length > visible && (
        <Button size="sm" variant="ghost" onClick={() => setVisible((count) => count + PAGE)}>
          Mostrar mais ({lines.length - visible})
        </Button>
      )}

      <div className="sticky -bottom-5 -mx-5 -mb-5 flex items-center gap-2 border-t border-line bg-raised px-5 py-3">
        <Button variant="ghost" onClick={onBack}>
          Voltar
        </Button>
        <span className="ml-auto text-xs text-muted tabular-nums">Saldo: {money(totals)}</span>
        <Button
          variant="primary"
          disabled={selected.size === 0 || confirm.isPending}
          onClick={() =>
            confirm.mutate(
              { ...request, selected: [...selected], categories: overrides },
              { onSuccess: (result) => onDone(result.imported) }
            )
          }
        >
          {selected.size === 1 ? 'Importar 1 lançamento' : `Importar ${selected.size} lançamentos`}
        </Button>
      </div>
    </div>
  );
}

export function ImportButton() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<{ preview: Preview; request: Request } | null>(null);
  const [imported, setImported] = useState<number | null>(null);

  const change = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setStep(null);
      setImported(null);
    }
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Upload size={14} /> Importar
      </Button>
      <Dialog open={open} onOpenChange={change} title="Importar extrato">
        {imported !== null ? (
          <EmptyState
            icon={FileUp}
            title={imported === 1 ? '1 lançamento importado' : `${imported} lançamentos importados`}
            action={<Button onClick={() => change(false)}>Fechar</Button>}
          />
        ) : step ? (
          <Review
            preview={step.preview}
            request={step.request}
            onBack={() => setStep(null)}
            onDone={setImported}
          />
        ) : (
          <Setup onPreview={(preview, request) => setStep({ preview, request })} />
        )}
      </Dialog>
    </>
  );
}
