import { useNavigate } from '@tanstack/react-router';
import { Check, HardDrive, ImagePlus, Layers, type LucideIcon, Monitor, Moon, Sun } from 'lucide-react';
import { type CSSProperties, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  PALETTES,
  setCoverEverywhere,
  setPalette,
  setTheme,
  setWallpaper,
  setWallpaperAccent,
  type ThemeChoice,
  toneVars,
  useCoverEverywhere,
  usePalette,
  useThemeChoice,
  useWallpaper,
} from '../../lib/theme';
import { unsplashLink, useUnsplashKey } from '../../lib/unsplash';
import { extractTones, PRESETS, readLocalImage, swatchColor } from '../../lib/wallpaper';
import { Card, cn } from '../../ui';

import { UnsplashDialog } from './unsplash';

const THEMES: { value: ThemeChoice; label: string; icon: LucideIcon }[] = [
  { value: 'dark', label: 'Escuro', icon: Moon },
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'system', label: 'Sistema', icon: Monitor },
];

const PREVIEW_CARDS = ['w-3/5', 'w-2/5', 'w-1/2', 'w-2/3', 'w-1/3', 'w-1/2'];

/** A tela Início em esqueleto, pintada com as cores da paleta do card em volta. */
function HomePreview({ image }: { image?: string }) {
  return (
    <span
      aria-hidden
      className="relative flex aspect-[16/10] w-full flex-col overflow-hidden rounded-[0.375rem] border border-line bg-background"
      style={{ backgroundImage: 'var(--app-backdrop)' }}
    >
      {image ? (
        <img
          src={image}
          alt=""
          className="absolute inset-x-0 top-0 h-2/5 w-full object-cover [mask-image:linear-gradient(black_40%,transparent)]"
        />
      ) : (
        <span className="palette-preview-cover absolute inset-x-0 top-0 h-2/5" />
      )}
      <span className="relative flex flex-col items-center gap-1 pt-[13%] pb-[7%]">
        <span className="h-1.5 w-2/5 rounded-full bg-foreground/85" />
        <span className="h-1 w-1/4 rounded-full bg-muted/60" />
        <span className="mt-1 flex h-2.5 w-3/5 items-center justify-end rounded-full border border-line-strong bg-surface px-0.5">
          <span className="size-1.5 rounded-full bg-primary" />
        </span>
      </span>
      <span className="relative grid flex-1 grid-cols-3 gap-1 px-1.5 pb-1.5">
        {PREVIEW_CARDS.map((width, index) => (
          <span
            key={index}
            className="flex flex-col justify-between rounded-[3px] border border-line bg-surface p-1"
          >
            <span className={cn('h-0.5 rounded-full bg-subtle/70', width)} />
            <span
              className={cn(
                'h-1 rounded-full',
                index === 0 ? 'w-full bg-primary' : index === 4 ? 'w-3/4 bg-secondary' : 'w-1/2 bg-line-strong'
              )}
            />
          </span>
        ))}
      </span>
    </span>
  );
}

const tile = (active: boolean) =>
  cn(
    'group relative flex flex-col gap-1.5 rounded-control border p-1.5 text-left text-xs font-medium transition-[border-color,box-shadow] disabled:opacity-60',
    active ? 'border-primary ring-1 ring-primary' : 'border-line-strong hover:border-primary'
  );

