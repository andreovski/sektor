import { CalendarClock, Pencil, Plus, Tags, Trash2, Wand2, X } from 'lucide-react';
import { useState } from 'react';

import { money } from '../../../lib/format';
import { useRpc, useRpcMutation } from '../../../lib/rpc';
import {
  Button,
  Card,
  CardHeader,
  Dialog,
  EmptyState,
  Field,
  Input,
  SectionLabel,
  Select,
} from '../../../ui';
import type { Out } from './format';

type Rule = Out<'plus.rules.list'>[number];
type Category = Out<'categories.list'>[number];

export function CategoryOptions({ categories, kind }: { categories: Category[]; kind?: string }) {
  const parents = new Map(categories.map((category) => [category.id, category.name]));
  const label = (category: Category) => {
    const parent = category.parentId ? parents.get(category.parentId) : null;
    return parent ? `${parent} › ${category.name}` : category.name;
  };
  const group = (value: Category['kind'], title: string) => {
    const list = categories
      .filter((category) => category.kind === value)
      .map((category) => ({ id: category.id, label: label(category) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
    if (kind) {
      return list.map((category) => (
        <option key={category.id} value={category.id}>
          {category.label}
        </option>
      ));
    }
    return (
      <optgroup label={title}>
        {list.map((category) => (
          <option key={category.id} value={category.id}>
            {category.label}
          </option>
        ))}
      </optgroup>
    );
  };
  if (kind) return <>{group(kind as Category['kind'], '')}</>;
  return (
    <>
      {group('EXPENSE', 'Despesas')}
      {group('INCOME', 'Receitas')}
    </>
  );
}

function RuleDialog({ rule, onClose }: { rule: Rule | null; onClose(): void }) {
  const categories = useRpc('categories.list').data ?? [];
  const create = useRpcMutation('plus.rules.create');
  const update = useRpcMutation('plus.rules.update');
  const [pattern, setPattern] = useState(rule?.pattern ?? '');
  const [categoryId, setCategoryId] = useState(rule?.categoryId ?? '');
  const valid = pattern.trim().length >= 2 && categoryId;

  return (
    <Dialog open onOpenChange={onClose} title={rule ? 'Editar regra' : 'Nova regra'}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid) return;
          if (rule) update.mutate({ id: rule.id, pattern, categoryId }, { onSuccess: onClose });
          else create.mutate({ pattern, categoryId }, { onSuccess: onClose });
        }}
      >
        <Field label="Se a descrição contém">
          <Input
            autoFocus
            value={pattern}
            placeholder="uber"
            onChange={(event) => setPattern(event.target.value)}
          />
        </Field>
        <Field label="Vira a categoria">
          <Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">Escolha</option>
            <CategoryOptions categories={categories} />
          </Select>
        </Field>
        <p className="text-xs text-muted">
          Vale para maiúsculas e acentos, e só para lançamentos do mesmo tipo da categoria. Se mais de
          uma regra servir, ganha a de texto mais longo.
        </p>
        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={!valid}>
            Salvar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ApplyCard() {
  const { data } = useRpc('plus.rules.preview');
  const apply = useRpcMutation('plus.rules.apply');
  const [done, setDone] = useState<number | null>(null);
  if (!data) return null;
  const run = (overwrite: boolean) =>
    apply.mutate({ overwrite }, { onSuccess: (result) => setDone(result.updated) });
  const replaced = data.withOverwrite - data.uncategorized;

  return (
    <Card>
      <CardHeader icon={Wand2} title="Aplicar nos lançamentos existentes" />
      {data.withOverwrite === 0 ? (
        <p className="text-sm text-muted">
          {done === null
            ? 'Nenhum lançamento existente muda com as regras de agora.'
            : `Pronto: ${done === 1 ? '1 lançamento atualizado' : `${done} lançamentos atualizados`}.`}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto text-sm text-muted">
            {data.uncategorized === 1
              ? '1 lançamento sem categoria casa com as regras'
              : `${data.uncategorized} lançamentos sem categoria casam com as regras`}
            {replaced > 0 && `, e ${replaced} teriam a categoria trocada`}.
          </p>
          {replaced > 0 && (
            <Button size="sm" onClick={() => run(true)} disabled={apply.isPending}>
              Trocar também ({data.withOverwrite})
            </Button>
          )}
          <Button
            size="sm"
            variant="primary"
            onClick={() => run(false)}
            disabled={apply.isPending || data.uncategorized === 0}
          >
            Aplicar nos sem categoria
          </Button>
        </div>
      )}
    </Card>
  );
}

function Suggestions() {
  const { data } = useRpc('plus.recurring.suggestions');
  const accept = useRpcMutation('plus.recurring.accept');
  const dismiss = useRpcMutation('plus.recurring.dismiss');
  return (
    <Card>
      <CardHeader icon={CalendarClock} title="Contas fixas encontradas" />
      {!data || data.length === 0 ? (
        <p className="text-sm text-muted">
          Quando a mesma descrição aparecer com valor parecido em 3 meses, ela vira sugestão aqui.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {data.map((item) => (
            <li key={item.key} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{item.description}</p>
                <p className="text-xs text-muted">
                  Em {item.months} meses · todo dia {item.day} · {item.accountName}
                  {item.categoryName ? ` · ${item.categoryName}` : ''}
                </p>
              </div>
              <span className="text-sm tabular-nums">{money(item.amountCents)}</span>
              <Button
                size="sm"
                onClick={() => accept.mutate({ key: item.key })}
                disabled={accept.isPending}
              >
                Criar recorrente
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Dispensar ${item.description}`}
                onClick={() => dismiss.mutate({ key: item.key })}
              >
                <X size={13} />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function RulesTab() {
  const { data: rules, isLoading } = useRpc('plus.rules.list');
  const remove = useRpcMutation('plus.rules.delete');
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);

  if (isLoading || !rules) return <div className="h-48 animate-pulse rounded-panel bg-hover" />;

  const addButton = (
    <Button variant="primary" onClick={() => setEditing('new')}>
      <Plus size={14} /> Regra
    </Button>
  );
  return (
    <div className="flex flex-col gap-4">
      {rules.length === 0 ? (
        <Card>
          <EmptyState
            icon={Tags}
            title="Nenhuma regra ainda"
            text="Diga que uma descrição vira uma categoria, e os lançamentos passam a se organizar sozinhos."
            action={addButton}
          />
        </Card>
      ) : (
        <>
          <section>
            <div className="flex items-center">
              <SectionLabel>Regras de categoria</SectionLabel>
              <div className="mb-3 ml-auto">{addButton}</div>
            </div>
            <Card>
              <ul className="divide-y divide-line">
                {rules.map((rule) => (
                  <li key={rule.id} className="flex items-center gap-2 py-2 text-sm">
                    <span className="text-muted">Contém</span>
                    <span className="min-w-0 truncate font-medium">{rule.pattern}</span>
                    <span className="text-muted">vira</span>
                    <span className="min-w-0 truncate font-medium">{rule.categoryName}</span>
                    <span className="ml-auto flex">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Editar ${rule.pattern}`}
                        onClick={() => setEditing(rule)}
                      >
                        <Pencil size={13} />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Apagar ${rule.pattern}`}
                        onClick={() => remove.mutate({ id: rule.id })}
                      >
                        <Trash2 size={13} />
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
          <ApplyCard />
        </>
      )}
      <Suggestions />
      {editing && (
        <RuleDialog rule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
