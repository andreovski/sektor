import { type CSSProperties, useLayoutEffect, useState } from 'react';

// O dock flutua 68px acima da base da janela; o bloco termina um pouco antes dele.
const ABOVE_DOCK = 88;
// O `pb-28` da página guarda lugar para o dock; aqui o bloco já desconta isso, então a margem
// negativa devolve a sobra e a página fica sem rolagem (8px de folga para a entrada da aba).
const PAGE_BOTTOM_PAD = 112;
const MIN_HEIGHT = 360;

function scrollParent(element: HTMLElement) {
  let parent = element.parentElement;
  while (parent && !/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) {
    parent = parent.parentElement;
  }
  return parent;
}

/**
 * Estica o elemento até o dock: a página para de rolar, e quem rola é o que está dentro dele.
 * Recebe o elemento por um ref de callback, porque ele pode aparecer só depois do carregamento.
 */
export function useFillHeight(element: HTMLElement | null): CSSProperties | undefined {
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    const scroller = element && scrollParent(element);
    if (!element || !scroller) return;
    const measure = () => {
      const top =
        element.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop;
      setHeight(Math.max(MIN_HEIGHT, scroller.clientHeight - top - ABOVE_DOCK));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [element]);
  return height ? { height, marginBottom: ABOVE_DOCK - PAGE_BOTTOM_PAD - 8 } : undefined;
}
