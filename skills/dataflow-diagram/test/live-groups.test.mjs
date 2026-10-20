import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { groupCounts, tableCounts } from "../adapters/live-sqlite.mjs";

function fixtureDb(rows) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dfd-groups-"));
  const file = path.join(dir, "db.sqlite");
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE recs (id INTEGER PRIMARY KEY, detector_id TEXT, body TEXT)");
  const ins = db.prepare("INSERT INTO recs (detector_id, body) VALUES (?, ?)");
  for (const [d, b] of rows) ins.run(d, b);
  db.close();
  return { file, done: () => rmSync(dir, { recursive: true }) };
}

test("groupCounts counts rows per value of one column", () => {
  const { file, done } = fixtureDb([["B1", "x"], ["B1", "y"], ["C6", "z"], [null, "w"]]);
  try {
    assert.deepEqual(groupCounts(file, "recs.detector_id"), { B1: 2, C6: 1, "(null)": 1 });
  } finally { done(); }
});

test("groupCounts refuses a column with more than 200 distinct values (likely free text)", () => {
  const { file, done } = fixtureDb(Array.from({ length: 201 }, (_, i) => ["B1", `text ${i}`]));
  try {
    assert.throws(() => groupCounts(file, "recs.body"), /201 distinct values/);
  } finally { done(); }
});

test("groupCounts rejects unknown tables and columns", () => {
  const { file, done } = fixtureDb([["B1", "x"]]);
  try {
    assert.throws(() => groupCounts(file, "nope.detector_id"), /no table/);
    assert.throws(() => groupCounts(file, "recs.nope"), /no column/);
  } finally { done(); }
});

test("groupCounts preserves distinct long IDs and special object keys", () => {
  const prefix = "x".repeat(64);
  const { file, done } = fixtureDb([[prefix + "A", ""], [prefix + "A", ""], [prefix + "B", ""], ["__proto__", ""]]);
  try {
    const groups = groupCounts(file, "recs.detector_id");
    assert.equal(groups[prefix + "A"], 2);
    assert.equal(groups[prefix + "B"], 1);
    assert.equal(groups.__proto__, 1);
    assert.equal(Object.keys(groups).length, 3);
  } finally { done(); }
});

test("groupCounts rejects values that become the same object key", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dfd-groups-collision-"));
  const file = path.join(dir, "db.sqlite");
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE null_values (value);
    INSERT INTO null_values VALUES (NULL), ('(null)');
    CREATE TABLE typed_values (value);
    INSERT INTO typed_values VALUES (1), ('1');`);
  db.close();
  try {
    assert.throws(() => groupCounts(file, "null_values.value"), /ambiguous.*\(null\)/);
    assert.throws(() => groupCounts(file, "typed_values.value"), /ambiguous.*1/);
  } finally { rmSync(dir, { recursive: true }); }
});

test("tableCounts retains a table named __proto__", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dfd-table-names-"));
  const file = path.join(dir, "db.sqlite");
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE "__proto__" (id); INSERT INTO "__proto__" VALUES (1)');
  db.close();
  try {
    const counts = tableCounts(file);
    assert.equal(Object.hasOwn(counts, "__proto__"), true);
    assert.equal(counts.__proto__, 1);
  } finally { rmSync(dir, { recursive: true }); }
});
