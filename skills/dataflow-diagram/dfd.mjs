#!/usr/bin/env node
// dataflow-diagram CLI: inventory | verify | render. Node 24, no dependencies.
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { walk, sqlTables, storeAccess, uniqueById, EXCLUDED_DIRS } from "./adapters/generic.mjs";
import { tsInventory } from "./adapters/ts.mjs";
import { verifyModel, addLiveHealth, reportMarkdown } from "./lib/verify.mjs";

function gitCommit(repo) {
  if (!existsSync(path.join(repo, ".git"))) return null;
  try {
    return execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

/** Deterministic facts found in code. Never written by the model. */
export function buildInventory(repo) {
  const { files, excludedFiles } = walk(repo);
  const tables = sqlTables(files);
  const access = storeAccess(files, tables);
  const ts = tsInventory(repo, files);
  const stores = [...tables].map(([name, at]) => ({
    id: `table:${name}`,
    kind: "table",
    ...at,
    writes: access.get(name).writes,
    reads: access.get(name).reads,
  }));
  return {
    meta: { repo: path.basename(path.resolve(repo)), commit: gitCommit(repo), generated: new Date().toISOString() },
    excludedDirs: EXCLUDED_DIRS,
    excludedFiles,
    entries: uniqueById(ts.entries),
    stores: uniqueById(stores),
    outside: uniqueById(ts.outside),
    noCallers: uniqueById(ts.noCallers),
  };
}

function parseArgs(argv) {
  const [cmd, repo, ...rest] = argv;
  const opts = {};
  for (let k = 0; k < rest.length; k++) {
    if (!rest[k].startsWith("--")) continue;
    const key = rest[k].slice(2), val = rest[k + 1]?.startsWith("--") ? true : (rest[++k] ?? true);
    // A repeated flag collects its values in an array.
    opts[key] = key in opts ? [].concat(opts[key], val) : val;
  }
  return { cmd, repo, opts };
}

async function main() {
  const { cmd, repo, opts } = parseArgs(process.argv.slice(2));
  if (!cmd || !repo) {
    console.error(
      "usage: dfd.mjs <inventory|verify|render> <repo> [--out <dir>] [--live sqlite --db <path> [--sqlite-module <path>]]\n" +
        "       dfd.mjs groups <db.sqlite> --by <table.column> [--by …] [--sqlite-module <path>]",
    );
    process.exit(2);
  }
  const out = path.resolve(opts.out ?? path.join(repo, "docs", "dataflow"));
  const writeJson = (name, data) => writeFileSync(path.join(out, name), JSON.stringify(data, null, 2) + "\n");
  if (cmd === "verify") {
    const modelPath = path.join(out, "model.json");
    if (!existsSync(modelPath)) {
      console.error(`verify: ${modelPath} not found; write the model first`);
      process.exit(2);
    }
    const inv = buildInventory(repo);
    writeJson("inventory.json", inv);
    const model = JSON.parse(readFileSync(modelPath, "utf8"));
    const r = verifyModel({ model, inv, repo });
    let live = null;
    if (opts.live) {
      if (opts.live !== "sqlite" || typeof opts.db !== "string") {
        console.error("verify: --live supports only `sqlite`, with --db <path>");
        process.exit(2);
      }
      const { tableCounts } = await import("./adapters/live-sqlite.mjs");
      const counts = tableCounts(opts.db, typeof opts["sqlite-module"] === "string" ? opts["sqlite-module"] : undefined);
      live = { counts, added: addLiveHealth(r.model, counts) };
    }
    writeJson("model.checked.json", r.model);
    writeFileSync(path.join(out, "report.md"), reportMarkdown(r, { inv, model, live }));
    for (const e of r.errors) console.error(`error [${e.code}] ${e.msg}`);
    for (const w of r.warnings) console.error(`warn  [${w.code}] ${w.msg}`);
    console.log(
      `verify: ${r.errors.length ? "FAIL" : "PASS"} - ${r.errors.length} errors, ${r.warnings.length} warnings, ` +
        `coverage ${r.coverage.pct}% (${r.coverage.covered}/${r.coverage.total}) -> ${path.join(out, "report.md")}`,
    );
    process.exit(r.errors.length ? 1 : 0);
  }
  if (cmd === "render") {
    const checked = path.join(out, "model.checked.json");
    if (!existsSync(checked)) {
      console.error(`render: ${checked} not found; run verify first`);
      process.exit(2);
    }
    const { renderViewer } = await import("./lib/render.mjs");
    writeFileSync(path.join(out, "index.html"), renderViewer(JSON.parse(readFileSync(checked, "utf8"))));
    console.log(`render: ${path.join(out, "index.html")}`);
    return;
  }
  if (cmd === "groups") {
    // groups <db> --by table.column [--by …]: per-value row counts (id/enum columns only) for live health items.
    const { groupCounts } = await import("./adapters/live-sqlite.mjs");
    const specs = [].concat(opts.by ?? []);
    if (!specs.length) {
      console.error("groups: pass --by <table.column>");
      process.exit(2);
    }
    const mod = typeof opts["sqlite-module"] === "string" ? opts["sqlite-module"] : undefined;
    try {
      console.log(JSON.stringify(Object.fromEntries(specs.map((s) => [s, groupCounts(repo, s, mod)])), null, 2));
    } catch (e) {
      console.error(e.message);
      process.exit(1);
    }
    return;
  }
  if (cmd === "inventory") {
    const inv = buildInventory(repo);
    mkdirSync(out, { recursive: true });
    writeJson("inventory.json", inv);
    console.log(
      `inventory: ${inv.entries.length} entries, ${inv.stores.length} stores, ${inv.outside.length} outside calls, ` +
        `${inv.noCallers.length} functions with no callers, ${inv.excludedFiles.length} files excluded -> ${out}`,
    );
    return;
  }
  console.error(`unknown command: ${cmd}`);
  process.exit(2);
}

// Compare real paths: the skill is usually run through a junction/symlink to this folder.
if (process.argv[1] && realpathSync(path.resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) main();
