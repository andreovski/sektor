import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { MessageSquarePlus, Search, SendHorizontal, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { call, useRpc, useRpcMutation } from '../../lib/rpc';
import { Button, Card, cn, EmptyState, PageHeader, Select, Textarea } from '../../ui';

import { AiText, PROVIDER_INFO } from './shared';

const EXAMPLES = [
  'Quanto gastei com mercado no mês passado?',
  'O que tenho na agenda esta semana?',
  'Quais tarefas vencem nos próximos 7 dias?',
  'Qual conta tem mais saldo agora?',
];

const when = (at: number) =>
  new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(at);

type Conversation = Awaited<ReturnType<typeof call<'ai.chat.get'>>>;

function Thread({
  conversation,
  pending,
}: {
  conversation: Conversation | null;
  pending: string | null;
}) {
  const end = useRef<HTMLDivElement>(null);
  const count = (conversation?.messages.length ?? 0) + (pending ? 1 : 0);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [count, conversation?.id]);
  return (
    <div className="flex flex-col gap-3">
      {conversation?.messages.map((message) =>
        message.role === 'user' ? (
          <p
            key={message.id}
            className="max-w-[80%] self-end rounded-panel bg-primary/15 px-3 py-2 text-sm whitespace-pre-wrap"
          >
            {message.text}
          </p>
        ) : (
          <div key={message.id} className="flex max-w-[90%] flex-col gap-1 self-start">
            <p className="rounded-panel border border-line bg-surface px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap">
              <AiText text={message.text} />
            </p>
            <p className="flex flex-wrap items-center gap-1 text-xs text-subtle">
              {message.tools.length > 0 && (
                <>
                  <Search size={11} /> Consultou {message.tools.join(', ')} ·
                </>
              )}{' '}
              {message.model} · {when(message.createdAt)}
            </p>
          </div>
        )
      )}
      {pending && (
        <>
          <p className="max-w-[80%] self-end rounded-panel bg-primary/15 px-3 py-2 text-sm whitespace-pre-wrap">
            {pending}
          </p>
          <p className="self-start text-sm text-muted">Consultando os seus dados…</p>
        </>
      )}
      <div ref={end} />
    </div>
  );
}

