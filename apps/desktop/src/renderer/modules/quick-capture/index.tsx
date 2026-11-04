import { Check, CornerDownLeft } from 'lucide-react';
import { type MouseEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useWallpaper } from '../../lib/theme';
import { AiText } from '../ai/shared';
import { Dots, type HomeAssistant, ProposalCard, turnsOf, useHomeAssistant } from '../home/assistant';
import { HomeCapture } from '../home/capture';
import { PixelField } from '../home/cover';
import { type CaptureSaved, CaptureSurface } from '../home/surface';

// A captura rápida: o campo da Início numa janela solta, aberta pelo atalho global por cima de
// qualquer app. Tarefa e Nota confirmam e fecham sozinhas; o Agente responde embaixo do campo.

export const QUICK_MODE_KEY = 'sektor.quick.capture';
/** Aba de abertura: a última usada (`last`) ou uma fixa. */
export const QUICK_START_KEY = 'sektor.quick.start';
/** `off` tira o wallpaper do fundo do campo. */
export const QUICK_WALLPAPER_KEY = 'sektor.quick.wallpaper';

/** Fechada por mais que isso, a janela volta limpa: sem rascunho velho e com conversa nova. */
const STALE_MS = 10 * 60_000;
/** Espaço embaixo do campo para um menu aberto caber na janela. */
const MENU_ROOM = 320;
/** Quanto a confirmação fica na tela antes de a janela fechar. */
const CONFIRM_MS = 1200;

type StartMode = 'task' | 'note' | 'agent';

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function readPrefs() {
  const start = read(QUICK_START_KEY);
  return {
    startMode: start === 'task' || start === 'note' || start === 'agent' ? (start as StartMode) : undefined,
    wallpaper: read(QUICK_WALLPAPER_KEY) !== 'off',
  };
}

const api = () => window.sektor.quickCapture;

// O aviso de "apareceu" chega do main uma vez por janela; quem responde é a tela montada agora.
let onShown = () => {};
let listening = false;
function listenShown() {
  if (listening) return;
  listening = true;
  api().onShown(() => onShown());
}

function focusField(root: HTMLElement | null) {
  root?.querySelector<HTMLInputElement>('input:not([type="file"]):not(:disabled)')?.focus();
}

/** O fundo do campo: a cor do tema e o wallpaper da capa entrando pelo canto de cima. */
function Backdrop({ wallpaper: show }: { wallpaper: boolean }) {
  const wallpaper = useWallpaper();
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[22px] bg-raised">
      {show &&
        ('src' in wallpaper ? (
          <img src={wallpaper.src} alt="" className="quick-wallpaper absolute inset-0 size-full object-cover" />
        ) : (
          // A capa de pixels, a mesma da Início, também entra pelo canto.
          <div className="quick-wallpaper quick-pixels absolute inset-0">
            <PixelField />
          </div>
        ))}
      {show && <div className="quick-wallpaper-veil absolute inset-0" />}
    </div>
  );
}

/** Confirmação no próprio campo: o que foi salvo, e uma barra que esvazia até fechar. */
function Confirmed({ saved, onOpen }: { saved: CaptureSaved; onOpen(): void }) {
  return (
    <div role="status" className="capture-box relative w-[760px] max-w-full rounded-[22px] border border-line-strong px-4 py-3.5 shadow-popover">
      <div className="flex items-center gap-2.5 text-[15px]">
        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-success text-on-primary">
          <Check size={12} strokeWidth={3.5} />
        </span>
        <span className="min-w-0 flex-1 truncate">{saved.summary}</span>
        <button type="button" onClick={onOpen} className="h-6 shrink-0 rounded-full px-2.5 text-[13px] text-primary">
          Abrir no Sektor ⌘↩
        </button>
      </div>
      <div className="mt-3 h-0.5 overflow-hidden rounded-full bg-line">
        <div className="quick-drain h-full bg-success" style={{ animationDuration: `${CONFIRM_MS}ms` }} />
      </div>
    </div>
  );
}

/** O Agente na captura rápida: a última resposta, sem a linha do tempo. */
function QuickAnswer({ assistant, onOpen }: { assistant: HomeAssistant; onOpen(): void }) {
  const last = turnsOf(assistant.conversation?.messages ?? []).at(-1);
  const pending = assistant.pending;
  const hints = (
    <div className="flex items-center gap-3 pt-2 pb-1 text-xs text-subtle">
      <span>↩ pergunta</span>
      <span>⌥1 ⌥2 ⌥3 trocam a aba</span>
      <span className="quick-chip ml-auto">Esc fecha</span>
    </div>
  );
  if (!pending && !last?.answer) return hints;
  const question = pending ? pending.text : last!.question;
  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-line pt-3 pr-2 pb-1">
      {question && (
        <p className="truncate text-[13px] text-muted">
          <span className="mr-1.5 text-primary">›</span>
          {question}
        </p>
      )}
      {pending ? (
        <div className="flex items-center gap-2.5 py-1 text-sm text-muted">
          <Dots /> Consultando os seus dados…
        </div>
      ) : (
        <div className="flex max-h-[320px] flex-col gap-2 overflow-y-auto">
          <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-foreground/90">
            <AiText text={last!.answer!.text} />
          </p>
          {last!.answer!.proposals.map((proposal) => (
            <ProposalCard
              key={proposal.id}
              proposal={proposal}
              onChange={assistant.updateProposal}
              onReload={assistant.reload}
            />
          ))}
        </div>
      )}
      <div className="flex items-center gap-3 text-xs text-subtle">
        <span>Esc fecha</span>
        <button type="button" onClick={onOpen} className="ml-auto inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-primary">
          Continuar no Sektor ⌘
          <CornerDownLeft size={11} />
        </button>
      </div>
    </div>
  );
}

