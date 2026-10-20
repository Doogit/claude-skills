// Language-agnostic inventory pieces: file walk, SQL tables, store access, URL literals.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const EXCLUDED_DIRS = [
  "node_modules", "dist", "build", "coverage", "docs", "test", "tests", "__tests__",
  "spikes", "fixtures", "__fixtures__", "scripts", "examples", "benchmark", "benchmarks",
  "venv", "__pycache__", "(any dot-directory)",
];
const SKIP_DIR = new Set(EXCLUDED_DIRS);
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$|_test\.py$|(^|\/)test_[^/]*\.py$/;
const SCANNED = /\.([cm]?[jt]sx?|py|sql)$/;
const MAX_BYTES = 1_000_000;

/** All scanned source files under repo, sorted by path; test files and big files are reported, not scanned. */
export function walk(repo) {
  const files = [];
  const excludedFiles = [];
  (function rec(dir) {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!ent.name.startsWith(".") && !SKIP_DIR.has(ent.name)) rec(abs);
        continue;
      }
      const rel = path.relative(repo, abs).split(path.sep).join("/");
      if (!SCANNED.test(rel)) continue;
      if (TEST_FILE.test(rel) || statSync(abs).size > MAX_BYTES) {
        excludedFiles.push(rel);
        continue;
      }
      files.push({ rel, ext: path.extname(rel).slice(1), lines: readFileSync(abs, "utf8").split(/\r?\n/) });
    }
  })(repo);
  files.sort((a, b) => (a.rel < b.rel ? -1 : 1));
  excludedFiles.sort();
  return { files, excludedFiles };
}

export function isComment(line) {
  return /^\s*(\/\/|\/\*|\*|#|--)/.test(line);
}

/**
 * Tables that survive all migrations: .sql files in path order (CREATE / DROP / RENAME),
 * then CREATE TABLE statements embedded in code (run order unknown, so creates only).
 */
export function sqlTables(files) {
  const tables = new Map();
  const create = /\bCREATE\s+(TEMP\s+|TEMPORARY\s+)?(?:VIRTUAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`[]?(\w+)/gi;
  const drop = /\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?["`[]?(\w+)/gi;
  const rename = /\bALTER\s+TABLE\s+["`[]?(\w+)["`\]]?\s+RENAME\s+TO\s+["`[]?(\w+)/gi;
  const ordered = [...files.filter((f) => f.ext === "sql"), ...files.filter((f) => f.ext !== "sql")];
  for (const f of ordered) {
    const isSql = f.ext === "sql";
    f.lines.forEach((raw, i) => {
      const line = isSql ? raw.replace(/--.*$/, "") : raw;
      if (!isSql && isComment(line)) return;
      for (const m of line.matchAll(create)) {
        if (m[1] || tables.has(m[2])) continue;
        tables.set(m[2], { file: f.rel, line: i + 1 });
      }
      if (!isSql) return;
      for (const m of line.matchAll(drop)) tables.delete(m[1]);
      for (const m of line.matchAll(rename)) {
        const t = tables.get(m[1]);
        tables.delete(m[1]);
        if (t) tables.set(m[2], t);
      }
    });
  }
  return tables;
}

/** Per table, the code lines that write it and read it (uppercase SQL keywords only, to skip prose). */
export function storeAccess(files, tables) {
  const write = /\b(?:INSERT(?:\s+OR\s+[A-Z]+)?\s+INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM)\s+["`]?(\w+)/g;
  const read = /\b(DELETE\s+)?(?:FROM|JOIN)\s+["`]?(\w+)/g;
  const acc = new Map([...tables.keys()].map((t) => [t, { writes: [], reads: [] }]));
  const add = (list, site) => {
    if (!list.some((s) => s.file === site.file && s.line === site.line)) list.push(site);
  };
  for (const f of files) {
    if (f.ext === "sql") continue;
    f.lines.forEach((line, i) => {
      if (isComment(line)) return;
      const site = { file: f.rel, line: i + 1 };
      for (const m of line.matchAll(write)) if (acc.has(m[1])) add(acc.get(m[1]).writes, site);
      for (const m of line.matchAll(read)) if (!m[1] && acc.has(m[2])) add(acc.get(m[2]).reads, site);
    });
  }
  return acc;
}

const LOOPBACK = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/;

/** Outbound hosts from URL literals, only in files that make network calls (`gate`). */
export function urlHosts(files, gate) {
  const out = [];
  const url = /["'`]https?:\/\/([A-Za-z0-9.-]+)([^"'`$?#\s]*)/g;
  for (const f of files) {
    if (f.ext === "sql" || !f.lines.some((l) => gate.test(l))) continue;
    f.lines.forEach((line, i) => {
      if (isComment(line)) return;
      for (const m of line.matchAll(url)) {
        const id = `http:${m[1]}${m[2].replace(/\/$/, "")}`;
        if (!LOOPBACK.test(m[1])) out.push({ id, kind: "http", file: f.rel, line: i + 1 });
      }
    });
  }
  return out;
}

/** Keep the first item per id, then sort by id. */
export function uniqueById(items) {
  const seen = new Map();
  for (const it of items) if (!seen.has(it.id)) seen.set(it.id, it);
  return [...seen.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
