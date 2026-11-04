import { Search } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';

import { setWallpaper } from '../../lib/theme';
import {
  readUnsplashKey,
  registerUnsplashUse,
  saveUnsplashKey,
  searchUnsplash,
  type UnsplashPhoto,
  unsplashLink,
} from '../../lib/unsplash';
import { extractTones } from '../../lib/wallpaper';
import { Button, Dialog, Field, Input } from '../../ui';

/** Sem chave salva, o diálogo pede uma antes de buscar. */
function KeyForm({ onSaved }: { onSaved(key: string): void }) {
  const [key, setKey] = useState('');
  return (
    <form
      className="flex flex-col gap-3 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        saveUnsplashKey(key.trim());
        onSaved(key.trim());
      }}
    >
      <p className="text-muted">
        Para buscar fotos, crie um app grátis em{' '}
        <a
          href="https://unsplash.com/oauth/applications"
          target="_blank"
          rel="noreferrer"
          className="text-primary underline"
        >
          unsplash.com/developers
        </a>{' '}
        e cole aqui a Access Key dele. Ela fica só neste computador.
      </p>
      <Field label="Access Key do Unsplash">
        <Input value={key} onChange={(event) => setKey(event.target.value)} autoFocus />
      </Field>
      <div>
        <Button type="submit" variant="primary" disabled={!key.trim()}>
          Salvar chave
        </Button>
      </div>
    </form>
  );
}

export function UnsplashDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const [key, setKey] = useState(readUnsplashKey);
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
      {!key ? (
        <KeyForm onSaved={setKey} />
      ) : (
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
                saveUnsplashKey('');
                setKey('');
                setPhotos(null);
              }}
            >
              Trocar a chave
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
