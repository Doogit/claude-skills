// Live SQLite checks, opened read-only: tableCounts reads counts; groupCounts reads operator-selected id/enum values.
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const LIST = "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name";
const quote = (name) => `"${name.replaceAll('"', '""')}"`;

/**
 * { table: rowCount } for every table in the database at `file`.
 * Uses Node's built-in node:sqlite, or better-sqlite3 resolved from `sqliteModule` (a package.json
 * or directory of a project that has it installed) when given.
 */
function open(file, sqliteModule) {
  if (sqliteModule) {
    const from = sqliteModule.endsWith(".json") ? sqliteModule : path.join(sqliteModule, "package.json");
    const Database = createRequire(path.resolve(from))("better-sqlite3");
    return new Database(file, { readonly: true, fileMustExist: true });
  }
  return new DatabaseSync(file, { readOnly: true });
}

// Above this many distinct values a column is probably free text, so its values are not printed.
const MAX_GROUPS = 200;

/**
 * { value: rowCount } for an operator-selected id/enum/status `table.column`.
 * Refuses more than MAX_GROUPS distinct values or values ambiguous as object keys.
 */
export function groupCounts(file, spec, sqliteModule) {
  const [table, column] = spec.split(".");
  const db = open(file, sqliteModule);
  try {
    if (!db.prepare(LIST).all().some((r) => r.name === table)) throw new Error(`groups: no table ${table}`);
    if (!db.prepare(`SELECT name FROM pragma_table_info(?)`).all(table).some((r) => r.name === column))
      throw new Error(`groups: no column ${column} in ${table}`);
    const distinct = Number(db.prepare(`SELECT COUNT(DISTINCT ${quote(column)}) AS n FROM ${quote(table)}`).get().n);
    if (distinct > MAX_GROUPS)
      throw new Error(`groups: ${spec} has ${distinct} distinct values (max ${MAX_GROUPS}); use an id/enum column`);
    const counts = new Map();
    for (const r of db.prepare(`SELECT ${quote(column)} AS v, COUNT(*) AS n FROM ${quote(table)} GROUP BY 1 ORDER BY 1`).all()) {
      const key = r.v == null ? "(null)" : String(r.v);
      if (counts.has(key)) throw new Error(`groups: ${spec} has ambiguous value ${JSON.stringify(key)} after string conversion`);
      counts.set(key, Number(r.n));
    }
    return Object.fromEntries(counts);
  } finally {
    db.close();
  }
}

export function tableCounts(file, sqliteModule) {
  const db = open(file, sqliteModule);
  try {
    return Object.fromEntries(db.prepare(LIST).all().map(({ name }) => [
      name, Number(db.prepare(`SELECT COUNT(*) AS n FROM ${quote(name)}`).get().n),
    ]));
  } finally {
    db.close();
  }
}
