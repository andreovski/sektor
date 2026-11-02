import { useRouterState } from '@tanstack/react-router';
import { Plus, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useRpc } from '../../lib/rpc';
import { Button, PageHeader, Segmented } from '../../ui';
import { AccountsTab } from './accounts';
import { BudgetsTab } from './budgets';
import { ForecastTab } from './forecast';
import { AvailableToday, DebtsTab, ImportButton, RulesTab } from './plus';
import { ReviewTab } from './review';
import { StatementTab } from './statement';
import { TransactionDialogProvider, useTransactionDialog } from './transaction-dialog';

const TABS = ['hoje', 'extrato', 'previsao', 'orcamentos', 'contas', 'revisar', 'dividas', 'regras'] as const;
type Tab = (typeof TABS)[number];

const LABELS: Record<Tab, string> = {
  hoje: 'Hoje',
  extrato: 'Extrato',
  previsao: 'Previsão',
  orcamentos: 'Orçamentos',
  contas: 'Contas',
  revisar: 'Revisar',
  dividas: 'Dívidas',
  regras: 'Regras',
};

function NewTransactionButton() {
  const dialog = useTransactionDialog();
  return (
    <Button variant="primary" onClick={() => dialog.create()}>
      <Plus size={14} /> Lançamento
    </Button>
  );
}

function FinancePage() {
  // Outra tela pode abrir uma aba direto: /financas?aba=revisar.
  const wanted = useRouterState({
    select: (state) => TABS.find((t) => t === (state.location.search as { aba?: string }).aba),
  });
  const [tab, setTab] = useState<Tab>(wanted ?? 'hoje');
  useEffect(() => {
    if (wanted) setTab(wanted);
  }, [wanted]);
  const [panel, setPanel] = useState<'accounts' | 'banks' | 'categories'>('accounts');
  const pending = useRpc('bank.status').data?.pendingCount ?? 0;

  return (
    <TransactionDialogProvider>
      <PageHeader
        icon={Wallet}
        title="Finanças"
        actions={
          <>
            <ImportButton />
            <NewTransactionButton />
          </>
        }
      />
      <div className="mb-5">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={TABS.map((value) => ({
            value,
            label: value === 'revisar' && pending > 0 ? `Revisar (${pending})` : LABELS[value],
          }))}
        />
      </div>
      {tab === 'hoje' && <AvailableToday />}
      {tab === 'extrato' && <StatementTab />}
      {tab === 'previsao' && <ForecastTab />}
      {tab === 'orcamentos' && <BudgetsTab />}
      {tab === 'contas' && <AccountsTab panel={panel} onPanel={setPanel} />}
      {tab === 'revisar' && (
        <ReviewTab
          onOpenBanks={() => {
            setPanel('banks');
            setTab('contas');
          }}
        />
      )}
      {tab === 'dividas' && <DebtsTab />}
      {tab === 'regras' && <RulesTab />}
    </TransactionDialogProvider>
  );
}

export const routes = [{ path: '/financas', component: FinancePage }];
