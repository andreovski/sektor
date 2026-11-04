import { ImageIcon, Keyboard, LogIn, PanelTop, Zap } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { QuickCaptureSettings } from '../../../preload/api';
import { Button, Card, cn, Select } from '../../ui';
import { QUICK_START_KEY, QUICK_WALLPAPER_KEY } from '../quick-capture';

// Ajustes › Atalhos: o atalho global da captura rápida, gravado com o teclado, e como ela abre.

const MODIFIERS = [
  { key: 'ctrlKey', accelerator: 'Control', symbol: '⌃' },
  { key: 'altKey', accelerator: 'Alt', symbol: '⌥' },
  { key: 'shiftKey', accelerator: 'Shift', symbol: '⇧' },
  { key: 'metaKey', accelerator: 'Command', symbol: '⌘' },
] as const;

const KEY_SYMBOLS: Record<string, string> = {
  Space: 'Espaço',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
  Enter: '↩',
  Tab: '⇥',
  Backspace: '⌫',
};

/** Do sistema ou do próprio Sektor: o macOS ou o app ficariam sem eles. */
const RESERVED: Record<string, string> = {
  'Command+Space': 'do Spotlight',
  'Control+Space': 'da troca de idioma do teclado',
  'Command+Tab': 'da troca de apps',
  'Command+Q': 'do Sair',
  'Command+W': 'do Fechar janela',
  'Command+H': 'do Ocultar',
  'Command+M': 'do Minimizar',
};

/** A tecla pelo lugar dela no teclado: com ⌥ apertado, `key` viria como ç, å ou ∑. */
function keyOf(code: string) {
  if (code === 'Space') return 'Space';
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1]!;
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return digit[1]!;
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
  const arrow = /^Arrow(Up|Down|Left|Right)$/.exec(code);
  if (arrow) return arrow[1]!;
  if (code === 'Enter' || code === 'Tab' || code === 'Backspace') return code;
  return null;
}

/** `Alt+Space` vira `⌥ Espaço`, na ordem do macOS. */
export function shortcutLabel(accelerator: string) {
  const parts = accelerator.split('+');
  const mods = MODIFIERS.filter((m) => parts.includes(m.accelerator)).map((m) => m.symbol);
  const key = parts.find((part) => !MODIFIERS.some((m) => m.accelerator === part));
  return [...mods, key ? (KEY_SYMBOLS[key] ?? key) : '…'].join(' ');
}

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Sem armazenamento, volta ao padrão na próxima vez.
  }
}

const api = () => window.sektor.quickCapture;

function Recorder({ current, onDone }: { current: string; onDone(problem: string | null): void }) {
  const [recording, setRecording] = useState(false);
  const [held, setHeld] = useState('');
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (!recording) return;
    void api().pause(true);
    const stop = async (accelerator: string | null) => {
      setRecording(false);
      setHeld('');
      let problem: string | null = null;
      if (accelerator) {
        const result = await api().setShortcut(accelerator);
        if (!result.ok) problem = result.message;
      }
      await api().pause(false);
      done.current(problem);
    };
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') return void stop(null);
      const mods = MODIFIERS.filter((m) => event[m.key]).map((m) => m.accelerator);
      const key = keyOf(event.code);
      if (!key) return setHeld(mods.join('+'));
      if (!mods.some((m) => m !== 'Shift')) {
        setHeld('');
        return done.current('Use pelo menos uma tecla entre ⌘, ⌥ e ⌃, para não atrapalhar o que você digita.');
      }
      const accelerator = [...mods, key].join('+');
      const owner = RESERVED[accelerator];
      if (owner) {
        setHeld('');
        return done.current(`${shortcutLabel(accelerator)} já é ${owner}. Escolha outra combinação.`);
      }
      void stop(accelerator);
    };
    const onUp = (event: KeyboardEvent) => {
      setHeld(MODIFIERS.filter((m) => event[m.key]).map((m) => m.accelerator).join('+'));
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onUp, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onUp, true);
      // Gravou ou cancelou: o atalho em vigor volta a abrir a janela.
      void api().pause(false);
    };
  }, [recording]);

  // Saiu da tela no meio da gravação: o atalho de antes volta a valer.
  useEffect(() => () => void api().pause(false), []);

  return (
    <div className="flex items-center gap-2">
      <kbd
        aria-live="polite"
        className={cn(
          'min-w-[112px] rounded-control border bg-sunken px-3 py-1 text-center font-mono text-sm',
          recording ? 'border-primary text-primary ring-2 ring-primary/20' : 'border-line-strong'
        )}
      >
        {recording ? (held ? shortcutLabel(held) : 'Aperte o atalho') : shortcutLabel(current)}
      </kbd>
      <Button
        size="sm"
        onClick={() => {
          if (!recording) onDone(null);
          setRecording(!recording);
        }}
      >
        {recording ? 'Cancelar' : 'Gravar'}
      </Button>
    </div>
  );
}

