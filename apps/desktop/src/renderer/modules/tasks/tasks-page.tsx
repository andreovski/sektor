import type { TaskListResponse } from '@sektor/core/src/modules/tasks/contract';
import {
  canCapture,
  captureDefaults,
  findTask,
  queryForTarget,
  resolveListParam,
  SMART_VIEWS,
  type SmartSlug,
  sortLists,
} from '@sektor/core/src/modules/tasks/logic';
import { useNavigate, useSearch } from '@tanstack/react-router';
import {
  AlarmClock,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  CheckSquare,
  Inbox,
  type LucideIcon,
  Pencil,
  Plus,
  Search,
  Layers,
  CircleDashed,
} from 'lucide-react';
import { useState } from 'react';

import { todayString } from '../../lib/format';
import { useRpc } from '../../lib/rpc';
import { cn, EmptyState, Input, PageHeader, SectionLabel, Segmented, Select } from '../../ui';

import { CaptureField } from './capture-field';
import { toneBg } from './chips';
import { Kanban } from './kanban';
import { ListBody } from './list-body';
import { ListDialog } from './list-dialog';
import { NewTaskButton, TaskDialog } from './task-dialog';

const SMART_ICONS: Record<SmartSlug, LucideIcon> = {
  hoje: CalendarDays,
  programadas: CalendarClock,
  atrasadas: AlarmClock,
  'sem-prazo': CircleDashed,
  todas: Layers,
  concluidas: CheckCircle2,
};

type Search = { lista?: string; etiqueta?: string; projeto?: string };

function NavItem({
  icon,
  label,
  count,
  active,
  onClick,
  trailing,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  active: boolean;
  onClick(): void;
  trailing?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'group flex h-8 items-center rounded-control text-sm',
        active ? 'bg-active text-foreground' : 'text-muted hover:bg-hover hover:text-foreground'
      )}
    >
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? 'page' : undefined}
        className="flex h-full min-w-0 flex-1 items-center gap-2 pl-2 text-left"
      >
        <span className="grid w-4 shrink-0 place-items-center">{icon}</span>
        <span className="truncate">{label}</span>
      </button>
      {trailing}
      {count !== undefined && count > 0 && (
        <span className="pr-2 text-xs tabular-nums text-subtle group-hover:text-muted">{count}</span>
      )}
    </div>
  );
}