/** Escolher um wallpaper lê as cores dele antes de trocar, para a paleta já vir junto. */
function Wallpapers() {
  const wallpaper = useWallpaper();
  const [loading, setLoading] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const unsplashKey = useUnsplashKey();
  const navigate = useNavigate();
  const fromUnsplash = wallpaper.id.startsWith('unsplash-') && 'thumb' in wallpaper;
  const fromComputer = wallpaper.id === 'local' && 'thumb' in wallpaper;
  const choose = async (id: string, src: string) => {
    setLoading(id);
    try {
      setWallpaper({ id, src, thumb: src, tones: await extractTones(src) });
    } catch {
      toast.error('Não consegui ler as cores dessa imagem.');
    } finally {
      setLoading(null);
    }
  };
  const chooseFile = async (file: File | undefined) => {
    if (!file) return;
    setLoading('local');
    try {
      const { src, thumb } = await readLocalImage(file);
      setWallpaper({ id: 'local', src, thumb, tones: await extractTones(thumb) });
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setLoading(null);
      if (picker.current) picker.current.value = '';
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <span className="text-sm font-medium">Wallpaper da capa</span>
      <div role="radiogroup" aria-label="Wallpaper" className="grid grid-cols-4 gap-3">
        <button
          type="button"
          role="radio"
          aria-checked={wallpaper.id === 'pixels'}
          data-testid="wallpaper-pixels"
          onClick={() => setWallpaper({ id: 'pixels' })}
          className={tile(wallpaper.id === 'pixels')}
        >
          <span className="relative aspect-[16/10] overflow-hidden rounded-[0.375rem] bg-background">
            <span className="palette-preview-cover absolute inset-0" />
          </span>
          <span className="truncate px-0.5">Pixels</span>
        </button>
        {PRESETS.map(({ id, label, src }) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={wallpaper.id === id}
            data-testid={`wallpaper-${id}`}
            disabled={loading !== null}
            onClick={() => void choose(id, src)}
            className={tile(wallpaper.id === id)}
          >
            <img
              src={src}
              alt=""
              loading="lazy"
              className="aspect-[16/10] w-full rounded-[0.375rem] object-cover"
            />
            <span className="truncate px-0.5">{loading === id ? 'Lendo…' : label}</span>
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={fromComputer}
          data-testid="wallpaper-local"
          disabled={loading !== null}
          onClick={() => picker.current?.click()}
          className={tile(fromComputer)}
        >
          {fromComputer ? (
            <img
              src={wallpaper.thumb}
              alt=""
              className="aspect-[16/10] w-full rounded-[0.375rem] object-cover"
            />
          ) : (
            <span className="grid aspect-[16/10] place-items-center rounded-[0.375rem] border border-dashed border-line-strong text-muted group-hover:text-primary">
              <HardDrive size={18} />
            </span>
          )}
          <span className="truncate px-0.5">{loading === 'local' ? 'Lendo…' : 'Arquivo'}</span>
        </button>
        <input
          ref={picker}
          type="file"
          accept="image/*"
          hidden
          data-testid="wallpaper-file"
          onChange={(event) => void chooseFile(event.target.files?.[0])}
        />
        <button
          type="button"
          role="radio"
          aria-checked={fromUnsplash}
          data-testid="wallpaper-unsplash"
          title={unsplashKey ? undefined : 'Configure a chave em Integrações › Unsplash'}
          onClick={() =>
            unsplashKey
              ? setSearching(true)
              : void navigate({ to: '/ajustes', search: { secao: 'unsplash' } as never })
          }
          className={tile(fromUnsplash)}
        >
          {fromUnsplash ? (
            <img
              src={wallpaper.thumb}
              alt=""
              className="aspect-[16/10] w-full rounded-[0.375rem] object-cover"
            />
          ) : (
            <span className="grid aspect-[16/10] place-items-center rounded-[0.375rem] border border-dashed border-line-strong text-muted group-hover:text-primary">
              <ImagePlus size={18} />
            </span>
          )}
          <span className="truncate px-0.5">Unsplash</span>
        </button>
      </div>
      {'tones' in wallpaper && <Suggestions swatches={wallpaper.tones.swatches} />}
      {'credit' in wallpaper && wallpaper.credit && (
        <p className="text-xs text-subtle">
          Foto de{' '}
          <a href={wallpaper.credit.url} target="_blank" rel="noreferrer" className="underline">
            {wallpaper.credit.name}
          </a>{' '}
          no{' '}
          <a
            href={unsplashLink}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Unsplash
          </a>
        </p>
      )}
      <UnsplashDialog open={searching} onClose={() => setSearching(false)} />
    </div>
  );
}

/** As cores marcantes do wallpaper; a escolhida vira a primária da paleta Do wallpaper. */
function Suggestions({ swatches }: { swatches: { l: number; c: number; h: number }[] }) {
  const wallpaper = useWallpaper();
  const palette = usePalette();
  const accent = 'tones' in wallpaper ? wallpaper.tones.accentH : null;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-muted">Cor principal sugerida</span>
      <div role="radiogroup" aria-label="Cor principal" className="flex gap-2">
        {swatches.map((swatch) => {
          const active = palette === 'wallpaper' && accent === swatch.h;
          return (
            <button
              key={swatch.h}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`Matiz ${Math.round(swatch.h)}`}
              onClick={() => setWallpaperAccent(swatch)}
              className={cn(
                'grid size-7 place-items-center rounded-full border-2 transition-transform hover:scale-110',
                active ? 'border-foreground' : 'border-transparent'
              )}
              style={{ background: swatchColor(swatch) }}
            >
              {active && <Check size={14} className="text-[oklch(0.2_0.02_0)]" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Appearance() {
  const theme = useThemeChoice();
  const palette = usePalette();
  const coverEverywhere = useCoverEverywhere();
  const wallpaper = useWallpaper();
  return (
    <Card className="flex flex-col gap-4">
      <div role="radiogroup" aria-label="Tema" className="grid grid-cols-3 gap-3">
        {THEMES.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={theme === value}
            data-testid={`theme-${value}`}
            onClick={() => setTheme(value)}
            className={cn(
              'flex h-12 items-center justify-center gap-2 rounded-control border text-sm font-medium transition-colors',
              theme === value
                ? 'border-primary/40 bg-primary/15 text-primary'
                : 'border-line bg-sunken text-muted hover:bg-hover hover:text-foreground'
            )}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>
      <Wallpapers />
      <div role="radiogroup" aria-label="Paleta" className="grid grid-cols-3 gap-3">
        {'tones' in wallpaper && (
          <button
            type="button"
            role="radio"
            aria-checked={palette === 'wallpaper'}
            data-palette="wallpaper"
            data-testid="palette-wallpaper"
            onClick={() => setPalette('wallpaper')}
            style={toneVars(wallpaper.tones) as CSSProperties}
            className={cn(
              'flex flex-col gap-2 rounded-control border bg-background p-2 text-left text-sm font-medium text-foreground transition-[border-color,box-shadow]',
              palette === 'wallpaper' ? 'border-primary ring-1 ring-primary' : 'border-line-strong hover:border-primary'
            )}
          >
            <HomePreview image={wallpaper.thumb} />
            <span className="flex items-center gap-2 px-1 pb-0.5">
              <span aria-hidden className="flex -space-x-1">
                <span className="size-3.5 rounded-full border-2 border-background bg-primary" />
                <span className="size-3.5 rounded-full border-2 border-background bg-secondary" />
              </span>
              Do wallpaper
            </span>
          </button>
        )}
        {PALETTES.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={palette === value}
            data-palette={value}
            data-testid={`palette-${value}`}
            onClick={() => setPalette(value)}
            className={cn(
              'flex flex-col gap-2 rounded-control border bg-background p-2 text-left text-sm font-medium text-foreground transition-[border-color,box-shadow]',
              palette === value ? 'border-primary ring-1 ring-primary' : 'border-line-strong hover:border-primary'
            )}
          >
            <HomePreview />
            <span className="flex items-center gap-2 px-1 pb-0.5">
              <span aria-hidden className="flex -space-x-1">
                <span className="size-3.5 rounded-full border-2 border-background bg-primary" />
                <span className="size-3.5 rounded-full border-2 border-background bg-secondary" />
              </span>
              {label}
            </span>
          </button>
        ))}
      </div>
      <label className="flex items-center gap-3 border-t border-line pt-4 text-sm">
        <Layers size={16} className="shrink-0 text-muted" />
        <span className="flex-1">
          Capa da Início em todos os módulos
          <span className="block text-xs text-subtle">
            Os pixels do topo seguem pelas outras telas, mais apagados.
          </span>
        </span>
        <input
          type="checkbox"
          data-testid="cover-everywhere"
          checked={coverEverywhere}
          onChange={(event) => setCoverEverywhere(event.target.checked)}
        />
      </label>
    </Card>
  );
}
