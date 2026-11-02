// Sem dependências: a tela usa a mesma conta do núcleo para o relógio.

export interface ClockState {
  startedAt: number;
  endedAt: number | null;
  pausedAt: number | null;
  pausedUntil: number | null;
  pausedMs: number;
}

/** A pausa curta tem fim marcado: passado ele, o relógio volta a andar sem ninguém gravar nada. */
export function pauseSpentMs(state: ClockState, now: number) {
  if (state.pausedAt === null) return state.pausedMs;
  const end = Math.min(state.endedAt ?? now, state.pausedUntil ?? Infinity);
  return state.pausedMs + Math.max(0, end - state.pausedAt);
}

export const isPaused = (state: ClockState, now: number) =>
  state.pausedAt !== null && (state.pausedUntil === null || now < state.pausedUntil);

export function focusSecondsAt(state: ClockState, now: number) {
  const end = state.endedAt ?? now;
  return Math.max(0, Math.floor((end - state.startedAt - pauseSpentMs(state, now)) / 1000));
}