function QuickCapturePage() {
  const assistant = useHomeAssistant();
  const [round, setRound] = useState(0);
  const [saved, setSaved] = useState<CaptureSaved | null>(null);
  const [prefs, setPrefs] = useState(readPrefs);
  const frame = useRef<HTMLDivElement>(null);
  const hiddenAt = useRef<number | null>(null);

  useLayoutEffect(() => {
    document.documentElement.dataset.window = 'quick';
  }, []);

  // Onde o "Abrir no Sektor" leva, conforme o que está na tela.
  const route = () => {
    if (saved) return saved.route;
    const mode = read(QUICK_MODE_KEY) ?? 'task';
    if (mode === 'agent') return assistant.currentId ? `/?conversa=${assistant.currentId}` : '/';
    return mode === 'note' ? '/projetos' : '/tarefas';
  };
  const openInApp = () => void api().openInApp(route());
  const hide = () => void api().hide();

  const latest = useRef({ openInApp, hide, saved, newChat: assistant.newChat });
  latest.current = { openInApp, hide, saved, newChat: assistant.newChat };

  useEffect(() => {
    listenShown();
    onShown = () => {
      const stale = hiddenAt.current !== null && Date.now() - hiddenAt.current > STALE_MS;
      hiddenAt.current = null;
      const next = readPrefs();
      setPrefs(next);
      setSaved(null);
      // Com aba fixa em Ajustes, toda abertura começa nela.
      if (stale || next.startMode) setRound((value) => value + 1);
      if (stale) latest.current.newChat();
      requestAnimationFrame(() => focusField(frame.current));
    };
    const onBlur = () => {
      hiddenAt.current = Date.now();
      setSaved(null);
    };
    // Na captura, antes do React: ⌘↩ não pode virar um envio do campo.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        latest.current.hide();
      } else if (event.key === 'Enter' && event.metaKey) {
        event.preventDefault();
        event.stopPropagation();
        latest.current.openInApp();
      } else if (latest.current.saved && !event.metaKey) {
        // Começou a escrever durante a confirmação: fica aberta para a próxima.
        setSaved(null);
      }
    };
    window.addEventListener('blur', onBlur);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);

  // A janela acompanha a altura do campo, que cresce com a resposta do Agente. Um menu aberto
  // (o projeto da nota, o modelo) sai do campo: a janela ganha espaço embaixo enquanto ele existe.
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const fit = () => {
      const menu = document.querySelector('[data-radix-popper-content-wrapper]');
      void api().resize(element.offsetHeight + (menu ? MENU_ROOM : 0));
    };
    const size = new ResizeObserver(fit);
    size.observe(element);
    const menus = new MutationObserver(fit);
    menus.observe(document.body, { childList: true });
    return () => {
      size.disconnect();
      menus.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!saved) {
      requestAnimationFrame(() => focusField(frame.current));
      return;
    }
    const timer = setTimeout(() => {
      hide();
      setSaved(null);
    }, CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [saved]);

  // Link de dentro da resposta (uma proposta salva, por exemplo) abre no app, não aqui.
  const keepLinksInApp = (event: MouseEvent) => {
    const link = (event.target as Element).closest?.('a[href^="#/"]');
    if (!link) return;
    event.preventDefault();
    void api().openInApp(link.getAttribute('href')!.slice(1));
  };

  return (
    <div ref={frame} className="flex justify-center px-[30px] pt-4 pb-12" onClickCapture={keepLinksInApp}>
      <div className="relative isolate w-[760px] max-w-full">
        <Backdrop wallpaper={prefs.wallpaper} />
        {saved ? (
          <Confirmed saved={saved} onOpen={openInApp} />
        ) : (
          <CaptureSurface.Provider
            value={{
              floating: true,
              modeKey: QUICK_MODE_KEY,
              startMode: prefs.startMode,
              onSaved: setSaved,
              agentFooter: <QuickAnswer assistant={assistant} onOpen={openInApp} />,
            }}
          >
            <HomeCapture key={round} assistant={assistant} />
          </CaptureSurface.Provider>
        )}
      </div>
    </div>
  );
}

export const routes = [{ path: '/captura-rapida', component: QuickCapturePage }];