export function ShortcutsSettings() {
  const [settings, setSettings] = useState<QuickCaptureSettings | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [start, setStart] = useState(() => read(QUICK_START_KEY) ?? 'last');
  const [wallpaper, setWallpaper] = useState(() => read(QUICK_WALLPAPER_KEY) !== 'off');
  const reload = () => void api().settings().then(setSettings);
  useEffect(reload, []);

  if (!settings) return null;
  const row = 'flex items-center gap-3 border-t border-line pt-4 text-sm';
  return (
    <Card className="flex flex-col gap-4">
      <label className="flex items-center gap-3 text-sm">
        <Zap size={16} className="shrink-0 text-muted" />
        <span className="flex-1">
          Captura rápida
          <span className="block text-xs text-subtle">
            O campo da Início por cima de qualquer app, mesmo com o Sektor em segundo plano.
          </span>
        </span>
        <input
          type="checkbox"
          data-testid="quick-capture-enabled"
          checked={settings.enabled}
          onChange={async (event) => {
            const result = await api().setEnabled(event.target.checked);
            setProblem(result.ok ? null : result.message);
            reload();
          }}
        />
      </label>
      <div className={cn(row, !settings.enabled && 'opacity-50')}>
        <Keyboard size={16} className="shrink-0 text-muted" />
        <span className="flex-1">
          Atalho
          <span className="block text-xs text-subtle">
            Clique em Gravar e aperte a combinação nova. Esc cancela.
          </span>
        </span>
        <Recorder
          current={settings.accelerator}
          onDone={(next) => {
            setProblem(next);
            reload();
          }}
        />
      </div>
      {(problem || (settings.enabled && !settings.active)) && (
        <p role="alert" className="-mt-2 pl-7 text-xs text-warning">
          {problem ?? 'Outro app ficou com esse atalho. Grave outra combinação.'}
        </p>
      )}
      <label className={row}>
        <PanelTop size={16} className="shrink-0 text-muted" />
        <span className="flex-1">
          Abrir na aba
          <span className="block text-xs text-subtle">A última que você usou, ou sempre a mesma.</span>
        </span>
        <Select
          aria-label="Aba de abertura"
          value={start}
          onChange={(event) => {
            setStart(event.target.value);
            write(QUICK_START_KEY, event.target.value);
          }}
          className="h-8 w-auto py-0 text-sm"
        >
          <option value="last">Última usada</option>
          <option value="task">Tarefa</option>
          <option value="note">Nota</option>
          <option value="agent">Agente</option>
        </Select>
      </label>
      <label className={row}>
        <ImageIcon size={16} className="shrink-0 text-muted" />
        <span className="flex-1">
          Wallpaper no fundo do campo
          <span className="block text-xs text-subtle">A imagem da capa entra de leve pelo canto.</span>
        </span>
        <input
          type="checkbox"
          checked={wallpaper}
          onChange={(event) => {
            setWallpaper(event.target.checked);
            write(QUICK_WALLPAPER_KEY, event.target.checked ? 'on' : 'off');
          }}
        />
      </label>
      <label className={row}>
        <LogIn size={16} className="shrink-0 text-muted" />
        <span className="flex-1">
          Abrir o Sektor ao iniciar o Mac
          <span className="block text-xs text-subtle">
            Sem o app rodando na barra de menus, o atalho não responde.
          </span>
        </span>
        <input
          type="checkbox"
          checked={settings.openAtLogin}
          onChange={async (event) => {
            await window.sektor.setOpenAtLogin(event.target.checked);
            reload();
          }}
        />
      </label>
    </Card>
  );
}
