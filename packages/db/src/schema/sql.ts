import { sql, type SQL } from "drizzle-orm";

function quoteSqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function sqlTextEnum(values: readonly string[]): SQL {
  return sql.raw(values.map(quoteSqlLiteral).join(", "));
}

export function sqlTextArray(values: readonly string[]): SQL {
  return sql.raw(`ARRAY[${values.map(quoteSqlLiteral).join(", ")}]::text[]`);
}