export function TasksPage() {
  const search = useSearch({ strict: false }) as Search;
  const navigate = useNavigate();
  const param = search.lista ?? 'todas';
  const target = resolveListParam(param, search.etiqueta);
  const projectId = search.projeto || undefined;

  const [mode, setMode] = useState<'lista' | 'kanban'>('lista');
  const [term, setTerm] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [listDialog, setListDialog] = useState<{ list: TaskListResponse | null } | null>(null);

  const lists = useRpc('taskLists.list');
  const counts = useRpc('tasks.counts');
  const tags = useRpc('tasks.tags');
  const projects = useRpc('projects.list', { includeCompleted: true });
  const tasks = useRpc('tasks.list', {
    ...queryForTarget(target),
    projectId,
    search: term.trim() || undefined,
    includeCompleted: mode === 'kanban' || undefined,
  });

  const go = (next: Search) =>
    navigate({ to: '/tarefas', search: { ...search, ...next } as never, replace: true });

  const sorted = sortLists(lists.data ?? []);
  const inbox = sorted.find((list) => list.isInbox);
  const smart = target.kind === 'smart' ? target.meta : null;
  const currentList = sorted.find((list) => target.kind === 'list' && list.id === target.id);
  const title = smart?.title ?? currentList?.name ?? 'Lista';
  const opened = findTask([tasks.data], openId);
  const today = todayString();

  const defaults = {
    listId: currentList?.id ?? inbox?.id ?? '',
    projectId,
    date: smart?.slug === 'hoje' || smart?.slug === 'programadas' ? today : undefined,
  };

  return (
    <div>
      <PageHeader
        icon={CheckSquare}
        title="Tarefas"
        description="Listas, prazos e o quadro do que está andando."
        actions={<NewTaskButton onClick={() => setCreating(true)} />}
      />

      <div className="grid grid-cols-[216px_minmax(0,1fr)] gap-6">
        <aside aria-label="Listas" className="flex flex-col gap-5">
          <nav className="flex flex-col gap-0.5">
            {SMART_VIEWS.map((view) => {
              const Icon = SMART_ICONS[view.slug];
              return (
                <NavItem
                  key={view.slug}
                  icon={<Icon size={15} />}
                  label={view.title}
                  count={counts.data?.[view.count]}
                  active={smart?.slug === view.slug}
                  onClick={() => go({ lista: view.slug })}
                />
              );
            })}
          </nav>

          <div>
            <div className="flex items-start">
              <SectionLabel>Listas</SectionLabel>
              <button
                type="button"
                aria-label="Nova lista"
                onClick={() => setListDialog({ list: null })}
                className="ml-auto text-subtle hover:text-foreground"
              >
                <Plus size={14} />
              </button>
            </div>
            <nav className="flex flex-col gap-0.5">
              {sorted.map((list) => (
                <NavItem
                  key={list.id}
                  icon={
                    list.isInbox ? (
                      <Inbox size={15} />
                    ) : (
                      <span className={cn('size-2 rounded-full', toneBg(list.color))} />
                    )
                  }
                  label={list.name}
                  count={list.openCount}
                  active={target.kind === 'list' && target.id === list.id}
                  onClick={() => go({ lista: list.id })}
                  trailing={
                    <button
                      type="button"
                      aria-label={`Editar ${list.name}`}
                      onClick={() => setListDialog({ list })}
                      className="mr-1 hidden text-subtle group-hover:block hover:text-foreground"
                    >
                      <Pencil size={12} />
                    </button>
                  }
                />
              ))}
            </nav>
          </div>

          {tags.data?.some((tag) => tag.taskCount > 0) && (
            <div>
              <SectionLabel>Etiquetas</SectionLabel>
              <div className="flex flex-wrap gap-1">
                {tags.data
                  .filter((tag) => tag.taskCount > 0)
                  .map((tag) => (
                    <button
                      key={tag.id}
                      type="button"
                      aria-pressed={search.etiqueta === tag.name}
                      onClick={() =>
                        go({ etiqueta: search.etiqueta === tag.name ? undefined : tag.name })
                      }
                      className={cn(
                        'h-6 rounded-[6px] border px-1.5 text-xs',
                        search.etiqueta === tag.name
                          ? 'border-primary/40 bg-primary/15 text-primary'
                          : 'border-line text-muted hover:text-foreground'
                      )}
                    >
                      #{tag.name}
                    </button>
                  ))}
              </div>
            </div>
          )}
        </aside>

        <div className="min-w-0">
          <div className="mb-4 flex items-center gap-2">
            <h2 className="mr-auto min-w-0 flex-1 truncate text-lg font-semibold">
              {title}
              {search.etiqueta && <span className="text-muted"> #{search.etiqueta}</span>}
            </h2>
            <div className="relative w-44 shrink-0">
              <Search
                size={13}
                className="absolute top-1/2 left-2.5 -translate-y-1/2 text-subtle"
              />
              <Input
                aria-label="Buscar tarefas"
                value={term}
                placeholder="Buscar"
                onChange={(event) => setTerm(event.target.value)}
                className="pl-7"
              />
            </div>
            <div className="w-40 shrink-0">
              <Select
                aria-label="Filtrar por projeto"
                value={projectId ?? ''}
                onChange={(event) => go({ projeto: event.target.value || undefined })}
              >
                <option value="">Todos os projetos</option>
                {projects.data?.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </Select>
            </div>
            <Segmented<'lista' | 'kanban'>
              value={mode}
              onChange={setMode}
              options={[
                { value: 'lista', label: 'Lista' },
                { value: 'kanban', label: 'Kanban' },
              ]}
            />
          </div>

          {canCapture(target) && (
            <CaptureField defaults={captureDefaults(target, today)} projectId={projectId} />
          )}

          {tasks.isPending ? (
            <p className="py-10 text-center text-sm text-muted">Carregando tarefas…</p>
          ) : mode === 'kanban' ? (
            <Kanban tasks={tasks.data ?? []} onOpen={setOpenId} />
          ) : tasks.data?.length ? (
            <ListBody
              tasks={tasks.data}
              listId={target.kind === 'list' && !term.trim() ? target.id : null}
              showCompleted={smart?.slug === 'concluidas'}
              onOpen={setOpenId}
            />
          ) : (
            <EmptyState
              icon={CheckCircle2}
              title={term.trim() ? 'Nada encontrado' : (smart?.emptyTitle ?? 'Lista vazia')}
              text={
                canCapture(target) && !term.trim()
                  ? 'Escreva no campo acima: data, #etiqueta e !prioridade são entendidas.'
                  : undefined
              }
            />
          )}
        </div>
      </div>

      <TaskDialog
        open={creating || Boolean(opened)}
        task={creating ? null : opened}
        defaults={defaults}
        onClose={() => {
          setCreating(false);
          setOpenId(null);
        }}
      />
      <ListDialog
        open={listDialog !== null}
        list={listDialog?.list ?? null}
        onClose={() => setListDialog(null)}
        onDeleted={() => {
          setListDialog(null);
          go({ lista: 'todas' });
        }}
      />
    </div>
  );
}
