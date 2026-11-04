import { type Editor } from '@tiptap/core';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import { Markdown } from '@tiptap/markdown';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Code, Heading2, Italic, type LucideIcon, Quote, Strikethrough } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { cn } from '../index';

import { type SlashState, SlashMenu, slashCommands } from './slash';
import './rich-text.css';

// As notas continuam guardadas em Markdown: o editor lê e escreve o mesmo texto de antes.
// Sem links, imagens e HTML, para nada de fora entrar na tela (o esquema do editor descarta o resto).
function extensions(placeholder: string | undefined) {
  return [
    StarterKit.configure({
      link: false,
      underline: false,
      heading: { levels: [1, 2, 3] },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({ placeholder: placeholder ?? 'Escreva, ou digite "/" para blocos' }),
    // `breaks`: texto antigo, escrito numa caixa simples, tem quebras de linha soltas.
    Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
  ];
}

/** Markdown do editor, sem o espaço que ele deixa no fim e com nota vazia virando texto vazio. */
const markdownOf = (editor: Editor) => (editor.isEmpty ? '' : editor.getMarkdown().trimEnd());

type Variant = 'page' | 'field';

export interface RichTextEditorProps {
  value: string;
  onChange(markdown: string): void;
  onBlur?(): void;
  placeholder?: string;
  autoFocus?: boolean;
  variant?: Variant;
  /** Altura mínima em linhas, como o `rows` da caixa de texto. */
  rows?: number;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  id?: string;
}

function MarkButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'grid size-7 place-items-center rounded-control',
        active ? 'bg-active text-foreground' : 'text-muted hover:bg-hover hover:text-foreground'
      )}
    >
      <Icon size={14} />
    </button>
  );
}

/** A barrinha que aparece ao selecionar texto. Os atalhos de sempre valem também (⌘B, ⌘I…). */
function Toolbar({ editor }: { editor: Editor }) {
  const marks = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      strike: current.isActive('strike'),
      code: current.isActive('code'),
      heading: current.isActive('heading', { level: 2 }),
      quote: current.isActive('blockquote'),
    }),
  });
  const run = () => editor.chain().focus();
  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: 'top' }}
      shouldShow={({ editor: current, from, to }) =>
        from !== to && !current.isActive('codeBlock') && current.isEditable
      }
      className="z-50 flex items-center gap-0.5 rounded-control border border-line-strong bg-raised p-0.5 shadow-popover"
    >
      <MarkButton icon={Bold} label="Negrito (⌘B)" active={marks.bold} onClick={() => run().toggleBold().run()} />
      <MarkButton icon={Italic} label="Itálico (⌘I)" active={marks.italic} onClick={() => run().toggleItalic().run()} />
      <MarkButton
        icon={Strikethrough}
        label="Riscado (⌘⇧S)"
        active={marks.strike}
        onClick={() => run().toggleStrike().run()}
      />
      <MarkButton icon={Code} label="Código (⌘E)" active={marks.code} onClick={() => run().toggleCode().run()} />
      <span className="mx-0.5 h-4 w-px bg-line-strong" />
      <MarkButton
        icon={Heading2}
        label="Título"
        active={marks.heading}
        onClick={() => run().toggleHeading({ level: 2 }).run()}
      />
      <MarkButton icon={Quote} label="Citação" active={marks.quote} onClick={() => run().toggleBlockquote().run()} />
    </BubbleMenu>
  );
}

/**
 * Editor de notas no estilo Notion: Markdown ao digitar (`# `, `- `, `[] `, `> `, ```),
 * "/" para escolher o bloco e formatação ao selecionar. Lê e devolve Markdown.
 */
export function RichTextEditor({
  value,
  onChange,
  onBlur,
  placeholder,
  autoFocus,
  variant = 'field',
  rows = 3,
  className,
  id,
  ...aria
}: RichTextEditorProps) {
  const [slash, setSlash] = useState<SlashState | null>(null);
  const keyHandler = useRef<((event: KeyboardEvent) => boolean) | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  // O último texto que saiu daqui: o que chega igual a ele é eco, não troca de conteúdo.
  const emitted = useRef(value);
  const callbacks = useRef({ onChange, onBlur });
  callbacks.current = { onChange, onBlur };

  const editor = useEditor({
    extensions: [...extensions(placeholder), slashCommands(setSlash, keyHandler)],
    content: value,
    contentType: 'markdown',
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        class: cn('rich-text', variant === 'page' ? 'rich-text-page' : 'rich-text-field'),
        role: 'textbox',
        'aria-multiline': 'true',
        ...(id ? { id } : {}),
        ...(aria['aria-label'] ? { 'aria-label': aria['aria-label'] } : {}),
        ...(aria['aria-labelledby'] ? { 'aria-labelledby': aria['aria-labelledby'] } : {}),
      },
    },
    onUpdate: ({ editor: current }) => {
      const markdown = markdownOf(current);
      emitted.current = markdown;
      callbacks.current.onChange(markdown);
    },
    onBlur: () => callbacks.current.onBlur?.(),
  });

  // O `autofocus` do Tiptap roda antes de o editor estar na página: aqui ele já está.
  useEffect(() => {
    if (!autoFocus) return;
    const frameId = requestAnimationFrame(() => editor.commands.focus('end'));
    return () => cancelAnimationFrame(frameId);
  }, [editor, autoFocus]);

  // Conteúdo trocado por fora (outro registro no mesmo formulário, por exemplo).
  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false });
  }, [editor, value]);

  return (
    <div
      ref={frame}
      className={cn(
        'relative min-w-0',
        variant === 'field' &&
          'field-line px-0.5 py-1.5 text-sm text-foreground',
        className
      )}
      style={variant === 'field' ? { minHeight: `calc(${rows} * 1.5em + 1rem + 2px)` } : undefined}
      onMouseDown={(event) => {
        // Clique no espaço vazio do quadro põe o cursor no fim, como numa caixa de texto.
        if (event.target === event.currentTarget) {
          event.preventDefault();
          editor.commands.focus('end');
        }
      }}
    >
      <EditorContent editor={editor} />
      <Toolbar editor={editor} />
      {slash && <SlashMenu state={slash} container={frame.current} keyHandler={keyHandler} />}
    </div>
  );
}

/** Nota só para ler, com a mesma aparência do editor. */
export function RichTextView({ source, className }: { source: string; className?: string }) {
  const editor = useEditor({
    extensions: extensions(undefined),
    content: source,
    contentType: 'markdown',
    editable: false,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: { attributes: { class: 'rich-text rich-text-view' } },
  });
  useEffect(() => {
    editor.commands.setContent(source, { contentType: 'markdown', emitUpdate: false });
  }, [editor, source]);
  return <EditorContent editor={editor} className={cn('min-w-0 text-sm', className)} />;
}

/**
 * Campo de notas de formulário. Não é um `<label>` como o `Field`: dentro de um label, o clique
 * no texto iria para o primeiro botão da barra de formatação.
 */
export function NoteField({
  label,
  ...props
}: Omit<RichTextEditorProps, 'variant' | 'aria-labelledby'> & { label: string }) {
  const labelId = useId();
  return (
    <div className="flex flex-col gap-1">
      <span id={labelId} className="font-mono text-[10px] tracking-[0.12em] text-subtle uppercase">
        {label}
      </span>
      <RichTextEditor {...props} variant="field" aria-labelledby={labelId} />
    </div>
  );
}
