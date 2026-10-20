// The checks the model does not grade itself on. verifyModel adds automatic health
// items to the model it is given; everything else is reported, never fixed.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const TOLERANCE = 3;
const CAP_WARN = 10;
const CAP_ERROR = 12;
const PROCESS = new Set(["process", "system"]);
const OUTER = new Set(["store", "actor"]);
const NO_EVIDENCE_NEEDED = new Set(["port", "group"]);
const SOURCES = new Set(["code", "live", "plan"]);

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z]+/g, "");
const glob = (p) => new RegExp(`^${p.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
const excludes = (pattern, item) =>
  pattern.startsWith("file:") ? glob(pattern.slice(5)).test(item.file) : glob(pattern).test(item.id);

export function verifyModel({ model, inv, repo }) {
  const errors = [];
  const warnings = [];
  const err = (code, msg) => errors.push({ code, msg });
  const warn = (code, msg) => warnings.push({ code, msg });

  const cache = new Map();
  const fileLines = (file) => {
    if (!cache.has(file)) {
      const abs = path.join(repo, file);
      cache.set(file, existsSync(abs) ? readFileSync(abs, "utf8").split(/\r?\n/) : null);
    }
    return cache.get(file);
  };
  const checkEvidence = (list, where) => {
    for (const ev of list ?? []) {
      const lines = fileLines(ev.file);
      if (!lines) {
        err("anchor", `${where}: ${ev.file} not found`);
        continue;
      }
      const near = lines.slice(Math.max(0, ev.line - 1 - TOLERANCE), ev.line + TOLERANCE);
      if (!ev.anchor || !near.some((l) => l.includes(ev.anchor))) {
        const at = ev.anchor ? lines.findIndex((l) => l.includes(ev.anchor)) : -1;
        const hint = at >= 0 ? ` (found at line ${at + 1})` : "";
        err("anchor", `${where}: "${ev.anchor}" is not within ${TOLERANCE} lines of ${ev.file}:${ev.line}${hint}`);
      }
    }
  };

  // The no-caller function that contains a file:line, if any (inventory records its end line).
  const deadFn = (file, line) =>
    inv.noCallers.find((fn) => fn.file === file && line >= fn.line && line <= (fn.endLine ?? fn.line));
  const noCallers = (fn) =>
    fn.calledOnlyFrom ? `which is called only from ${fn.calledOnlyFrom.join(", ")} (no production callers)` : "which has no production callers";
  const isUnused = (n) => n.type === "unused" || (n.health ?? []).some((h) => h.sev === "unused");

  const views = new Map(model.views.map((v) => [v.id, v]));
  // The viewer recursively rolls up child health and follows parent breadcrumbs.
  // Cross-links (`go`) may point back; containment (`opens`) must be acyclic.
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) {
      err("view-cycle", `view ${id} is part of an opens cycle; use go for cross-navigation`);
      return;
    }
    if (visited.has(id) || !views.has(id)) return;
    visiting.add(id);
    for (const n of views.get(id).nodes) if (n.opens) visit(n.opens);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of views.keys()) visit(id);
  const known = new Set([...inv.entries, ...inv.stores, ...inv.outside, ...inv.noCallers].map((i) => i.id));
  const referenced = new Set();
  const inferred = [];

  for (const v of model.views) {
    const nodes = new Map(v.nodes.map((n) => [n.id, n]));
    const counted = v.nodes.filter((n) => n.type !== "group").length;
    if (counted > CAP_ERROR) err("cap", `${v.id} has ${counted} nodes (cap ${CAP_ERROR}); split it into a child view`);
    else if (counted > CAP_WARN) warn("cap", `${v.id} has ${counted} nodes (aim for ${CAP_WARN} or fewer)`);

    for (const n of v.nodes) {
      const where = `${v.id}/${n.id}`;
      if (!NO_EVIDENCE_NEEDED.has(n.type) && !n.evidence?.length) err("no-evidence", `${where} has no evidence`);
      checkEvidence(n.evidence, where);
      for (const h of n.health ?? []) {
        if (!SOURCES.has(h.source)) err("health-source", `${where}: "${h.title}" has source "${h.source}" (code|live|plan)`);
        checkEvidence(h.evidence, `${where} health "${h.title}"`);
        if (h.sev === "broken" && (h.source !== "code" || !h.evidence?.length)) {
          err("broken-evidence", `${where}: "${h.title}" is broken but has no source "code" evidence showing the failure; a live zero or a plan mismatch is warn`);
        }
      }
      for (const id of n.inventory ?? []) {
        if (known.has(id)) referenced.add(id);
        else err("unknown-inventory", `${where} names ${id}, which is not in the inventory`);
      }
      for (const key of ["opens", "go"]) {
        if (n[key] && !views.has(n[key])) err("ref", `${where}.${key} -> missing view ${n[key]}`);
      }
      if (n.group && nodes.get(n.group)?.type !== "group") err("ref", `${where}.group -> ${n.group} is not a group in this view`);
      if (PROCESS.has(n.type) && !(n.health ?? []).some((h) => h.sev === "unused")) {
        const dead = inv.noCallers.find(
          (fn) =>
            (n.inventory ?? []).includes(fn.id) ||
            (n.evidence ?? []).some(
              (ev) => ev.file === fn.file && Math.abs(ev.line - fn.line) <= TOLERANCE && ev.anchor?.includes(fn.id.slice(3)),
            ),
        );
        if (dead) {
          err("reachability", `${where} is a ${n.type}, but ${dead.id} (${dead.file}:${dead.line}) ${noCallers(dead).replace(/^which /, "")}; make it type "unused" or add an unused health item`);
        }
      }
    }

    const ins = new Map();
    const outs = new Map();
    const bump = (m, id) => m.set(id, (m.get(id) ?? 0) + 1);
    for (const e of v.edges ?? []) {
      const where = `${v.id}: ${e.from}>${e.to}`;
      const a = nodes.get(e.from);
      const b = nodes.get(e.to);
      if (!a || !b) {
        err("ref", `${where} names a missing node`);
        continue;
      }
      if (!e.evidence?.length) {
        if (e.inferred) inferred.push(where);
        else err("no-evidence", `${where} has no evidence (cite it, or mark it inferred)`);
      }
      checkEvidence(e.evidence, where);
      if ((a.type === "store" || b.type === "store") && !isUnused(a) && !isUnused(b)) {
        for (const ev of e.evidence ?? []) {
          const dead = deadFn(ev.file, ev.line);
          if (dead) err("unreachable-edge", `${where} cites ${ev.file}:${ev.line}, inside ${dead.id}, ${noCallers(dead)}; mark an endpoint unused or cite a live site`);
        }
      }
      if (OUTER.has(a.type) && OUTER.has(b.type)) err("lint", `${where}: ${a.type} to ${b.type} must pass through a process`);
      bump(outs, a.id);
      bump(ins, b.id);
      if (e.both) {
        bump(outs, b.id);
        bump(ins, a.id);
      }
    }
    // A process inside a group shares the group's flows.
    for (const n of v.nodes) {
      const ids = [n.id, n.group].filter(Boolean);
      if (PROCESS.has(n.type) && (!ids.some((id) => ins.get(id)) || !ids.some((id) => outs.get(id)))) {
        err("lint", `${v.id}/${n.id} needs at least one flow in and one flow out`);
      }
    }

    // Level balance: a child view shows each neighbour of the node that opens it.
    for (const n of v.nodes) {
      const child = views.get(n.opens);
      if (!child) continue;
      const neighbours = (v.edges ?? [])
        .filter((e) => e.from === n.id || e.to === n.id)
        .map((e) => nodes.get(e.from === n.id ? e.to : e.from))
        .filter((nb) => nb && nb.type !== "group");
      for (const nb of new Set(neighbours)) {
        const target = nb.opens ?? v.id;
        const shown = child.nodes.some((c) => (c.type === "port" && c.go === target) || norm(c.label) === norm(nb.label));
        if (!shown) warn("balance", `${child.id} does not show "${nb.label}", a neighbour of "${n.label}" in ${v.id}`);
      }
    }
  }

  for (const w of model.walks ?? []) {
    const v = views.get(w.view);
    if (!v) {
      err("ref", `walk ${w.id} -> missing view ${w.view}`);
      continue;
    }
    for (const s of w.steps ?? []) {
      if (s.node && !v.nodes.some((n) => n.id === s.node)) err("ref", `walk ${w.id} step -> missing node ${s.node}`);
      if (s.edge) {
        const [from, to] = s.edge.split(">");
        const found = (v.edges ?? []).some((e) => (e.from === from && e.to === to) || (e.both && e.from === to && e.to === from));
        if (!found) err("ref", `walk ${w.id} step -> missing edge ${s.edge}`);
      }
    }
  }

  const items = [...inv.entries, ...inv.stores, ...inv.outside];
  const reasons = (model.excluded ?? []).filter((x) => x.reason?.trim());
  const missing = items
    .filter((it) => !referenced.has(it.id) && !reasons.some((x) => excludes(x.inventory, it)))
    .map((it) => it.id)
    .sort();
  const total = items.length;
  const pct = total ? Math.round(((total - missing.length) / total) * 10000) / 100 : 100;
  if (pct < 90) err("coverage", `coverage ${pct}% is below 90% (${missing.length} of ${total} inventory items not covered)`);
  else if (pct < 100) warn("coverage", `${missing.length} of ${total} inventory items not covered`);

  for (const st of inv.stores) {
    if (!referenced.has(st.id)) continue;
    for (const [kind, sites] of [["write", st.writes], ["read", st.reads]]) {
      for (const site of sites) {
        const dead = deadFn(site.file, site.line);
        if (dead) warn("unreachable-site", `${st.id}: ${kind} at ${site.file}:${site.line} is inside ${dead.id}, ${noCallers(dead)}`);
      }
    }
  }

  const autoHealth = addStoreHealth(model, inv, deadFn);
  return { errors, warnings, coverage: { covered: total - missing.length, total, pct, missing }, autoHealth, inferred, model };
}

function addHealth(n, item) {
  if ((n.health ?? []).some((h) => h.auto === item.auto)) return false;
  n.health = [...(n.health ?? []), item];
  return true;
}

/** Stores written but never read (warn) or read but never written (unused) get a health item. */
function addStoreHealth(model, inv, deadFn) {
  const stores = new Map(inv.stores.map((s) => [s.id, s]));
  const added = [];
  for (const v of model.views) {
    for (const n of v.nodes) {
      for (const id of n.inventory ?? []) {
        const s = stores.get(id);
        if (!s) continue;
        // Sites inside functions nothing calls don't count as real reads or writes.
        const live = (sites) => sites.filter((x) => !deadFn(x.file, x.line));
        const writes = live(s.writes);
        const reads = live(s.reads);
        if (writes.length && reads.length) continue;
        const name = id.replace(/^table:/, "");
        const [sev, title] = !writes.length
          ? ["unused", reads.length ? `${name}: read but never written` : `${name}: nothing writes or reads it`]
          : ["warn", `${name}: written but never read`];
        const evidence = [{ file: s.file, line: s.line, anchor: name }];
        const skipped = s.writes.length - writes.length + (s.reads.length - reads.length);
        const detail =
          "Found by the code scan: no production code line " + (sev === "warn" ? "reads it." : "writes it.") +
          (skipped ? ` ${skipped} site(s) sit inside functions with no callers and were not counted.` : "");
        if (addHealth(n, { sev, title, detail, source: "code", auto: id, evidence })) added.push({ view: v.id, node: n.id, item: id });
      }
    }
  }
  return added;
}

/** Tables with 0 live rows become "empty" health items on the nodes that own them. Empty is not proof of dead code. */
export function addLiveHealth(model, counts, date = new Date().toISOString().slice(0, 10)) {
  const added = [];
  for (const v of model.views) {
    for (const n of v.nodes) {
      for (const id of n.inventory ?? []) {
        const table = id.replace(/^table:/, "");
        if (!id.startsWith("table:") || counts[table] !== 0) continue;
        const item = {
          sev: "warn",
          title: `${table}: no rows yet`,
          detail: `0 rows in the live database (checked ${date}). This snapshot does not prove the code is unused: rows may have been deleted or reset, the feature may be opt-in, or its trigger data or a human step may be absent.`,
          source: "live",
          auto: `live:${table}`,
        };
        if (addHealth(n, item)) added.push({ view: v.id, node: n.id, table });
      }
    }
  }
  return added;
}

/** Health items taken from docs; verify cannot check them, so the report lists them for the reviewer and the user. */
function planOnly(model) {
  return model.views.flatMap((v) =>
    v.nodes.flatMap((n) => (n.health ?? []).filter((h) => h.source === "plan").map((h) => ({ view: v.id, node: n.id, sev: h.sev, title: h.title }))),
  );
}

export function reportMarkdown(r, { inv, model, live }) {
  const list = (items, fmt = (x) => x) => (items.length ? items.map((x) => `- ${fmt(x)}`).join("\n") : "- none");
  const out = [
    "# Data flow verification",
    "",
    `- Repo: ${inv.meta.repo} @ ${inv.meta.commit ?? "(no git commit)"}`,
    `- Checked: ${new Date().toISOString()}`,
    `- Result: **${r.errors.length ? "FAIL" : "PASS"}** (${r.errors.length} errors, ${r.warnings.length} warnings)`,
    `- Coverage: ${r.coverage.pct}% (${r.coverage.covered} of ${r.coverage.total} inventory items)`,
    "",
    "## Errors",
    list(r.errors, (e) => `[${e.code}] ${e.msg}`),
    "",
    "## Warnings",
    list(r.warnings, (e) => `[${e.code}] ${e.msg}`),
    "",
    "## Not covered",
    list(r.coverage.missing),
    "",
    "## Inferred edges (believed, not cited)",
    list(r.inferred),
    "",
    "## Problems added automatically",
    list(r.autoHealth, (a) => `${a.view}/${a.node}: ${a.item}`),
    "",
    "## Plan-only claims (not re-checked)",
    list(planOnly(model), (p) => `${p.view}/${p.node}: [${p.sev}] ${p.title}`),
  ];
  if (live) {
    const empty = Object.keys(live.counts).filter((t) => live.counts[t] === 0);
    out.push(
      "",
      "## Live check (row counts only)",
      `- ${Object.keys(live.counts).length} tables, ${empty.length} empty: ${empty.join(", ") || "none"}`,
      list(live.added, (a) => `${a.view}/${a.node}: ${a.table} has 0 rows`),
    );
  }
  out.push(
    "",
    "## Excluded by the model",
    list(model.excluded ?? [], (x) => `${x.inventory}: ${x.reason || "(no reason: not counted)"}`),
    "",
    "## Excluded from the code scan",
    `- Directories: ${inv.excludedDirs.join(", ")}`,
    `- Files (tests and files over 1 MB): ${inv.excludedFiles.length}`,
    "",
  );
  return out.join("\n");
}
