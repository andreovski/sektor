import { Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { type CSSProperties, useState } from 'react';

import { useRpcMutation } from '../../lib/rpc';
import { Button, Card, cn, Dialog, Field, Input, Segmented, Select } from '../../ui';
import { CATEGORY_ICONS } from './category-icons';
import { CategoryIcon, ColorPicker, ConfirmDialog, Skeleton, useCategories } from './parts';
import { type Category, categoryTree } from './utils';

type Kind = 'EXPENSE' | 'INCOME';
type Editing = { category?: Category; parentId?: string | null } | null;

export function CategoriesPanel() {
  const categories = useCategories();
  const remove = useRpcMutation('categories.delete');
  const [kind, setKind] = useState<Kind>('EXPENSE');
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const tree = categoryTree(categories, kind);

  const row = (category: Category, nested: boolean, parent?: Category) => {
    const fixed = Boolean(category.systemKey);
    return (
      <div
        key={category.id}
        className={cn('group flex h-11 items-center gap-3 rounded-control px-2 hover:bg-hover', nested && 'ml-10')}
      >
        <CategoryIcon category={category} categories={categories} />
        <span className="min-w-0 flex-1 truncate text-sm">{category.name}</span>
        {fixed && <Lock size={13} aria-label="Fixa do app" className="text-subtle" />}
        <span className="hidden gap-1 group-focus-within:flex group-hover:flex">
          {!parent && !fixed && (
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Nova subcategoria de ${category.name}`}
              onClick={() => setEditing({ parentId: category.id })}
            >
              <Plus size={14} />
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Editar ${category.name}`}
            onClick={() => setEditing({ category })}
          >
            <Pencil size={14} />
          </Button>
          {!fixed && (
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Apagar ${category.name}`}
              onClick={() => setDeleting(category)}
            >
              <Trash2 size={14} />
            </Button>
          )}
        </span>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Segmented<Kind>
          value={kind}
          onChange={setKind}
          options={[
            { value: 'EXPENSE', label: 'Despesas' },
            { value: 'INCOME', label: 'Receitas' },
          ]}
        />
        <Button variant="primary" onClick={() => setEditing({})}>
          <Plus size={14} /> Nova categoria
        </Button>
      </div>
      <Card className="p-2">
        {categories.length === 0 ? (
          <Skeleton className="h-40" />
        ) : (
          tree.map(({ parent, children }) => (
            <div key={parent.id}>
              {row(parent, false)}
              {children.map((child) => row(child, true, parent))}
            </div>
          ))
        )}
      </Card>
      {editing && (
        <CategoryDialog
          kind={kind}
          editing={editing}
          categories={categories}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Apagar ${deleting?.name ?? 'categoria'}?`}
        message="Os lançamentos dela ficam sem categoria."
        actions={[
          { label: 'Apagar', danger: true, onSelect: () => remove.mutate({ id: deleting!.id }) },
        ]}
      />
    </div>
  );
}

function CategoryDialog({
  kind,
  editing,
  categories,
  onClose,
}: {
  kind: Kind;
  editing: NonNullable<Editing>;
  categories: Category[];
  onClose(): void;
}) {
  const category = editing.category;
  const create = useRpcMutation('categories.create');
  const update = useRpcMutation('categories.update');
  const fixed = Boolean(category?.systemKey);
  const [name, setName] = useState(category?.name ?? '');
  const [parentId, setParentId] = useState(category?.parentId ?? editing.parentId ?? '');
  const [icon, setIcon] = useState<string | null>(category?.icon ?? null);
  const [color, setColor] = useState<string | null>(category?.color ?? null);
  const busy = create.isPending || update.isPending;

  // Um nível só: a mãe não pode ter mãe, e quem tem filhas não vira filha.
  const hasChildren = categories.some((c) => c.parentId === category?.id);
  const parents = categories.filter(
    (c) => c.kind === kind && !c.parentId && !c.systemKey && c.id !== category?.id
  );

  function save() {
    const fields = fixed ? { icon, color } : { name: name.trim(), parentId: parentId || null, icon, color };
    const done = category
      ? update.mutateAsync({ id: category.id, ...fields })
      : create.mutateAsync({ ...fields, name: name.trim(), kind });
    done.then(onClose, () => {});
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={category ? 'Editar categoria' : 'Nova categoria'}
    >
      <div className="flex flex-col gap-3">
        {fixed ? (
          <p className="text-sm text-muted">
            {category?.name} é fixa do app: dá para mudar só a cor e o ícone.
          </p>
        ) : (
          <>
            <Field label="Nome">
              <Input
                autoFocus
                value={name}
                maxLength={60}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            {!hasChildren && (
              <Field label="Dentro de">
                <Select value={parentId} onChange={(event) => setParentId(event.target.value)}>
                  <option value="">Nenhuma (categoria principal)</option>
                  {parents.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </>
        )}
        <Field label="Cor">
          <ColorPicker value={color} onChange={setColor} />
        </Field>
        <Field label="Ícone">
          <div className="grid max-h-44 grid-cols-9 gap-1 overflow-y-auto rounded-control border border-line p-1">
            {CATEGORY_ICONS.map(({ name: iconName, label, icon: Icon }) => (
              <button
                key={iconName}
                type="button"
                title={label}
                aria-label={label}
                aria-pressed={icon === iconName}
                onClick={() => setIcon(iconName)}
                style={(icon === iconName && color ? { color } : undefined) as CSSProperties | undefined}
                className={cn(
                  'grid size-9 place-items-center rounded-control text-muted hover:bg-hover',
                  icon === iconName && 'bg-active text-foreground'
                )}
              >
                <Icon size={16} />
              </button>
            ))}
          </div>
        </Field>
        <Button
          variant="primary"
          className="ml-auto"
          disabled={busy || (!fixed && !name.trim())}
          onClick={save}
        >
          Salvar
        </Button>
      </div>
    </Dialog>
  );
}
