import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { groupCounts } from "../adapters/live-sqlite.mjs";

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
