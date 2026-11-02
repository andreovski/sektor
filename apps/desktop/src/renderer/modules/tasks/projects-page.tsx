import {
  PROJECT_TYPE_LABELS,
  type ProjectResponse,
} from '@sektor/core/src/modules/tasks/contract';
import { clockAt, dueInfo, relativeDay } from '@sektor/core/src/modules/tasks/logic';
import { useNavigate } from '@tanstack/react-router';
import { CalendarDays, Check, FolderKanban, Pencil, Plus, RotateCcw } from 'lucide-react';
import { useState } from 'react';

import { todayString } from '../../lib/format';
import { useRpc, useRpcMutation } from '../../lib/rpc';
import { Button, Card, cn, EmptyState, PageHeader, Segmented } from '../../ui';

import { Chip, toneBg } from './chips';
import { ProjectDialog } from './project-dialog';

function Progress({ project }: { project: ProjectResponse }) {
  const { percent } = project.progress;
  return (
    <div
      role="progressbar"
      aria-label={`Progresso de ${project.name}`}
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-1.5 overflow-hidden rounded-full bg-active"
    >
      <div
        className={cn('h-full rounded-full', toneBg(project.color))}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

function DueLabel({ project }: { project: ProjectResponse }) {
  const info = dueInfo(
    { dueDate: project.dueDate, dueTime: null, completedAt: project.completedAt },
    todayString(),
    clockAt(new Date())
  );
  if (!info) return null;
  return (
    <Chip className={cn(info.overdue && 'border-danger/40 text-danger')}>
      <CalendarDays size={11} />
      {info.label}
    </Chip>
  );
}

function Actions({ project, onEdit }: { project: ProjectResponse; onEdit(): void }) {
  const update = useRpcMutation('projects.update');
  const done = Boolean(project.completedAt);
  return (
    <span className="flex items-center gap-0.5">
      <button
        type="button"
        aria-label={done ? `Reabrir ${project.name}` : `Concluir ${project.name}`}
        title={done ? 'Reabrir' : 'Concluir'}
        onClick={(event) => {
          event.stopPropagation();
          update.mutate({ id: project.id, completed: !done });
        }}
        className="grid size-6 place-items-center rounded-[6px] text-subtle hover:bg-hover hover:text-foreground"
      >
        {done ? <RotateCcw size={13} /> : <Check size={14} />}
      </button>
      <button
        type="button"
        aria-label={`Editar ${project.name}`}
        title="Editar"
        onClick={(event) => {
          event.stopPropagation();
          onEdit();
        }}
        className="grid size-6 place-items-center rounded-[6px] text-subtle hover:bg-hover hover:text-foreground"
      >
        <Pencil size={13} />
      </button>
    </span>
  );
}

function NextTask({ project }: { project: ProjectResponse }) {
  const next = project.nextTask;
  if (!next) {
    return (
      <p className="truncate text-xs text-subtle">
        {project.progress.total ? 'Todas as tarefas concluídas' : 'Sem tarefas ainda'}
      </p>
    );
  }
  return (
    <p className="truncate text-xs text-muted">
      <span className="text-subtle">Próxima: </span>
      {next.title}
      {next.dueDate && (
        <span className="text-subtle"> · {relativeDay(next.dueDate, todayString())}</span>
      )}
    </p>
  );
}

function ProjectCard({
  project,
  onOpen,
  onEdit,
}: {
  project: ProjectResponse;
  onOpen(): void;
  onEdit(): void;
}) {
  return (
    <Card
      className={cn(
        'flex cursor-pointer flex-col gap-3 hover:border-line-strong',
        project.completedAt && 'opacity-70'
      )}
      onClick={onOpen}
    >
      <div className="flex items-center gap-2">
        <span className={cn('size-2.5 shrink-0 rounded-full', toneBg(project.color))} />
        <h3 className="min-w-0 flex-1 truncate font-medium">{project.name}</h3>
        <Actions project={project} onEdit={onEdit} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip>{PROJECT_TYPE_LABELS[project.type]}</Chip>
        <DueLabel project={project} />
      </div>
      {project.description && (
        <p className="line-clamp-2 text-sm text-muted">{project.description}</p>
      )}
      <div className="mt-auto flex flex-col gap-1.5">
        <div className="flex justify-between text-xs text-muted">
          <span>
            {project.progress.done} de {project.progress.total} tarefas
          </span>
          <span className="tabular-nums">{project.progress.percent}%</span>
        </div>
        <Progress project={project} />
        <NextTask project={project} />
      </div>
    </Card>
  );
}

function ProjectLine({
  project,
  onOpen,
  onEdit,
}: {
  project: ProjectResponse;
  onOpen(): void;
  onEdit(): void;
}) {
  return (
    <li
      onClick={onOpen}
      className={cn(
        'grid cursor-pointer grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)_140px_190px] items-center gap-4 border-b border-line px-4 py-2.5 last:border-b-0 hover:bg-hover',
        project.completedAt && 'opacity-70'
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className={cn('size-2.5 shrink-0 rounded-full', toneBg(project.color))} />
        <span className="truncate text-sm font-medium">{project.name}</span>
        <Chip className="shrink-0">{PROJECT_TYPE_LABELS[project.type]}</Chip>
      </div>
      <NextTask project={project} />
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <Progress project={project} />
        </div>
        <span className="w-8 text-right text-xs tabular-nums text-muted">
          {project.progress.percent}%
        </span>
      </div>
      <div className="flex items-center justify-end gap-2">
        <DueLabel project={project} />
        <Actions project={project} onEdit={onEdit} />
      </div>
    </li>
  );
}

export function ProjectsPage() {
  const [mode, setMode] = useState<'grade' | 'lista'>('grade');
  const [showDone, setShowDone] = useState(false);
  const [dialog, setDialog] = useState<{ project: ProjectResponse | null } | null>(null);
  const projects = useRpc('projects.list', { includeCompleted: showDone });
  const navigate = useNavigate();
  const open = (project: ProjectResponse) =>
    navigate({ to: '/tarefas', search: { projeto: project.id } as never });
  const newProject = () => setDialog({ project: null });

  return (
    <div>
      <PageHeader
        icon={FolderKanban}
        title="Projetos"
        description="O progresso vem das tarefas de cada projeto."
        actions={
          <Button variant="primary" onClick={newProject}>
            <Plus size={15} />
            Novo projeto
          </Button>
        }
      />

      <div className="mb-4 flex items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={showDone}
            onChange={(event) => setShowDone(event.target.checked)}
          />
          Mostrar concluídos
        </label>
        <div className="ml-auto">
          <Segmented<'grade' | 'lista'>
            value={mode}
            onChange={setMode}
            options={[
              { value: 'grade', label: 'Grade' },
              { value: 'lista', label: 'Lista' },
            ]}
          />
        </div>
      </div>

      {projects.isPending ? (
        <p className="py-10 text-center text-sm text-muted">Carregando projetos…</p>
      ) : !projects.data?.length ? (
        <EmptyState
          icon={FolderKanban}
          title={showDone ? 'Nenhum projeto' : 'Nenhum projeto em andamento'}
          text="Junte tarefas num projeto para ver o progresso e o próximo passo."
          action={<Button onClick={newProject}>Criar projeto</Button>}
        />
      ) : mode === 'grade' ? (
        <div className="grid grid-cols-3 gap-3">
          {projects.data.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onOpen={() => open(project)}
              onEdit={() => setDialog({ project })}
            />
          ))}
        </div>
      ) : (
        <ul className="overflow-hidden rounded-panel border border-line bg-surface shadow-card">
          {projects.data.map((project) => (
            <ProjectLine
              key={project.id}
              project={project}
              onOpen={() => open(project)}
              onEdit={() => setDialog({ project })}
            />
          ))}
        </ul>
      )}

      <ProjectDialog
        open={dialog !== null}
        project={dialog?.project ?? null}
        onClose={() => setDialog(null)}
      />
    </div>
  );
}
