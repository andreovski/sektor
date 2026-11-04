import { useNavigate } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';

import { setWallpaper } from '../../lib/theme';
import {
  registerUnsplashUse,
  saveUnsplashKey,
  searchUnsplash,
  type UnsplashPhoto,
  unsplashLink,
  useUnsplashKey,
} from '../../lib/unsplash';
import { extractTones } from '../../lib/wallpaper';
import { Button, Card, Dialog, Field, Input } from '../../ui';

const mask = (value: string) => `${value.slice(0, 4)}••••${value.slice(-4)}`;

/** A chave do Unsplash fica em Integrações; a busca em Aparência só funciona com ela. */
export function UnsplashSettings() {
  const saved = useUnsplashKey();
  const [key, setKey] = useState('');
  return (
    <Card className="flex flex-col gap-3 text-sm">
      <p className="text-muted">
        Com a sua chave, a busca de fotos aparece em Aparência › Wallpaper da capa. Crie um app
        grátis em{' '}
        <a
          href="https://unsplash.com/oauth/applications"
          target="_blank"
          rel="noreferrer"
          className="text-primary underline"
        >
          unsplash.com/developers
        </a>{' '}
        e copie a Access Key dele. Ela fica só neste computador.
      </p>
      {saved ? (
        <div className="flex items-center justify-between gap-3 rounded-control border border-line bg-sunken px-3 py-2">
          <span>
            Chave salva <code className="text-muted">{mask(saved)}</code>
          </span>
          <Button
            onClick={() => {
              saveUnsplashKey('');
              toast.success('Chave do Unsplash removida.');
            }}
          >
            Remover
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            saveUnsplashKey(key.trim());
            setKey('');
            toast.success('Chave salva. A busca já está em Aparência.');
          }}
        >
          <Field label="Access Key do Unsplash">
            <Input
              value={key}
              data-testid="unsplash-key"
              onChange={(event) => setKey(event.target.value)}
            />
          </Field>
          <div>
            <Button type="submit" variant="primary" disabled={!key.trim()}>
              Salvar chave
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

export function UnsplashDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const key = useUnsplashKey();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [photos, setPhotos] = useState<UnsplashPhoto[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const search = async (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    setBusy('search');
    try {
      setPhotos(await searchUnsplash(query.trim(), key));
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const choose = async (photo: UnsplashPhoto) => {
    setBusy(photo.id);
    try {
      const tones = await extractTones(photo.thumb);
      setWallpaper({
        id: `unsplash-${photo.id}`,
        src: photo.full,
        thumb: photo.thumb,
        tones,
        credit: photo.credit,
      });
      registerUnsplashUse(photo, key);
      onClose();
    } catch {
      toast.error('Não consegui ler as cores dessa foto.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()} title="Buscar no Unsplash">
      <div className="flex flex-col gap-3">
        <form onSubmit={(event) => void search(event)} className="flex gap-2">
          <Input
            autoFocus
            value={query}
            placeholder="céu, montanha, abstrato…"
            onChange={(event) => setQuery(event.target.value)}
            className="flex-1"
          />
          <Button type="submit" variant="primary" disabled={busy === 'search' || !query.trim()}>
            <Search size={15} />
            Buscar
          </Button>
        </form>
        {photos && !photos.length && (
          <p className="py-6 text-center text-sm text-muted">Nada encontrado para essa busca.</p>
        )}
        {photos && photos.length > 0 && (
          <div className="grid grid-cols-3 gap-2" data-testid="unsplash-results">
            {photos.map((photo) => (
              <button
                key={photo.id}
                type="button"
                disabled={busy !== null}
                onClick={() => void choose(photo)}
                title={`${photo.description} · ${photo.credit.name}`}
                className="group relative aspect-[16/10] overflow-hidden rounded-control border border-line hover:border-primary disabled:opacity-60"
              >
                <img src={photo.thumb} alt={photo.description} className="size-full object-cover" />
                <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1.5 py-0.5 text-left text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                  {busy === photo.id ? 'Lendo as cores…' : photo.credit.name}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between text-xs text-subtle">
          <a href={unsplashLink} target="_blank" rel="noreferrer" className="underline">
            Fotos do Unsplash
          </a>
          <button
            type="button"
            className="underline hover:text-foreground"
            onClick={() => {
              onClose();
              void navigate({ to: '/ajustes', search: { secao: 'unsplash' } as never });
            }}
          >
            Chave do Unsplash
          </button>
        </div>
      </div>
    </Dialog>
  );
}
