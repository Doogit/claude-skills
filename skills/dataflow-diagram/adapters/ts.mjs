// TS/JS adapter: entry points (bin, listen, routes, timers), outside calls, functions with no callers.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { isComment, urlHosts } from "./generic.mjs";

const JS = /^[cm]?[jt]sx?$/;
const NETWORK_GATE = /\bfetch\w*\(|\bhttps?\.(request|get)\(|\baxios\b|new WebSocket\(/;

/** Top-level arguments of the call whose "(" is at lines[i][col], whitespace-collapsed. */
export function callArgs(lines, i, col) {
  const text = lines
    .slice(i, i + 60)
    .map((l) => l.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n");
  const args = [];
  let depth = 0;
  let cur = "";
  let quote = null;
  for (let k = col + 1; k < text.length; k++) {
    const c = text[k];
    if (quote) {
      cur += c;
      if (c === "\\") cur += text[++k] ?? "";
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) {
      if (depth === 0) break;
      depth--;
    } else if (c === "," && depth === 0) {
      args.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  args.push(cur);
  return args.map((a) => a.replace(/\s+/g, " ").trim()).filter((a, n) => a || n === 0);
}

const literal = (arg) => /^(["'`])([^"'`$]*)\1$/.exec(arg ?? "")?.[2];

function binEntries(repo) {
  const pkgPath = path.join(repo, "package.json");
  if (!existsSync(pkgPath)) return [];
  const text = readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(text);
  const bins = typeof pkg.bin === "string" ? { [pkg.name]: pkg.bin } : (pkg.bin ?? {});
  const lines = text.split(/\r?\n/);
  return Object.entries(bins).map(([name, target]) => ({
    id: `bin:${name}`,
    kind: "bin",
    file: "package.json",
    line: lines.findIndex((l) => l.includes(`"${target}"`)) + 1,
    target: target.replace(/^\.\//, ""),
  }));
}

const FN_DECL = /^(\s*)(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+(\w+)\s*[(<]|^(\s*)(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|\w+\s*=>)/;

/** Name of the nearest enclosing function declaration (by indentation), or null at top level. */
function enclosingFn(lines, i) {
  const indent = /^\s*/.exec(lines[i])[0].length;
  for (let k = i - 1; k >= 0; k--) {
    const m = FN_DECL.exec(lines[k]);
    if (m && (m[1] ?? m[3]).length < indent) return m[2] ?? m[4];
  }
  return null;
}

function timers(files) {
  const out = [];
  const raw = [];
  const wrappers = new Set();
  for (const f of files) {
    f.lines.forEach((line, i) => {
      if (isComment(line)) return;
      for (const m of line.matchAll(/(?<![\w.])setInterval\(/g)) {
        raw.push({ f, i, col: m.index + m[0].length - 1, wrapper: enclosingFn(f.lines, i) });
      }
    });
  }
  // A function that wraps setInterval and is called with a string name is a job scheduler:
  // each named call is a timer, and the setInterval inside it is not.
  const named = new Map();
  for (const w of new Set(raw.map((r) => r.wrapper).filter(Boolean))) {
    const call = new RegExp(`(?<![\\w.])${w}\\(`, "g");
    for (const f of files) {
      f.lines.forEach((line, i) => {
        if (isComment(line) || FN_DECL.exec(line)?.slice(2).includes(w)) return;
        for (const m of line.matchAll(call)) {
          const args = callArgs(f.lines, i, m.index + m[0].length - 1);
          const name = literal(args[0]);
          if (name === undefined) continue;
          wrappers.add(w);
          named.set(`timer:${name}`, { file: f.rel, line: i + 1, period: args[1] ?? "" });
        }
      });
    }
  }
  for (const [id, t] of named) out.push({ id, kind: "timer", ...t });
  const push = (name, f, i, period, extra) => {
    let id = `timer:${name}`;
    if (out.some((t) => t.id === id)) id += `@${f.rel}`;
    out.push({ id, kind: "timer", file: f.rel, line: i + 1, period, ...extra });
  };
  for (const r of raw) {
    if (r.wrapper && wrappers.has(r.wrapper)) continue;
    const args = callArgs(r.f.lines, r.i, r.col);
    push(/^[\w.]+$/.test(args[0]) ? args[0] : `${r.f.rel}:${r.i + 1}`, r.f, r.i, args[1] ?? "");
  }
  // One-shot timers kept in a variable are scheduled work (boot kicks, deadlines). Unassigned
  // setTimeout calls are sleeps or defers, and UI components are skipped.
  for (const f of files.filter((f) => !/x$/.test(f.ext))) {
    f.lines.forEach((line, i) => {
      if (isComment(line)) return;
      for (const m of line.matchAll(/(\w+)\s*=\s*setTimeout\(/g)) {
        const args = callArgs(f.lines, i, m.index + m[0].length - 1);
        push(m[1], f, i, args[1] ?? "", { oneShot: true });
      }
    });
  }
  return out;
}

function lineScan(files, re, make) {
  const out = [];
  for (const f of files) {
    f.lines.forEach((line, i) => {
      if (isComment(line)) return;
      for (const m of line.matchAll(re)) {
        const item = make(m, f, i);
        if (item) out.push({ ...item, file: f.rel, line: i + 1 });
      }
    });
  }
  return out;
}

const ROUTE = /\bmethod\s*===\s*["'`]([A-Z]+)["'`]\s*&&\s*\w+\s*===\s*["'`]([^"'`]+)["'`]/g;
// Bare or injected (`rt.spawn`, `spawnFn`) child-process calls; `.exec(` only on the module object,
// since regex and database objects also have an exec method.
const PROC = /(?<![\w$.])(?:(?:\w+\.)?\w*[sS]pawn\w*\)?|(?:\w+\.)?(?:execFile\w*|execSync|fork)|(?:child_process|cp|childProcess)\.exec|exec)\(/g;
const PARAM = /^\.{0,3}\w+\??\s*:\s*\S/;

/** Process id from a call's first argument: the program in a string literal, else the expression@file. */
function procId(arg, rel) {
  const tok = /^(["'`])([\s\S]*)\1$/.exec(arg)?.[2].split(/\s|\$\{/)[0];
  return tok ? `proc:${path.basename(tok)}` : `proc:${arg}@${rel}`;
}
const ENV = /\bprocess\.env(?:\.(\w+)|\[\s*["'](\w+)["']\s*\])/g;

/**
 * Exported functions no live code reaches: the name appears nowhere but its declaration, or every other
 * mention sits inside a function already found dead (repeated until nothing changes). The second kind
 * carries `calledOnlyFrom`. Import and re-export statements are not uses.
 */
function functionsWithoutCallers(files) {
  const uses = new Map();
  const decls = [];
  for (const f of files) {
    let inImport = false;
    f.lines.forEach((line, i) => {
      if (isComment(line)) return;
      if (!inImport && /^\s*(?:import\s|export\s+(?:type\s+)?[*{])/.test(line)) inImport = true;
      if (inImport) {
        if (/\bfrom\s*["'`]|^\s*import\s*["'`]|;\s*$/.test(line)) inImport = false;
        return;
      }
      for (const m of line.matchAll(/[A-Za-z_$][\w$]*/g)) {
        if (!uses.has(m[0])) uses.set(m[0], []);
        uses.get(m[0]).push({ file: f.rel, line: i + 1 });
      }
      const d = /^\s*export\s+(?:async\s+)?function\*?\s+(\w+)|^\s*export\s+const\s+(\w+)\s*=\s*(?:async\s*)?(?:function\b|\()/.exec(line);
      if (d) decls.push({ id: `fn:${d[1] ?? d[2]}`, name: d[1] ?? d[2], file: f.rel, line: i + 1, endLine: endLine(f.lines, i + 1) });
    });
  }
  const dead = new Map();
  const deadAround = (u) => [...dead.keys()].find((d) => d.file === u.file && u.line >= d.line && u.line <= d.endLine);
  for (let changed = true; changed; ) {
    changed = false;
    for (const d of decls) {
      if (dead.has(d)) continue;
      const others = uses.get(d.name).filter((u) => !(u.file === d.file && u.line === d.line));
      const callers = others.map(deadAround);
      if (callers.every(Boolean)) {
        dead.set(d, [...new Set(callers.map((c) => c.id))]);
        changed = true;
      }
    }
  }
  return decls
    .filter((d) => dead.has(d))
    .map((d) => {
      const { name, ...fn } = d;
      return dead.get(d).length ? { ...fn, calledOnlyFrom: dead.get(d) } : fn;
    });
}

/** Last line of a declaration: same line when its braces balance, else the next `}` at the declaration's indent. */
function endLine(lines, line) {
  const first = lines[line - 1];
  const count = (s, c) => s.split(c).length - 1;
  if (count(first, "{") && count(first, "}") >= count(first, "{")) return line;
  if (!count(first, "{") && /;\s*$/.test(first)) return line;
  const indent = /^\s*/.exec(first)[0].length;
  for (let j = line; j < lines.length; j++) {
    if (/^\s*/.exec(lines[j])[0].length === indent && lines[j].trimStart().startsWith("}")) return j + 1;
  }
  return line;
}

export function tsInventory(repo, allFiles) {
  const files = allFiles.filter((f) => JS.test(f.ext));
  if (!files.length) return { entries: [], outside: [], noCallers: [] };
  const entries = [
    ...binEntries(repo),
    ...lineScan(files, /\.listen\(/g, (m, f, i) => {
      const port = callArgs(f.lines, i, m.index + m[0].length - 1)[0];
      return port ? { id: `listen:${port}`, kind: "listen" } : null;
    }),
    ...lineScan(files, ROUTE, (m) => ({ id: `route:${m[1]} ${m[2]}`, kind: "route" })),
    ...timers(files),
    ...lineScan(files, /\bnew Worker\(/g, (m, f, i) => {
      const src = /["'`]([^"'`]+)["'`]/.exec(callArgs(f.lines, i, m.index + m[0].length - 1)[0]);
      return { id: `worker:${src ? path.basename(src[1]).replace(/\.\w+$/, "") : f.rel}`, kind: "worker" };
    }),
  ];
  const procFiles = files.filter((f) => f.lines.some((l) => l.includes("child_process")));
  const outside = [
    ...lineScan(files, ENV, (m) => ({ id: `env:${m[1] ?? m[2]}`, kind: "env" })),
    ...urlHosts(files, NETWORK_GATE),
    ...lineScan(procFiles, PROC, (m, f, i) => {
      const args = callArgs(f.lines, i, m.index + m[0].length - 1);
      const declared = /function\s*\*?\s*$/.test(f.lines[i].slice(0, m.index));
      if (!args[0] || declared || args.some((a) => PARAM.test(a))) return null;
      return { id: procId(args[0], f.rel), kind: "process" };
    }),
  ];
  return { entries, outside, noCallers: functionsWithoutCallers(files) };
}
