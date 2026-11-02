import { useQueryClient } from '@tanstack/react-query';
import { BookOpen, Search } from 'lucide-react';
import { useDeferredValue, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { longDate, todayString } from '../../lib/format';
import { call, useRpc } from '../../lib/rpc';
import { Card, cn, EmptyState, Input, SectionLabel, Textarea } from '../../ui';

import { DayStepper, dayLabel, Loading, SaveState, useAutosave } from './shared';

function Editor({ date }: { date: string }) {
  const client = useQueryClient();
  const [text, setText] = useState<string | null>(null);
  const { schedule, flush, state } = useAutosave(async (value) => {
    try {
      await call('health.diarySave', { date, text: value });
      await client.invalidateQueries({ queryKey: ['health.diaryList'] });
    } catch (error) {
      toast.error((error as Error).message);
      throw error;
    }
  });

  useEffect(() => {
    let live = true;
    void call('health.diaryGet', { date }).then((entry) => {
      if (live) setText(entry.text);
    });
    return () => {
      live = false;
    };
  }, [date]);

  return (
    <>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-medium">{dayLabel(date)}</h3>
        <SaveState state={state} />
      </div>
      {text === null ? (
        <Loading />
      ) : (
        <Textarea
          aria-label={`Diário de ${dayLabel(date)}`}
          className="min-h-[420px] resize-y leading-relaxed"
          placeholder="Escreva como foi o dia. O texto salva sozinho."
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            schedule(event.target.value);
          }}
          onBlur={flush}
        />
      )}
    </>
  );
}

function Snippet({ text, match }: { text: string; match: { start: number; length: number } | null }) {
  if (!match) return <>{text}</>;
  const end = match.start + match.length;
  return (
    <>
      {text.slice(0, match.start)}
      <mark className="rounded-sm bg-primary/25 text-foreground">{text.slice(match.start, end)}</mark>
      {text.slice(end)}
    </>
  );
}

export function DiaryTab() {
  const [date, setDate] = useState(todayString);
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query.trim());
  const list = useRpc('health.diaryList', { query: deferred });
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[1fr_320px]">
      <Card>
        <div className="mb-3">
          <DayStepper date={date} onChange={setDate} />
        </div>
        <Editor key={date} date={date} />
      </Card>
      <Card>
        <div className="relative mb-3">
          <Search size={14} className="absolute top-2.5 left-2.5 text-subtle" />
          <Input
            aria-label="Buscar no diário"
            className="pl-8"
            placeholder="Buscar no diário"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <SectionLabel>{deferred ? 'Resultados' : 'Dias escritos'}</SectionLabel>
        {!list.data ? (
          <Loading />
        ) : list.data.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title={deferred ? 'Nada encontrado' : 'Diário em branco'}
            text={deferred ? 'Tente outra palavra.' : 'O primeiro dia escrito aparece aqui.'}
          />
        ) : (
          <ul className="flex max-h-[460px] flex-col gap-0.5 overflow-y-auto">
            {list.data.map((entry) => (
              <li key={entry.date}>
                <button
                  type="button"
                  onClick={() => setDate(entry.date)}
                  className={cn(
                    'w-full rounded-control px-2 py-1.5 text-left hover:bg-hover',
                    entry.date === date && 'bg-active'
                  )}
                >
                  <span className="block text-xs text-muted">{longDate(entry.date)}</span>
                  <span className="line-clamp-2 text-sm">
                    <Snippet text={entry.snippet} match={entry.match} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
