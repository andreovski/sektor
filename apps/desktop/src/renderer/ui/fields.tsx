import { addDays, addMonthsClamped, monthGrid } from '@sektor/core/src/modules/agenda/view';
import clsx from 'clsx';
import { Command } from 'cmdk';
import { Calendar, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, Search } from 'lucide-react';
import { Popover } from 'radix-ui';
import {
  type ChangeEvent,
  Children,
  type ComponentProps,
  createContext,
  Fragment,
  isValidElement,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { twMerge } from 'tailwind-merge';

import { monthLabel, todayString } from '../lib/format';

// Campos do app na direção "Linha": só a linha de baixo, que engrossa na cor da paleta no foco.
// Select e data abrem painéis com os tokens do app, no lugar do menu do macOS e do seletor do Chromium.

const cn = (...inputs: Parameters<typeof clsx>) => twMerge(clsx(inputs));

export const fieldClass =
  'field-line h-8 w-full bg-transparent px-0.5 text-sm text-foreground placeholder:text-subtle disabled:opacity-50';

const popoverClass =
  'popover-in z-50 rounded-xl border border-line bg-raised p-1.5 shadow-popover outline-none';

/** Um `onChange` como o do elemento nativo, para quem usa `event.target.value` não mudar. */
function changeEvent<T extends HTMLElement>(value: string) {
  const target = { value } as unknown as T;
  return { target, currentTarget: target } as ChangeEvent<T>;
}

/** O id do rótulo do `Field` em volta: botão não herda o nome do `<label>` como um input herda. */
const FieldLabel = createContext<string | undefined>(undefined);

function useLabelledBy(rest: Record<string, unknown>, id?: string) {
  const labelId = useContext(FieldLabel);
  const generated = useId();
  const ownId = id ?? generated;
  const aria = Object.fromEntries(
    Object.entries(rest).filter(([key]) => key.startsWith('aria-') || key.startsWith('data-'))
  );
  if (labelId && !aria['aria-label'] && !aria['aria-labelledby']) {
    aria['aria-labelledby'] = `${labelId} ${ownId}`;
  }
  return { ownId, aria };
}

// ——— Input ———

export function Input({ className, ...props }: ComponentProps<'input'>) {
  if (props.type === 'date') return <DateInput className={className} {...props} />;
  if (props.type === 'time') {
    return (
      <span className={cn('field-line relative flex h-8 w-full items-center gap-1.5 px-0.5', className)}>
        <Clock size={13} className="field-icon shrink-0 text-subtle" />
        <input
          {...props}
          className="time-input h-full min-w-0 flex-1 bg-transparent text-sm text-foreground tabular-nums outline-none disabled:opacity-50"
        />
      </span>
    );
  }
  return <input className={cn(fieldClass, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'field-line w-full bg-transparent px-0.5 py-1.5 text-sm text-foreground placeholder:text-subtle disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
}

// ——— Select ———

interface Option {
  value: string;
  label: ReactNode;
  /** O texto do rótulo, para a busca. */
  text: string;
  disabled?: boolean;
  group?: string;
}

const textOf = (node: ReactNode): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
};

type OptionProps = { value?: string | number; children?: ReactNode; disabled?: boolean; label?: string };

/** Lê os `<option>` e `<optgroup>` de sempre, então quem usa o Select não muda. */
function collect(children: ReactNode, group?: string, out: Option[] = []) {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const element = child as ReactElement<OptionProps>;
    if (element.type === Fragment) collect(element.props.children, group, out);
    else if (element.type === 'optgroup') collect(element.props.children, element.props.label, out);
    else if (element.type === 'option') {
      const { value, children: label, disabled } = element.props;
      out.push({ value: String(value ?? textOf(label)), label, text: textOf(label), disabled, group });
    } else if (import.meta.env.DEV) {
      console.warn('Select: só <option>, <optgroup> e fragmentos entram na lista.', element.type);
    }
  });
  return out;
}

const fold = (text: string) =>
  text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Acima disso a lista ganha busca. */
const SEARCH_FROM = 9;

type SelectProps = ComponentProps<'select'>;

