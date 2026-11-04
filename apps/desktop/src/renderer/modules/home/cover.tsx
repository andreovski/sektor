import { type CSSProperties, useEffect, useRef } from 'react';

import { useWallpaper } from '../../lib/theme';
import { unsplashLink } from '../../lib/unsplash';
import { cn } from '../../ui';

const CELL = 10;
const GAP = 2;
const FRAME_MS = 45;
const TWINKLE_MS = 1115;

const noise = (x: number, y: number) => {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
};

function draw(canvas: HTMLCanvasElement, time: number) {
  const context = canvas.getContext('2d');
  if (!context) return;
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.globalCompositeOperation = 'source-over';
  context.clearRect(0, 0, width, height);

  const step = CELL + GAP;
  const columns = Math.ceil(width / step);
  const rows = Math.ceil(height / step);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const seed = noise(column, row);
      const x = (column + 0.5) / columns;
      const y = (row + 0.5) / rows;
      // O centro fica mais escuro para a saudação e a caixa de captura lerem bem.
      const center = Math.hypot((x - 0.5) / 0.36, (y - 0.42) / 0.62);
      const quiet = Math.min(1, 0.22 + center * 0.72);
      const twinkle = 0.62 + 0.38 * Math.sin(time / TWINKLE_MS + seed * Math.PI * 2);
      const alpha = (0.12 + seed * seed * 0.78) * quiet * twinkle;
      if (alpha < 0.03) continue;
      context.globalAlpha = alpha;
      context.fillRect(column * step, row * step, CELL, CELL);
    }
  }

  // A cor vem do tema: pinta o degradê só onde já há pixel.
  const styles = getComputedStyle(canvas);
  const gradient = context.createLinearGradient(0, 0, width, height * 0.4);
  gradient.addColorStop(0, styles.getPropertyValue('--cover-from'));
  gradient.addColorStop(1, styles.getPropertyValue('--cover-to'));
  context.globalAlpha = 1;
  context.globalCompositeOperation = 'source-in';
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
}

/** Pixels que cintilam. Só anima à vista, e fica parado com movimento reduzido. */
function PixelField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let last = 0;
    let visible = true;

    const tick = (time: number) => {
      frame = 0;
      if (!visible || motion.matches || document.hidden) return;
      if (time - last >= FRAME_MS) {
        last = time;
        draw(canvas, time);
      }
      frame = requestAnimationFrame(tick);
    };
    const restart = () => {
      draw(canvas, performance.now());
      if (!frame) frame = requestAnimationFrame(tick);
    };

    const resize = new ResizeObserver(restart);
    resize.observe(canvas);
    const sight = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
      if (visible) restart();
    });
    sight.observe(canvas);
    // Parado por movimento reduzido, ainda precisa trocar de cor com o tema.
    const theme = new MutationObserver(restart);
    theme.observe(document.documentElement, { attributeFilter: ['data-theme', 'data-palette'] });
    motion.addEventListener('change', restart);
    document.addEventListener('visibilitychange', restart);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      sight.disconnect();
      theme.disconnect();
      motion.removeEventListener('change', restart);
      document.removeEventListener('visibilitychange', restart);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className="absolute inset-0 size-full" />;
}

/**
 * Sai da largura de `main` até a da área de rolagem. 100vw conta a barra de rolagem,
 * que tem 8 px no tema; daí os 4 px de cada lado.
 */
export function Cover({
  className,
  style,
  trail = false,
}: {
  className?: string;
  style?: CSSProperties;
  /** A cópia atenuada dos outros módulos não repete o crédito da foto. */
  trail?: boolean;
}) {
  const wallpaper = useWallpaper();
  return (
    <div
      aria-hidden
      style={style}
      className={cn(
        'pointer-events-none absolute top-0 left-1/2 h-[430px] w-[calc(100vw-8px)] -translate-x-1/2 overflow-hidden',
        '[mask-image:linear-gradient(to_bottom,black_45%,transparent)]',
        className
      )}
    >
      {'src' in wallpaper ? (
        <>
          <img src={wallpaper.src} alt="" className="absolute inset-0 size-full object-cover" />
          {/* Véu na cor do fundo: a saudação e a captura leem bem em qualquer foto. */}
          <div className="cover-scrim absolute inset-0" />
          {wallpaper.credit && !trail && (
            // O Unsplash pede o fotógrafo e o Unsplash, com link, onde a foto aparece.
            <p className="pointer-events-auto absolute top-9 right-6 text-[11px] text-foreground opacity-35 transition-opacity duration-200 [text-shadow:0_1px_2px_var(--background)] hover:opacity-100 focus-within:opacity-100">
              Foto de{' '}
              <a href={wallpaper.credit.url} target="_blank" rel="noreferrer" className="underline">
                {wallpaper.credit.name}
              </a>{' '}
              no{' '}
              <a href={unsplashLink} target="_blank" rel="noreferrer" className="underline">
                Unsplash
              </a>
            </p>
          )}
        </>
      ) : (
        <PixelField />
      )}
    </div>
  );
}
