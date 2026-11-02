// Regras de tela sem dependências: o núcleo testa, e a tela importa daqui.

/** Quem olhava o dia que acabou de passar segue para o novo; quem escolheu outro dia fica nele. */
export function followToday(date: string, previousToday: string, today: string) {
  return date === previousToday ? today : date;
}

interface DatedEvent {
  /** Dia local do evento (AAAA-MM-DD). */
  day: string;
  allDay: boolean;
  startAt: string;
}

/** Por instante, não por texto. Dia inteiro não tem instante: vem primeiro no próprio dia. */
export function byEventStart(a: DatedEvent, b: DatedEvent) {
  return (
    a.day.localeCompare(b.day) ||
    Number(b.allDay) - Number(a.allDay) ||
    new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
  );
}
