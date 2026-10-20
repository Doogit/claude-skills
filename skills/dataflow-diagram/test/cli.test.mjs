import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmdirSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// The skill may be installed as a junction/symlink to a checkout; the CLI must still run through that path.
test("dfd.mjs runs when called through a linked folder", () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "dfd-link-"));
  const link = path.join(tmp, "skill");
  symlinkSync(root, link, "junction");
  try {
    const r = spawnSync(process.execPath, [path.join(link, "dfd.mjs")], { encoding: "utf8" });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /usage: dfd\.mjs/);
  } finally {
    // Remove only the link (a junction needs rmdir on Windows, a symlink needs unlink elsewhere), never the folder
    // it points at; skip the folder delete if the link is still there.
    (process.platform === "win32" ? rmdirSync : unlinkSync)(link);
    if (!existsSync(link)) rmSync(tmp, { recursive: true });
  }
});
