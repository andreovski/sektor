import { createContext, type ReactNode } from 'react';

/** O que foi salvo na captura rápida, para a confirmação no lugar do toast. */
export interface CaptureSaved {
  kind: 'task' | 'note';
  summary: string;
  /** Onde o item aparece no app, para o "Abrir". */
  route: string;
}

/**
 * Onde o campo da Início está. No Início fica tudo como sempre; na captura rápida a aba lembrada é
 * outra, o que foi salvo vira confirmação e o Agente mostra a resposta embaixo do campo.
 */
export interface CaptureSurfaceValue {
  floating: boolean;
  /** Chave do `localStorage` com a última aba. */
  modeKey: string;
  /** Aba fixa para abrir, no lugar da última usada. */
  startMode?: 'task' | 'note' | 'agent';
  onSaved?(saved: CaptureSaved): void;
  /** No lugar das sugestões, dentro da caixa do Agente. */
  agentFooter?: ReactNode;
}

export const CaptureSurface = createContext<CaptureSurfaceValue>({
  floating: false,
  modeKey: 'sektor.home.capture',
});
