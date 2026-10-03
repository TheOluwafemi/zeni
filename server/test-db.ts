// A D1 stand-in for tests, backed by Node's built-in SQLite (the same engine D1 runs on).
// It applies the real migrations, so tests exercise the real schema and SQL.

import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { Db } from "./accounts";

export function testDb(): Db {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync("migrations").filter((f) => f.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(`migrations/${file}`, "utf8"));
  }

  // D1 accepts numbered parameters (?1, ?2); node:sqlite only binds those by name. Translate ?N to :pN.
  const prepared = (sql: string, values: SQLInputValue[]) => ({
    stmt: sqlite.prepare(sql.replace(/\?(\d+)/g, ":p$1")),
    params: Object.fromEntries(values.map((v, i) => [`p${i + 1}`, v])),
  });

  const statement = (sql: string, values: SQLInputValue[] = []) => ({
    bind: (...v: unknown[]) => statement(sql, v as SQLInputValue[]),
    first: async <T>() => {
      const { stmt, params } = prepared(sql, values);
      return (stmt.get(params) as T | undefined) ?? null;
    },
    run: async () => {
      const { stmt, params } = prepared(sql, values);
      return stmt.run(params);
    },
  });
  return { prepare: (sql) => statement(sql) };
}
