import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildInventory } from "../dfd.mjs";

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
