import { useQueries } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { FolderKanban, Landmark, Target, Wallet } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis } from 'recharts';

import { money, todayString } from '../../lib/format';
import { call, useRpc } from '../../lib/rpc';
import { cn } from '../../ui';

import { Empty, HomeCard, Loaded, Meter, More } from './card';
import { shiftMonth } from './dates';

const STATUS: Record<string, { label: string; className: string }> = {
  ahead: { label: 'Adiantada', className: 'text-success' },
  behind: { label: 'Atrasada', className: 'text-warning' },
  unreachable: { label: 'Fora de alcance', className: 'text-danger' },
  overdue: { label: 'Vencida', className: 'text-danger' },
};

const GOALS_SHOWN = 4;

export function GoalsCard() {
  const query = useRpc('goals.list');
  return (
    <HomeCard icon={Target} title="Metas" to="/metas" module="Metas">
      <Loaded query={query}>
        {(all) => {
          const goals = all.filter((goal) => goal.pace.status !== 'done');
          if (goals.length === 0) {
            return <Empty icon={Target} title="Nenhuma meta aberta" action="Criar meta" to="/metas" />;
          }
          return (
            <>
              <ul className="flex flex-col gap-3.5">
                {goals.slice(0, GOALS_SHOWN).map((goal) => {
                  const status = STATUS[goal.pace.status];
                  const value = (amount: number) =>
                    goal.money ? money(amount) : amount.toLocaleString('pt-BR');
                  return (
                    <li key={goal.id}>
                      <div className="mb-1 flex items-baseline gap-2 text-sm">
                        <span className="min-w-0 truncate">{goal.title}</span>
                        {status && (
                          <span className={cn('shrink-0 text-xs', status.className)}>{status.label}</span>
                        )}
                      </div>
                      <Meter value={goal.pace.progress} tone={`var(--tone-${goal.color})`} />
                      <p className="mt-1 text-xs text-muted tabular-nums">
                        {value(goal.current)} de {value(goal.target)}
                        {goal.money ? '' : ` ${goal.unit}`}
                      </p>
                    </li>
                  );
                })}
              </ul>
              <More to="/metas" count={goals.length - GOALS_SHOWN} />
            </>
          );
        }}
      </Loaded>
    </HomeCard>
  );
}

const PROJECTS_SHOWN = 4;

export function ProjectsCard() {
  const query = useRpc('projects.list');
  return (
    <HomeCard icon={FolderKanban} title="Projetos em andamento" to="/projetos" module="Projetos">
      <Loaded query={query}>
        {(projects) =>
          projects.length === 0 ? (
            <Empty icon={FolderKanban} title="Nenhum projeto aberto" action="Criar projeto" to="/projetos" />
          ) : (
            <>
              <ul className="flex flex-col gap-3.5">
                {projects.slice(0, PROJECTS_SHOWN).map((project) => (
                  <li key={project.id}>
                    <div className="mb-1 flex items-baseline gap-2 text-sm">
                      <span className="min-w-0 truncate">{project.name}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted tabular-nums">
                        {project.progress.done} de {project.progress.total}
                      </span>
                    </div>
                    <Meter
                      value={project.progress.percent / 100}
                      tone={project.color ? `var(--tone-${project.color})` : undefined}
                    />
                    <p className="mt-1 truncate text-xs text-muted">
                      {project.nextTask ? `Próxima: ${project.nextTask.title}` : 'Sem próxima tarefa'}
                    </p>
                  </li>
                ))}
              </ul>
              <More to="/projetos" count={projects.length - PROJECTS_SHOWN} />
            </>
          )
        }
      </Loaded>
    </HomeCard>
  );
}

const CHART_MONTHS = 6;
const monthName = (month: string) =>
  new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' })
    .format(new Date(`${month}-01T00:00:00Z`))
    .replace('.', '');

interface MonthPoint {
  month: string;
  income: number;
  expense: number;
}

function MonthTip({ active, payload }: { active?: boolean; payload?: readonly { payload?: MonthPoint }[] }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="rounded-control bg-raised px-2.5 py-1.5 text-xs shadow-popover">
      <p className="mb-0.5 text-muted">{point.month}</p>
      <p className="tabular-nums">Entradas: {money(point.income)}</p>
      <p className="tabular-nums">Saídas: {money(point.expense)}</p>
    </div>
  );
}

function SixMonths() {
  const current = todayString().slice(0, 7);
  const months = Array.from({ length: CHART_MONTHS }, (_, index) =>
    shiftMonth(current, index + 1 - CHART_MONTHS)
  );
  const reports = useQueries({
    queries: months.map((month) => ({
      queryKey: ['reports.month', { month }],
      queryFn: () => call('reports.month', { month }),
    })),
  });
  // Mês que falhou fica de fora; os outros continuam valendo.
  const points: MonthPoint[] = reports.flatMap((report, index) =>
    report.data
      ? [
          {
            month: monthName(months[index]!),
            income: report.data.incomeCents,
            expense: report.data.expenseCents,
          },
        ]
      : []
  );
  if (points.every((point) => point.income === 0 && point.expense === 0)) return null;
  return (
    <div className="mt-3 h-[150px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} barGap={2} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis
            dataKey="month"
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'var(--subtle-foreground)', fontSize: 11 }}
          />
          <Tooltip content={MonthTip} cursor={{ fill: 'var(--hover)' }} />
          <Legend
            iconType="circle"
            iconSize={7}
            align="right"
            verticalAlign="top"
            height={22}
            formatter={(value) => <span className="text-[11px] text-muted">{value}</span>}
          />
          <Bar
            dataKey="income"
            name="Entradas"
            fill="var(--chart-1)"
            radius={[3, 3, 0, 0]}
            maxBarSize={12}
            isAnimationActive={false}
          />
          <Bar
            dataKey="expense"
            name="Saídas"
            fill="var(--chart-2)"
            radius={[3, 3, 0, 0]}
            maxBarSize={12}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function BankLine() {
  const { data } = useRpc('bank.status');
  if (!data?.configured || (!data.pendingCount && !data.lastError)) return null;
  return (
    <Link to="/financas" className="mt-3 flex items-center gap-2 text-xs text-muted hover:text-foreground">
      <Landmark size={13} />
      {data.lastError
        ? 'O banco não sincronizou.'
        : `${data.pendingCount} ${data.pendingCount === 1 ? 'movimento' : 'movimentos'} do banco para conferir`}
    </Link>
  );
}

export function FinanceCard() {
  const query = useRpc('plus.available');
  return (
    <HomeCard icon={Wallet} title="Finanças do mês" to="/financas" module="Finanças">
      <Loaded query={query}>
        {(data) =>
          !data.hasAccounts ? (
            <Empty
              icon={Wallet}
              title="Nenhuma conta ainda"
              text="Com uma conta, aparece quanto dá para gastar."
              action="Criar conta"
              to="/financas"
            />
          ) : (
            <>
              <p className="text-xs text-muted">Disponível hoje</p>
              <p
                className={cn(
                  'text-2xl font-semibold tabular-nums',
                  data.availableCents < 0 && 'text-danger'
                )}
              >
                {money(data.availableCents)}
              </p>
              <p className="text-xs text-muted tabular-nums">
                {data.availableCents > 0
                  ? `Até ${money(data.dailyAllowanceCents)} por dia`
                  : 'Comprometido além do saldo'}
              </p>
              <SixMonths />
              <BankLine />
            </>
          )
        }
      </Loaded>
    </HomeCard>
  );
}
