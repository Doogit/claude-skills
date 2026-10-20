import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { buildInventory } from "../dfd.mjs";
import { verifyModel, addLiveHealth, reportMarkdown } from "../lib/verify.mjs";
import { tableCounts } from "../adapters/live-sqlite.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "fixtures", "ts-mini");
const inv = buildInventory(repo);
const base = JSON.parse(readFileSync(path.join(repo, "docs", "dataflow", "model.json"), "utf8"));

const run = (mutate = () => {}) => {
  const model = structuredClone(base);
  mutate(model);
  return verifyModel({ model, inv, repo });
};
const view = (m, id) => m.views.find((v) => v.id === id);
const node = (m, v, id) => view(m, v).nodes.find((n) => n.id === id);
const codes = (list) => list.map((e) => e.code);

test("base model passes every check with full coverage", () => {
  const r = run();
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.coverage.pct, 100);
});

test("anchor: text must be within 3 lines of the cited line", () => {
  assert.ok(!codes(run((m) => { node(m, "journey", "sync").evidence[0].line = 14; }).errors).includes("anchor"));
  assert.ok(codes(run((m) => { node(m, "journey", "sync").evidence[0].line = 15; }).errors).includes("anchor"));
  assert.ok(codes(run((m) => { node(m, "journey", "sync").evidence[0].anchor = "scheduleJob(\"sync.push\""; }).errors).includes("anchor"));
  assert.ok(codes(run((m) => { node(m, "journey", "sync").evidence[0].file = "src/nope.ts"; }).errors).includes("anchor"));
});

test("evidence: nodes and non-inferred edges need at least one", () => {
  assert.ok(codes(run((m) => { node(m, "journey", "sync").evidence = []; }).errors).includes("no-evidence"));
  assert.ok(codes(run((m) => { view(m, "journey").edges[0].evidence = []; }).errors).includes("no-evidence"));
  const inferred = run((m) => { Object.assign(view(m, "journey").edges[0], { evidence: [], inferred: true }); });
  assert.deepEqual(inferred.errors, []);
  assert.deepEqual(inferred.inferred, ["journey: remote>sync"]);
});

test("coverage: error below 90%, warn below 100%, unknown ids are errors", () => {
  const low = run((m) => { delete node(m, "journey", "db").inventory; });
  assert.equal(low.coverage.pct, 87.5);
  assert.ok(codes(low.errors).includes("coverage"));
  const mid = run((m) => { m.excluded.shift(); });
  assert.ok(!codes(mid.errors).includes("coverage"));
  assert.ok(codes(mid.warnings).includes("coverage"));
  assert.deepEqual(mid.coverage.missing, ["timer:heartbeat"]);
  assert.ok(codes(run((m) => { m.excluded[0].reason = ""; }).warnings).includes("coverage"));
  assert.ok(codes(run((m) => { node(m, "journey", "sync").inventory.push("table:gone"); }).errors).includes("unknown-inventory"));
});

test("coverage: exclusions accept * patterns on ids and file:", () => {
  const r = run((m) => {
    m.excluded = [{ inventory: "timer:*", reason: "timers" }, { inventory: "file:src/client.ts", reason: "client" }];
    node(m, "journey", "sync").inventory = [];
    node(m, "journey", "report").inventory = ["proc:node", "proc:cmd@src/jobs.ts"];
  });
  assert.deepEqual(r.coverage.missing, ["worker:hash-worker"]);
});

test("lint: store/actor pairs and process in/out", () => {
  assert.ok(codes(run((m) => { view(m, "journey").edges.push({ from: "db", to: "user", label: "rows", evidence: base.views[1].edges[4].evidence }); }).errors).includes("lint"));
  assert.ok(codes(run((m) => { view(m, "journey").edges.push({ from: "user", to: "remote", label: "x", evidence: base.views[1].edges[4].evidence }); }).errors).includes("lint"));
  assert.ok(codes(run((m) => { view(m, "journey").edges.splice(1, 1); }).errors).includes("lint"));
});

test("lint: a process inside a group shares the group's flows", () => {
  const grouped = (field) => (m) => {
    const v = view(m, "journey");
    v.nodes.push({ id: "grp", type: "group", label: "Workers" });
    v.nodes.push({ id: "inner", type: "process", label: "Inner", does: "x", evidence: base.views[1].nodes[2].evidence, ...field });
    v.edges.push({ from: "remote", to: "grp", label: "names", evidence: base.views[1].edges[0].evidence });
    v.edges.push({ from: "grp", to: "db", label: "rows", evidence: base.views[1].edges[1].evidence });
  };
  assert.deepEqual(run(grouped({ group: "grp" })).errors, []);
  assert.ok(codes(run(grouped({})).errors).includes("lint"));
  assert.ok(codes(run(grouped({ group: "sync" })).errors).includes("ref"));
});

test("balance: child view must show the parent node's neighbours (warn)", () => {
  assert.ok(codes(run((m) => { node(m, "journey", "remote").label = "Remote"; }).warnings).includes("balance"));
});

test("cap: more than 12 nodes in a view is an error, groups excluded", () => {
  const extra = (type) => (m) => {
    for (let k = 0; k < 7; k++) {
      view(m, "journey").nodes.push({ id: `x${k}`, type, label: `x${k}`, does: "x", evidence: base.views[1].nodes[5].evidence });
    }
  };
  assert.ok(codes(run(extra("unused")).errors).includes("cap"));
  assert.ok(!codes(run(extra("group")).errors).includes("cap"));
});