export function Select({
  value,
  defaultValue,
  onChange,
  children,
  className,
  disabled,
  id,
  style,
  ...rest
}: SelectProps) {
  const options = collect(children);
  const [inner, setInner] = useState(String(defaultValue ?? options[0]?.value ?? ''));
  const current = value !== undefined ? String(value) : inner;
  // Como no nativo: sem opção com esse valor, aparece a primeira.
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === current)
  );
  const selected = options[selectedIndex];
  const [open, setOpen] = useState(false);
  const searchable = options.length >= SEARCH_FROM;
  const listRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const { ownId, aria: ariaProps } = useLabelledBy(rest, id);

  const choose = (next: string) => {
    setOpen(false);
    if (next === current) return;
    if (value === undefined) setInner(next);
    onChange?.(changeEvent<HTMLSelectElement>(next));
  };

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() =>
      listRef.current?.querySelector('[data-chosen="true"]')?.scrollIntoView({ block: 'nearest' })
    );
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const groups: { name?: string; items: { option: Option; index: number }[] }[] = [];
  options.forEach((option, index) => {
    const last = groups[groups.length - 1];
    if (last && last.name === option.group) last.items.push({ option, index });
    else groups.push({ name: option.group, items: [{ option, index }] });
  });

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          id={ownId}
          disabled={disabled}
          style={style}
          aria-haspopup="listbox"
          {...ariaProps}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setOpen(true);
            }
          }}
          className={cn(fieldClass, 'group flex items-center gap-2 text-left', className)}
        >
          <span className="min-w-0 flex-1 truncate">{selected?.label}</span>
          <ChevronDown
            size={14}
            className="field-icon shrink-0 text-subtle transition-transform duration-200 group-data-[state=open]:rotate-180"
          />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (searchRef.current ?? rootRef.current)?.focus();
          }}
          className={cn(popoverClass, 'w-max min-w-(--radix-popover-trigger-width) max-w-80')}
        >
          <Command
            ref={rootRef}
            tabIndex={-1}
            loop
            defaultValue={`o${selectedIndex}`}
            filter={(_, search, keywords) =>
              fold(keywords?.join(' ') ?? '').includes(fold(search.trim())) ? 1 : 0
            }
            className="outline-none"
          >
            {searchable && (
              <div className="-mx-1.5 -mt-1.5 mb-1 flex items-center gap-2 border-b border-line px-3.5 text-subtle">
                <Search size={14} className="shrink-0" />
                <Command.Input
                  ref={searchRef}
                  placeholder="Buscar"
                  className="h-9 w-full bg-transparent text-[13px] text-foreground outline-none placeholder:text-subtle"
                />
              </div>
            )}
            <Command.List ref={listRef} className="max-h-72 overflow-y-auto">
              <Command.Empty className="px-2 py-2.5 text-[12.5px] text-subtle">
                Nada com esse nome
              </Command.Empty>
              {groups.map((group, groupIndex) => (
                <Command.Group key={groupIndex} heading={group.name}>
                  {group.items.map(({ option, index }) => (
                    <Command.Item
                      key={index}
                      value={`o${index}`}
                      keywords={[option.text]}
                      disabled={option.disabled}
                      data-chosen={index === selectedIndex}
                      onSelect={() => choose(option.value)}
                      className="flex cursor-pointer items-center gap-2.5 rounded-control px-2 py-1.5 text-[13px] text-foreground outline-none data-[disabled=true]:cursor-default data-[disabled=true]:opacity-50 data-[selected=true]:bg-hover"
                    >
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                      <Check
                        size={14}
                        className={cn('shrink-0 text-primary', index !== selectedIndex && 'invisible')}
                      />
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ——— Data ———

const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const DATE_LABEL = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const DATE_LABEL_YEAR = new Intl.DateTimeFormat('pt-BR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const DAY_NAME = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full', timeZone: 'UTC' });

const utc = (key: string) => {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!));
};

function dateLabel(key: string, today: string) {
  if (key === today) return 'Hoje';
  if (key === addDays(today, 1)) return 'Amanhã';
  if (key === addDays(today, -1)) return 'Ontem';
  const format = key.slice(0, 4) === today.slice(0, 4) ? DATE_LABEL : DATE_LABEL_YEAR;
  return format.format(utc(key)).replace(/\./g, '').replace(/ de /g, ' ');
}

const isDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

function DateInput({
  value,
  onChange,
  min,
  max,
  disabled,
  required,
  className,
  id,
  placeholder,
  ...rest
}: ComponentProps<'input'>) {
  const today = todayString();
  const current = isDate(value) ? value : '';
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(current || today);
  const [focus, setFocus] = useState(current || today);
  const gridRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const low = isDate(min) ? min : undefined;
  const high = isDate(max) ? max : undefined;
  const outOfRange = (key: string) => (low !== undefined && key < low) || (high !== undefined && key > high);

  const { ownId, aria: ariaProps } = useLabelledBy(rest, id);

  const choose = (next: string) => {
    setOpen(false);
    triggerRef.current?.focus();
    if (next !== current) onChange?.(changeEvent<HTMLInputElement>(next));
  };

  const onOpenChange = (next: boolean) => {
    if (next) {
      setMonth(current || today);
      setFocus(current || today);
    }
    setOpen(next);
  };

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() =>
      gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focus}"]`)?.focus()
    );
    return () => cancelAnimationFrame(frame);
  }, [open, focus]);

  const move = (event: KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = addDays(focus, step);
    setFocus(next);
    if (next.slice(0, 7) !== month.slice(0, 7)) setMonth(next);
  };

  const shiftMonth = (by: number) => {
    const next = addMonthsClamped(month.slice(0, 7) + '-01', by);
    setMonth(next);
    setFocus(next);
  };

  const shortcuts: [string, string][] = [
    ['Hoje', today],
    ['Amanhã', addDays(today, 1)],
    ['Em uma semana', addDays(today, 7)],
  ];

  return (
    <>
      <Popover.Root open={open} onOpenChange={onOpenChange}>
        <Popover.Trigger asChild>
          <button
            ref={triggerRef}
            type="button"
            id={ownId}
            disabled={disabled}
            {...ariaProps}
            className={cn(fieldClass, 'flex items-center gap-1.5 text-left tabular-nums', className)}
          >
            <Calendar size={13} className="field-icon shrink-0 text-subtle" />
            <span className={cn('min-w-0 flex-1 truncate', !current && 'text-subtle')}>
              {current ? dateLabel(current, today) : (placeholder ?? 'Sem data')}
            </span>
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={6}
            collisionPadding={12}
            onOpenAutoFocus={(event) => event.preventDefault()}
            className={cn(popoverClass, 'w-[280px] p-2.5')}
          >
            <div className="flex items-center justify-between px-0.5 pb-1.5">
              <button
                type="button"
                aria-label="Mês anterior"
                onClick={() => shiftMonth(-1)}
                className="grid size-7 place-items-center rounded-[7px] text-muted hover:bg-hover hover:text-foreground"
              >
                <ChevronLeft size={15} />
              </button>
              <span className="text-[13px] font-medium">{monthLabel(month.slice(0, 7))}</span>
              <button
                type="button"
                aria-label="Próximo mês"
                onClick={() => shiftMonth(1)}
                className="grid size-7 place-items-center rounded-[7px] text-muted hover:bg-hover hover:text-foreground"
              >
                <ChevronRight size={15} />
              </button>
            </div>
            <div ref={gridRef} role="grid" onKeyDown={move} className="grid grid-cols-7 gap-0.5">
              {WEEKDAYS.map((day, index) => (
                <span key={index} className="pb-1 text-center font-mono text-[10px] text-subtle">
                  {day}
                </span>
              ))}
              {monthGrid(month).flat().map((day) => (
                <button
                  key={day}
                  type="button"
                  data-day={day}
                  tabIndex={day === focus ? 0 : -1}
                  disabled={outOfRange(day)}
                  aria-label={DAY_NAME.format(utc(day))}
                  aria-pressed={day === current}
                  onClick={() => choose(day)}
                  className={cn(
                    'h-8 rounded-[7px] text-[12.5px] tabular-nums outline-none transition-colors hover:bg-hover disabled:pointer-events-none disabled:opacity-30',
                    day.slice(0, 7) !== month.slice(0, 7) && 'text-subtle',
                    day === today && 'ring-1 ring-line-strong ring-inset',
                    day === current && 'bg-primary font-semibold text-on-primary hover:bg-primary-hover'
                  )}
                >
                  {Number(day.slice(8))}
                </button>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5 border-t border-line pt-2">
              {shortcuts
                .filter(([, day]) => !outOfRange(day))
                .map(([label, day]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => choose(day)}
                    className="h-6 rounded-full border border-line bg-sunken px-2.5 text-xs text-muted hover:border-line-strong hover:text-foreground"
                  >
                    {label}
                  </button>
                ))}
              {!required && current && (
                <button
                  type="button"
                  onClick={() => choose('')}
                  className="ml-auto h-6 rounded-full px-2 text-xs text-subtle hover:text-foreground"
                >
                  Limpar
                </button>
              )}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {required && (
        // Só para a validação do formulário: se faltar a data, o foco volta para o botão.
        <input
          tabIndex={-1}
          aria-hidden
          required
          value={current}
          onChange={() => {}}
          onFocus={() => triggerRef.current?.focus()}
          className="pointer-events-none absolute size-px opacity-0"
        />
      )}
    </>
  );
}

// ——— Rótulo ———

export function Field({ label, children }: { label: string; children: ReactNode }) {
  const labelId = useId();
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span id={labelId} className="font-mono text-[10px] tracking-[0.12em] text-subtle uppercase">
        {label}
      </span>
      <FieldLabel.Provider value={labelId}>{children}</FieldLabel.Provider>
    </label>
  );
}
