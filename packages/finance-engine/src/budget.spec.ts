import { describe, expect, it } from 'vitest';

import { budgetLevel } from './budget';

describe('budgetLevel', () => {
  it.each([
    [0, 100, 'ok'],
    [79, 100, 'ok'],
    [80, 100, 'warn'],
    [99, 100, 'warn'],
    [100, 100, 'over'],
    [150, 100, 'over'],
  ])('%i de %i é %s', (spent, limit, level) => {
    expect(budgetLevel(spent, limit)).toBe(level);
  });
});
