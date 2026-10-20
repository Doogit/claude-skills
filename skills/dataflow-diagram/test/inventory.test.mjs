import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildInventory } from "../dfd.mjs";
import { sqlTables } from "../adapters/generic.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, "fixtures", "ts-mini");

test("ts-mini inventory equals the hand-written expected inventory", () => {
  const expected = JSON.parse(readFileSync(path.join(fixture, "expected-inventory.json"), "utf8"));
  const inv = buildInventory(fixture);
  for (const key of Object.keys(expected)) {
    assert.deepEqual(inv[key], expected[key], `inventory.${key}`);
  }
});

test("dropped tables are not stores", () => {
  const inv = buildInventory(fixture);
  assert.ok(!inv.stores.some((s) => s.id === "table:old_cache"));
});

test("SQL DDL ignores comments and strings, spans lines, and follows statement order", () => {
  const files = [{
    rel: "migrations/001.sql", ext: "sql", lines: [
      "/* CREATE TABLE ghost (id INTEGER);",
      "   DROP TABLE live; */",
      "SELECT 'CREATE TABLE quoted_ghost (id INTEGER); -- literal';",
      'CREATE VIEW "CREATE TABLE view_ghost" AS SELECT 1;',
      "CREATE",
      "  TABLE live (note TEXT DEFAULT 'a; -- b'); DROP TABLE live;",
      "CREATE",
      "  TABLE survivor (id INTEGER);",
      "CREATE TABLE final (id INTEGER);",
    ],
  }];
  assert.deepEqual([...sqlTables(files)], [["survivor", { file: "migrations/001.sql", line: 7 }], ["final", { file: "migrations/001.sql", line: 9 }]]);
});
