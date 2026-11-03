import { CircleCheck, History, ListChecks } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { longDate, money } from '../../lib/format';
import { useRpc, useRpcMutation } from '../../lib/rpc';
import { Button, Card, cn, Dialog, EmptyState, Field, Input, SectionLabel, Segmented } from '../../ui';
import { NoteField } from '../../ui/rich-text';
import {
  CategoryIcon,
  CategorySelect,
  ConfirmDialog,
  Pill,
  Skeleton,
  useAccounts,
  useCategories,
} from './parts';
import type { Movement } from './utils';

const SOURCE: Record<NonNullable<Movement['suggestionSource']>, { label: string; note: string }> = {
  HISTORY: { label: 'Pelo histórico', note: 'A categoria é a do último lançamento parecido.' },
  RULE: { label: 'Regra', note: 'A categoria veio de uma regra sua.' },
};

function SourcePill({ source }: { source: Movement['suggestionSource'] }) {
  if (!source) return null;
  const Icon = source === 'HISTORY' ? History : ListChecks;
  return (
    <Pill tone={source === 'RULE' ? 'info' : undefined}>
      <Icon size={11} className="mr-1" /> {SOURCE[source].label}
    </Pill>
  );
}

/** Lançamentos que vieram do banco e não casaram com nada: a pessoa confere antes do saldo. */
export function ReviewTab({ onOpenBanks }: { onOpenBanks(): void }) {
  const movements = useRpc('bank.movements', { status: 'PENDING' });
  const accounts = useAccounts();
  const categories = useCategories();
  const accept = useRpcMutation('bank.accept');
  const ignore = useRpcMutation('bank.ignore');
  const acceptAll = useRpcMutation('bank.acceptAll');
  const ignoreAll = useRpcMutation('bank.ignoreAll');
  const [open, setOpen] = useState<Movement | null>(null);
  const [confirmIgnore, setConfirmIgnore] = useState(false);

  const list = movements.data ?? [];
  const days = [...new Set(list.map((m) => m.date))];
  const suggested = list.filter((m) => m.suggestedCategoryId).length;

  if (movements.isPending) return <Skeleton className="h-40" />;
  if (list.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={CircleCheck}
          title="Tudo revisado"
          text="Os lançamentos novos dos seus bancos aparecem aqui."
          action={<Button onClick={onOpenBanks}>Ver bancos</Button>}
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex items-center gap-3">
        <p className="flex-1 text-sm text-muted">
          Vieram do banco e não batem com nada que você lançou.
          {suggested ? ` ${suggested} já com categoria sugerida.` : ''}
        </p>
        <Button
          disabled={ignoreAll.isPending || acceptAll.isPending}
          onClick={() => setConfirmIgnore(true)}
        >
          Recusar todos
        </Button>
        <Button
          variant="primary"
          disabled={ignoreAll.isPending || acceptAll.isPending}
          onClick={() =>
            acceptAll.mutateAsync(undefined).then(
              ({ imported }) => toast.success(`${imported} lançamento(s) adicionados.`),
              () => {}
            )
          }
        >
          Aceitar todos ({list.length})
        </Button>
      </Card>
      {days.map((day) => (
        <section key={day}>
          <SectionLabel>{longDate(day)}</SectionLabel>
          <Card className="p-2">
            {list
              .filter((m) => m.date === day)
              .map((movement) => {
                const category = categories.find((c) => c.id === movement.suggestedCategoryId);
                const account = accounts.find((a) => a.id === movement.accountId);
                return (
                  <div
                    key={movement.id}
                    className="flex h-[52px] items-center gap-3 rounded-control px-2 hover:bg-hover"
                  >
                    <button
                      type="button"
                      onClick={() => setOpen(movement)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <CategoryIcon category={category} categories={categories} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{movement.description}</span>
                        <span className="block truncate text-xs text-subtle">
                          {[account?.name, category?.name ?? 'Sem categoria']
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                      {category && <SourcePill source={movement.suggestionSource} />}
                      <span
                        className={cn(
                          'text-sm font-medium tabular-nums',
                          movement.kind === 'INCOME' ? 'text-success' : 'text-danger'
                        )}
                      >
                        {money(movement.amountCents)}
                      </span>
                    </button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={ignore.isPending}
                      onClick={() => ignore.mutate({ id: movement.id })}
                    >
                      Ignorar
                    </Button>
                    <Button
                      size="sm"
                      disabled={accept.isPending}
                      onClick={() => accept.mutate({ id: movement.id })}
                    >
                      Lançar
                    </Button>
                  </div>
                );
              })}
          </Card>
        </section>
      ))}
      {open && <ReviewDialog movement={open} onClose={() => setOpen(null)} />}
      <ConfirmDialog
        open={confirmIgnore}
        onOpenChange={setConfirmIgnore}
        title={`Recusar os ${list.length} lançamentos?`}
        message="Nenhum deles entra nas suas finanças, e o banco não os traz de novo. Não dá para desfazer."
        actions={[
          {
            label: 'Recusar todos',
            danger: true,
            onSelect: () =>
              ignoreAll.mutateAsync(undefined).then(
                ({ ignored }) => toast.success(`${ignored} lançamento(s) recusados.`),
                () => {}
              ),
          },
        ]}
      />
    </div>
  );
}

function ReviewDialog({ movement, onClose }: { movement: Movement; onClose(): void }) {
  const categories = useCategories();
  const accept = useRpcMutation('bank.accept');
  const ignore = useRpcMutation('bank.ignore');
  const [kind, setKind] = useState(movement.kind);
  const [categoryId, setCategoryId] = useState(movement.suggestedCategoryId ?? '');
  const [description, setDescription] = useState(movement.description);
  // O texto do banco vai nas notas quando o título é outro; dá para mudar ou apagar.
  const [notes, setNotes] = useState(
    movement.bankDescription !== movement.description ? movement.bankDescription : ''
  );
  const source = categoryId && categoryId === movement.suggestedCategoryId && movement.suggestionSource;

  return (
    <Dialog open onOpenChange={(value) => !value && onClose()} title="Do banco">
      <div className="flex flex-col gap-3">
        <p
          className={cn(
            'text-center text-3xl font-semibold tabular-nums',
            kind === 'INCOME' ? 'text-success' : 'text-danger'
          )}
        >
          {money(movement.amountCents)}
        </p>
        <p className="text-center text-xs text-muted">{longDate(movement.date)}, como veio do banco.</p>
        <div className="flex justify-center">
          <Segmented
            value={kind}
            onChange={(value) => {
              setKind(value);
              setCategoryId('');
            }}
            options={[
              { value: 'EXPENSE', label: 'Despesa' },
              { value: 'INCOME', label: 'Receita' },
            ]}
          />
        </div>
        <Field label="Descrição">
          <Input
            value={description}
            maxLength={120}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        <Field label="Categoria">
          <CategorySelect
            value={categoryId}
            onChange={setCategoryId}
            kind={kind}
            categories={categories}
          />
        </Field>
        {source && <p className="text-xs text-subtle">{SOURCE[source].note}</p>}
        <NoteField label="Notas" rows={2} value={notes} onChange={setNotes} />
        <div className="flex gap-2">
          <Button
            variant="danger"
            disabled={ignore.isPending}
            onClick={() => ignore.mutateAsync({ id: movement.id }).then(onClose, () => {})}
          >
            Ignorar
          </Button>
          <Button
            variant="primary"
            className="ml-auto"
            disabled={accept.isPending}
            onClick={() =>
              accept
                .mutateAsync({
                  id: movement.id,
                  kind,
                  categoryId: categoryId || null,
                  ...(description.trim() && description.trim() !== movement.description
                    ? { description: description.trim() }
                    : {}),
                  notes: notes.trim() || null,
                })
                .then(onClose, () => {})
            }
          >
            Lançar
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
