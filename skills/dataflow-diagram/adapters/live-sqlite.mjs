// Live check for SQLite: row counts per table, opened read-only. Never reads row contents.
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
 * { value: rowCount } for `table.column` — e.g. recs per detector id. Only for id/enum/status columns:
 * refuses a column with more than MAX_GROUPS distinct values. Values are cut to 64 characters.
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
    const out = {};
    for (const r of db.prepare(`SELECT ${quote(column)} AS v, COUNT(*) AS n FROM ${quote(table)} GROUP BY 1 ORDER BY 1`).all())
      out[r.v == null ? "(null)" : String(r.v).slice(0, 64)] = Number(r.n);
    return out;
  } finally {
    db.close();
  }
}

export function tableCounts(file, sqliteModule) {
  const db = open(file, sqliteModule);
  try {
    const counts = {};
    for (const { name } of db.prepare(LIST).all()) {
      counts[name] = Number(db.prepare(`SELECT COUNT(*) AS n FROM ${quote(name)}`).get().n);
    }
    return counts;
  } finally {
    db.close();
  }
}
