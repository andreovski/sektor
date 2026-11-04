import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUSES,
  type ProjectStatus,
} from '@sektor/core/src/modules/tasks/contract';
import { useNavigate, useParams } from '@tanstack/react-router';
import { ArrowLeft, FolderKanban, Pencil } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import { longDate, shortDate, todayString } from '../../lib/format';
import { useRpc, useRpcMutation } from '../../lib/rpc';
import { Button, Card, cn, EmptyState, Select } from '../../ui';
import { toneVar } from '../agenda/shared';
import { ProjectDialog } from '../tasks/project-dialog';

import { FilesTab } from './files-tab';
import { NotesTab } from './notes-tab';
import { Overview } from './overview';
import { ProjectTasks } from './task-tabs';

const RADIUS = 20;
const CIRCLE = 2 * Math.PI * RADIUS;

function Ring({ percent, color }: { percent: number; color: string }) {
  return (
    <svg viewBox="0 0 48 48" className="size-12 shrink-0 -rotate-90" aria-hidden>
      <circle cx="24" cy="24" r={RADIUS} fill="none" strokeWidth="5" className="stroke-line-strong" />
      <circle
        cx="24"
        cy="24"
        r={RADIUS}
        fill="none"
        strokeWidth="5"
        strokeLinecap="round"
        stroke={color}
        strokeDasharray={CIRCLE}
        strokeDashoffset={CIRCLE * (1 - percent / 100)}
      />
    </svg>
  );
}

function StatCard({
  label,
  value,
  hint,
  danger,
  ring,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  danger?: boolean;
  ring?: ReactNode;
}) {
  return (
    <Card className="flex items-center gap-3">
      {ring}
      <div className="min-w-0">
        <p className="text-xs text-muted">{label}</p>
        <p className={cn('truncate text-xl font-semibold tabular-nums', danger && 'text-danger')}>
          {value}
        </p>
        {hint && <p className="truncate text-xs text-subtle">{hint}</p>}
      </div>
    </Card>
  );
}

type Tab = 'visao' | 'kanban' | 'tarefas' | 'notas' | 'arquivos';

function Tabs({
  value,
  onChange,
  tabs,
}: {
  value: Tab;
  onChange(tab: Tab): void;
  tabs: { value: Tab; label: string; count?: number }[];
}) {
  return (
    <div role="tablist" aria-label="Seções do projeto" className="mb-3 flex gap-1 border-b border-line">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={tab.value === value}
          onClick={() => onChange(tab.value)}
          className={cn(
            '-mb-px flex h-9 items-center gap-1.5 border-b-2 px-3 text-sm transition-colors',
            tab.value === value
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted hover:text-foreground'
          )}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className="rounded-full bg-active px-1.5 text-[11px] tabular-nums text-muted">
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function ProjectPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();
  const page = useRpc('projects.page', { id });
  const update = useRpcMutation('projects.update');
  const [tab, setTab] = useState<Tab>('visao');
  const [editing, setEditing] = useState(false);
  const back = () => navigate({ to: '/projetos' });

  const backLink = (
    <button
      type="button"
      onClick={back}
      className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
    >
      <ArrowLeft size={14} />
      Projetos
    </button>
  );

  if (page.isPending) {
    return <p className="py-10 text-center text-sm text-muted">Carregando projeto…</p>;
  }
  if (!page.data) {
    return (
      <div>
        {backLink}
        <EmptyState icon={FolderKanban} title="Projeto não encontrado" text="Ele pode ter sido apagado." />
      </div>
    );
  }

  const { project, counts } = page.data;
  const color = toneVar(project.color);
  const { done, total, percent } = project.progress;
  const finished = project.status === 'DONE';
  const late = Boolean(project.dueDate && !finished && project.dueDate < todayString());

  return (
    <div>
      {backLink}
      <header className="mb-4 flex items-start gap-3">
        <span
          className="grid size-11 shrink-0 place-items-center rounded-control border"
          style={{
            color,
            borderColor: `color-mix(in srgb, ${color} 45%, transparent)`,
            backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`,
          }}
        >
          <FolderKanban size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="min-w-0 truncate text-2xl font-semibold">{project.name}</h1>
          </div>
          {project.description && (
            <p className="mt-1 max-w-3xl text-sm whitespace-pre-wrap text-muted">
              {project.description}
            </p>
          )}
        </div>
        <div className="w-32 shrink-0">
          <Select
            aria-label="Status do projeto"
            value={project.status}
            onChange={(event) =>
              update.mutate({ id: project.id, status: event.target.value as ProjectStatus })
            }
          >
            {PROJECT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {PROJECT_STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
        </div>
        <Button onClick={() => setEditing(true)}>
          <Pencil size={14} />
          Editar
        </Button>
      </header>

      <div className="mb-4 grid grid-cols-4 gap-3">
        <StatCard
          label="Progresso"
          value={`${percent}%`}
          hint={`${done} de ${total}`}
          ring={<Ring percent={percent} color={color} />}
        />
        <StatCard label="Tarefas abertas" value={counts.open} />
        <StatCard label="Atrasadas" value={counts.overdue} danger={counts.overdue > 0} />
        <StatCard
          label="Entrega"
          value={project.dueDate ? shortDate(project.dueDate) : 'sem prazo'}
          hint={late ? 'Prazo vencido' : project.dueDate ? longDate(project.dueDate) : undefined}
          danger={late}
        />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'visao', label: 'Visão geral' },
          { value: 'kanban', label: 'Kanban', count: total },
          { value: 'tarefas', label: 'Tarefas', count: counts.open },
          { value: 'notas', label: 'Notas', count: counts.notes },
          { value: 'arquivos', label: 'Arquivos', count: counts.files },
        ]}
      />

      <div key={tab} className="tab-panel">
        {tab === 'visao' && <Overview page={page.data} />}
        {tab === 'kanban' && <ProjectTasks projectId={id} mode="kanban" />}
        {tab === 'tarefas' && <ProjectTasks projectId={id} mode="lista" />}
        {tab === 'notas' && <NotesTab projectId={id} />}
        {tab === 'arquivos' && <FilesTab projectId={id} />}
      </div>

      <ProjectDialog
        open={editing}
        project={project}
        onClose={() => setEditing(false)}
        onDeleted={back}
      />
    </div>
  );
}
