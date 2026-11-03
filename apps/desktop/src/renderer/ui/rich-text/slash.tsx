import { type Editor, Extension, type Range } from '@tiptap/core';
import Suggestion, { type SuggestionKeyDownProps } from '@tiptap/suggestion';
import {
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListChecks,
  ListOrdered,
  type LucideIcon,
  Minus,
  Quote,
  Type,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { cn } from '../index';

export interface SlashItem {
  title: string;
  hint: string;
  keywords: string;
  icon: LucideIcon;
  run(editor: Editor, range: Range): void;
}

const chain = (editor: Editor, range: Range) => editor.chain().focus().deleteRange(range);

export const SLASH_ITEMS: SlashItem[] = [
  {
    title: 'Texto',
    hint: 'Parágrafo comum',
    keywords: 'texto paragrafo text',
    icon: Type,
    run: (editor, range) => chain(editor, range).setParagraph().run(),
  },
  {
    title: 'Título 1',
    hint: '# ',
    keywords: 'titulo h1 heading',
    icon: Heading1,
    run: (editor, range) => chain(editor, range).setHeading({ level: 1 }).run(),
  },
  {
    title: 'Título 2',
    hint: '## ',
    keywords: 'titulo h2 heading subtitulo',
    icon: Heading2,
    run: (editor, range) => chain(editor, range).setHeading({ level: 2 }).run(),
  },
  {
    title: 'Título 3',
    hint: '### ',
    keywords: 'titulo h3 heading',
    icon: Heading3,
    run: (editor, range) => chain(editor, range).setHeading({ level: 3 }).run(),
  },
  {
    title: 'Lista',
    hint: '- ',
    keywords: 'lista marcadores bullet',
    icon: List,
    run: (editor, range) => chain(editor, range).toggleBulletList().run(),
  },
  {
    title: 'Lista numerada',
    hint: '1. ',
    keywords: 'lista numerada ordenada numbered',
    icon: ListOrdered,
    run: (editor, range) => chain(editor, range).toggleOrderedList().run(),
  },
  {
    title: 'Lista de tarefas',
    hint: '[] ',
    keywords: 'tarefas checklist todo caixa',
    icon: ListChecks,
    run: (editor, range) => chain(editor, range).toggleTaskList().run(),
  },
  {
    title: 'Citação',
    hint: '> ',
    keywords: 'citacao quote',
    icon: Quote,
    run: (editor, range) => chain(editor, range).setBlockquote().run(),
  },
  {
    title: 'Código',
    hint: '``` ',
    keywords: 'codigo code bloco',
    icon: Code,
    run: (editor, range) => chain(editor, range).setCodeBlock().run(),
  },
  {
    title: 'Divisor',
    hint: '---',
    keywords: 'divisor linha separador hr',
    icon: Minus,
    run: (editor, range) => chain(editor, range).setHorizontalRule().run(),
  },
];

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

export function filterSlash(query: string) {
  const term = fold(query.trim());
  if (!term) return SLASH_ITEMS;
  return SLASH_ITEMS.filter((item) => fold(`${item.title} ${item.keywords}`).includes(term));
}

export interface SlashState {
  items: SlashItem[];
  rect: DOMRect | null;
  pick(item: SlashItem): void;
}

/**
 * O "/" abre o menu de blocos. O menu é desenhado por quem usa o editor (dentro dele, e não no
 * body: num modal do Radix, o que fica fora do modal não recebe clique).
 */
export function slashCommands(
  onState: (state: SlashState | null) => void,
  keyHandler: { current: ((event: KeyboardEvent) => boolean) | null }
) {
  return Extension.create({
    name: 'slashCommands',
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashItem>({
          editor: this.editor,
          char: '/',
          allow: ({ state }) => !state.selection.$from.parent.type.spec.code,
          items: ({ query }) => filterSlash(query),
          command: ({ editor, range, props }) => props.run(editor, range),
          render: () => {
            const show = (props: {
              items: SlashItem[];
              clientRect?: (() => DOMRect | null) | null;
              command(item: SlashItem): void;
            }) =>
              onState({
                items: props.items,
                rect: props.clientRect?.() ?? null,
                pick: (item) => props.command(item),
              });
            return {
              onStart: show,
              onUpdate: show,
              onKeyDown: ({ event }: SuggestionKeyDownProps) => {
                if (event.key === 'Escape') {
                  onState(null);
                  return true;
                }
                return keyHandler.current?.(event) ?? false;
              },
              onExit: () => onState(null),
            };
          },
        }),
      ];
    },
  });
}

/** A lista do "/", posta logo abaixo do cursor e dentro do quadro do editor. */
export function SlashMenu({
  state,
  container,
  keyHandler,
}: {
  state: SlashState;
  container: HTMLElement | null;
  keyHandler: { current: ((event: KeyboardEvent) => boolean) | null };
}) {
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const { items } = state;

  useEffect(() => setActive(0), [items]);

  useEffect(() => {
    keyHandler.current = (event) => {
      if (!items.length) return false;
      if (event.key === 'ArrowDown') {
        setActive((index) => (index + 1) % items.length);
        return true;
      }
      if (event.key === 'ArrowUp') {
        setActive((index) => (index - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        state.pick(items[active]!);
        return true;
      }
      return false;
    };
    return () => {
      keyHandler.current = null;
    };
  }, [items, active, state, keyHandler]);

  useLayoutEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!state.rect || !container) return null;
  const box = container.getBoundingClientRect();
  const below = window.innerHeight - state.rect.bottom > 260;
  const style = below
    ? { top: state.rect.bottom - box.top + 6 }
    : { bottom: box.bottom - state.rect.top + 6 };

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Blocos"
      className="absolute z-50 max-h-64 w-60 overflow-y-auto rounded-panel border border-line-strong bg-raised p-1 shadow-popover"
      style={{ ...style, left: Math.max(0, state.rect.left - box.left) }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {items.length ? (
        items.map((item, index) => (
          <button
            key={item.title}
            type="button"
            role="option"
            data-index={index}
            aria-selected={index === active}
            onMouseEnter={() => setActive(index)}
            onClick={() => state.pick(item)}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-control px-2 py-1.5 text-left text-sm',
              index === active ? 'bg-active text-foreground' : 'text-muted'
            )}
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-control border border-line bg-sunken">
              <item.icon size={14} />
            </span>
            <span className="min-w-0 flex-1 truncate">{item.title}</span>
            <span className="font-mono text-[11px] text-subtle">{item.hint}</span>
          </button>
        ))
      ) : (
        <p className="px-2 py-1.5 text-sm text-subtle">Nenhum bloco com esse nome.</p>
      )}
    </div>
  );
}