function AssistantPage() {
  const client = useQueryClient();
  const status = useRpc('ai.status');
  const list = useRpc('ai.chat.list');
  const remove = useRpcMutation('ai.chat.delete');
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [text, setText] = useState('');
  // A pergunta em andamento e a conversa dela (null: nova). Trocar de conversa não a perde.
  const [pending, setPending] = useState<{ text: string; conversationId: string | null } | null>(null);
  const [chosen, setChosen] = useState('');
  const viewing = useRef<string | null>(null);
  viewing.current = currentId;

  useEffect(() => {
    if (!currentId) {
      setConversation(null);
      return;
    }
    let live = true;
    void call('ai.chat.get', { id: currentId }).then(
      (found) => live && setConversation(found),
      () => live && setCurrentId(null)
    );
    return () => {
      live = false;
    };
  }, [currentId]);

  const data = status.data;
  if (!data) return null;
  const models = data.models;
  const modelId = chosen || data.resolved.assistant.modelId;
  const model = models.find((m) => m.id === modelId);

  const send = async (question: string) => {
    const value = question.trim();
    if (!value || pending || model?.problem) return;
    const from = currentId;
    setPending({ text: value, conversationId: from });
    setText('');
    try {
      const next = await call('ai.chat.send', { conversationId: from, text: value, modelId });
      // Só mostra a resposta se a pessoa continua na conversa de onde perguntou.
      if (viewing.current === from) {
        setConversation(next);
        setCurrentId(next.id);
      }
      void client.invalidateQueries({ queryKey: ['ai.chat.list'] });
      void client.invalidateQueries({ queryKey: ['ai.calls'] });
    } catch (error) {
      toast.error((error as Error).message);
      if (viewing.current === from) setText(value);
    } finally {
      setPending(null);
    }
  };

  const header = (
    <PageHeader
      icon={Sparkles}
      title="Assistente"
      description="Pergunte sobre os seus dados. Ele só consulta, não muda nada."
      actions={
        models.length > 1 ? (
          <Select
            aria-label="Modelo"
            className="h-8 w-auto text-xs"
            value={modelId ?? ''}
            onChange={(event) => setChosen(event.target.value)}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {PROVIDER_INFO[m.provider].short} · {m.model}
              </option>
            ))}
          </Select>
        ) : null
      }
    />
  );

  if (models.length === 0) {
    return (
      <>
        {header}
        <Card>
          <EmptyState
            icon={Sparkles}
            title="Escolha um modelo primeiro"
            text="O assistente usa o modelo que você configurar, local ou com a sua chave."
            action={
              <Link to="/ajustes" search={{ secao: 'ia' } as never}>
                <Button variant="primary">Abrir Ajustes › IA</Button>
              </Link>
            }
          />
        </Card>
      </>
    );
  }

  return (
    <>
      {header}
      <div className="grid grid-cols-[220px_minmax(0,1fr)] items-start gap-6">
        <aside className="sticky top-8 flex flex-col gap-1">
          <Button
            className="mb-2 justify-start"
            onClick={() => {
              setCurrentId(null);
              setText('');
            }}
          >
            <MessageSquarePlus size={14} /> Nova conversa
          </Button>
          {list.data?.map((item) => (
            <div
              key={item.id}
              className={cn(
                'group flex items-center gap-1 rounded-control text-sm',
                item.id === currentId ? 'bg-active' : 'hover:bg-hover'
              )}
            >
              <button
                type="button"
                onClick={() => setCurrentId(item.id)}
                className="min-w-0 flex-1 truncate px-2 py-1.5 text-left"
                title={item.title}
              >
                {item.title}
              </button>
              <button
                type="button"
                aria-label={`Apagar ${item.title}`}
                disabled={pending?.conversationId === item.id}
                onClick={() =>
                  remove.mutate(
                    { id: item.id },
                    { onSuccess: () => item.id === currentId && setCurrentId(null) }
                  )
                }
                className="mr-1 hidden rounded-control p-1 text-muted group-hover:block hover:text-danger"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <p className="mt-3 px-2 text-xs text-subtle">As conversas somem 30 dias depois da última mensagem.</p>
        </aside>

        <section className="flex min-h-[60vh] flex-col gap-4 pb-28">
          {!conversation && pending?.conversationId !== null ? (
            <Card>
              <p className="mb-3 text-sm text-muted">
                Ele lê só as áreas liberadas para{' '}
                {model ? `${PROVIDER_INFO[model.provider].short} · ${model.model}` : 'o modelo'} em Ajustes › IA.
                Tente:
              </p>
              <div className="flex flex-col gap-1.5">
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    disabled={Boolean(model?.problem) || Boolean(pending)}
                    onClick={() => void send(example)}
                    className="rounded-control border border-line px-3 py-2 text-left text-sm hover:bg-hover disabled:opacity-50"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </Card>
          ) : (
            <Thread
              conversation={conversation}
              pending={pending && pending.conversationId === currentId ? pending.text : null}
            />
          )}

          <div className="sticky bottom-24 flex items-end gap-2 rounded-panel border border-line bg-raised p-2 shadow-popover">
            <Textarea
              rows={2}
              value={text}
              maxLength={2000}
              placeholder={model?.problem ?? 'Pergunte algo, como “quanto gastei com Uber em outubro?”'}
              disabled={Boolean(model?.problem)}
              className="min-h-0 flex-1 resize-none border-0 bg-transparent"
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send(text);
                }
              }}
            />
            <Button
              variant="primary"
              aria-label="Enviar"
              disabled={!text.trim() || Boolean(pending) || Boolean(model?.problem)}
              onClick={() => void send(text)}
            >
              <SendHorizontal size={14} />
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}

export const routes = [{ path: '/assistente', component: AssistantPage }];
