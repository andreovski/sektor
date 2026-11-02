import { eventOccurrences } from '@sektor/finance-engine';

import { AppError } from '../../services/context';

export function assertRRule(rrule: string | null | undefined) {
  if (!rrule) return;
  try {
    const now = new Date();
    eventOccurrences(rrule, now, now, new Date(now.getTime() + 86_400_000), 'UTC');
  } catch {
    throw new AppError(400, 'Regra de repetição inválida.');
  }
}