test("reachability: a process citing a function with no callers must be marked unused", () => {
  assert.ok(codes(run((m) => { node(m, "journey", "report").type = "process"; }).errors).includes("reachability"));
  const flagged = run((m) => {
    const n = node(m, "journey", "report");
    n.type = "process";
    n.health = [{ sev: "unused", title: "Nothing calls it", source: "code" }];
  });
  assert.ok(!codes(flagged.errors).includes("reachability"));
});

test("noCallers is transitive: a function called only from a dead one is dead too", () => {
  const chain = buildInventory(path.join(here, "fixtures", "ts-chain"));
  const ids = chain.noCallers.map((f) => f.id).sort();
  assert.deepEqual(ids, ["fn:orphan", "fn:stepOne"]);
  assert.equal(chain.noCallers.find((f) => f.id === "fn:orphan").calledOnlyFrom, undefined);
  assert.deepEqual(chain.noCallers.find((f) => f.id === "fn:stepOne").calledOnlyFrom, ["fn:orphan"]);
});

test("unreachable sites: store access inside a no-caller function (inventory endLine)", () => {
  assert.deepEqual(inv.noCallers.find((f) => f.id === "fn:runReport").endLine, 36);
  // Edge into a store that cites a line inside runReport (jobs.ts 27-36), from a node presented as live.
  const edgeIn = (mutate = () => {}) => run((m) => {
    Object.assign(view(m, "journey").edges.find((e) => e.from === "sync" && e.to === "db"), {
      evidence: [{ file: "src/jobs.ts", line: 30, anchor: "killTimer" }],
    });
    mutate(m);
  });
  assert.ok(codes(edgeIn().errors).includes("unreachable-edge"));
  assert.ok(!codes(edgeIn((m) => { node(m, "journey", "sync").health.push({ sev: "unused", title: "Nothing calls it", source: "code" }); }).errors).includes("unreachable-edge"));

  // Store site list: a write inside runReport warns, and does not count for the write-only/read-only items.
  const inv2 = structuredClone(inv);
  const sync = inv2.stores.find((s) => s.id === "table:sync_log");
  sync.writes = [{ file: "src/jobs.ts", line: 30 }];
  const r = verifyModel({ model: structuredClone(base), inv: inv2, repo });
  assert.ok(codes(r.warnings).includes("unreachable-site"));
  const h = node(r.model, "journey", "db").health.find((x) => x.auto === "table:sync_log");
  assert.equal(h.sev, "unused");
  assert.match(h.detail, /1 site\(s\) sit inside functions with no callers/);
});

test("broken health items need source code evidence", () => {
  const broken = (h) => run((m) => { node(m, "journey", "sync").health = [{ sev: "broken", title: "t", ...h }]; });
  const ev = [{ file: "src/jobs.ts", line: 11, anchor: "scheduleJob" }];
  assert.ok(codes(broken({ source: "live" }).errors).includes("broken-evidence"));
  assert.ok(codes(broken({ source: "code" }).errors).includes("broken-evidence"));
  assert.ok(!codes(broken({ source: "code", evidence: ev }).errors).includes("broken-evidence"));
  assert.ok(!codes(run((m) => { node(m, "journey", "sync").health[0].sev = "warn"; }).errors).includes("broken-evidence"));
});

test("anchor drift: the error says where the text is now", () => {
  const r = run((m) => { node(m, "journey", "sync").evidence[0].line = 30; });
  assert.ok(r.errors.some((e) => e.code === "anchor" && /found at line 11\)/.test(e.msg)));
});

test("report: plan-only health items are listed", () => {
  const model = structuredClone(base);
  node(model, "journey", "sync").health.push({ sev: "warn", title: "Plan says X", detail: "d", source: "plan" });
  const md = reportMarkdown(verifyModel({ model, inv, repo }), { inv, model });
  assert.match(md, /## Plan-only claims \(not re-checked\)\n- journey\/sync: \[warn\] Plan says X/);
});

test("store access: written-never-read store gets an automatic warn item", () => {
  const r = run();
  const db = node(r.model, "journey", "db");
  assert.deepEqual(db.health.map((h) => [h.sev, h.auto]), [["warn", "table:sync_log"]]);
  assert.equal(r.autoHealth.length, 1);
});

test("references: opens, go, edges and walk steps resolve", () => {
  assert.ok(codes(run((m) => { node(m, "context", "app").opens = "nope"; }).errors).includes("ref"));
  assert.ok(codes(run((m) => { view(m, "journey").edges[0].to = "nope"; }).errors).includes("ref"));
  assert.ok(codes(run((m) => { m.walks[0].steps[1].edge = "sync>remote"; }).errors).includes("ref"));
  assert.ok(codes(run((m) => { m.walks[0].steps[0].node = "nope"; }).errors).includes("ref"));
});

test("health items must say their source", () => {
  assert.ok(codes(run((m) => { node(m, "journey", "sync").health[0].source = "vibes"; }).errors).includes("health-source"));
});

test("live: empty tables become live health items on the node that owns them", () => {
  const model = structuredClone(base);
  const added = addLiveHealth(model, { items: 5, sync_log: 0 });
  assert.deepEqual(added, [{ view: "journey", node: "db", table: "sync_log" }]);
  const h = node(model, "journey", "db").health.at(-1);
  assert.equal(h.source, "live");
  assert.equal(h.sev, "unused");
  assert.equal(h.title, "sync_log: no rows yet");
});

test("live-sqlite: counts rows read-only", () => {
  const dir = path.join(here, ".tmp");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "live.sqlite");
  rmSync(file, { force: true });
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE items (id INTEGER); CREATE TABLE \"odd name\" (x); INSERT INTO items VALUES (1), (2);");
  db.close();
  try {
    assert.deepEqual(tableCounts(file), { items: 2, "odd name": 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
