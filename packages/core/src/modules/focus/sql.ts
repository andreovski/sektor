import { sql } from 'drizzle-orm';

import type { Ctx } from '../../services/context';

// Tabelas de outros módulos são lidas por SQL, e podem ainda não existir.
export function columnsOf(ctx: Ctx, table: string): Set<string> {
  const rows = ctx.db.all<{ name: string }>(
    sql`SELECT name FROM pragma_table_info(${table})`
  );
  return new Set(rows.map((row) => row.name));
}

export const textList = (values: string[]) =>
  sql.join(
    values.map((value) => sql`${value}`),
    sql`, `
  );
