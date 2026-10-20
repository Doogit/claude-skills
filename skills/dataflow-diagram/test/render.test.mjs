import vm from "node:vm";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { renderViewer } from "../lib/render.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const model = JSON.parse(readFileSync(path.join(here, "fixtures", "ts-mini", "docs", "dataflow", "model.json"), "utf8"));

test("render inlines the model and leaves no placeholders", () => {
  const html = renderViewer(model);
  assert.ok(!html.includes("__MODEL_JSON__") && !html.includes("__TITLE__"));
  assert.match(html, /<title>ts-mini data flow<\/title>/);
  const json = html.match(/<script id="model" type="application\/json">([\s\S]*?)<\/script>/)[1];
  assert.deepEqual(JSON.parse(json), model);
});

test("render: model text cannot close the script tag", () => {
  const m = structuredClone(model);
  m.views[0].intro = "</script><script>alert(1)</script> $& $1";
  const html = renderViewer(m);
  const json = html.match(/<script id="model" type="application\/json">([\s\S]*?)<\/script>/)[1];
  assert.equal(JSON.parse(json).views[0].intro, m.views[0].intro);
});

test("render: the viewer script parses", () => {
  const html = renderViewer(model);
  const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]).join("\n");
  assert.doesNotThrow(() => new Function(code));
});

// Execute the viewer's real panel/navigation code without fetching CDN layout code.
function viewerContext(m) {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { innerHTML: "", textContent: "", querySelectorAll: () => [] });
    return elements.get(id);
  };
  element("model").textContent = JSON.stringify(m);
  const context = vm.createContext({ document: { getElementById: element }, matchMedia: () => ({ matches: true }) });
  const code = [...renderViewer(m).matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]).join("\n");
  vm.runInContext(code.slice(0, code.indexOf("document.addEventListener('keydown'")), context);
  return { context, element };
}

test("viewer escapes app names in actor panels", () => {
  const m = structuredClone(model);
  m.meta.app = '<img src=x onerror="alert(1)">';
  const { context, element } = viewerContext(m);
  vm.runInContext('state.sel = "user"; renderPanel()', context);
  assert.ok(!element("panel").innerHTML.includes("<img"));
  assert.ok(element("panel").innerHTML.includes("&lt;img"));
});

test("viewer escapes IDs and severities in HTML attributes", () => {
  const { context } = viewerContext(model);
  const html = vm.runInContext(`probHtml({ sev: 'warn" onclick="alert(1)', view: 'v" onclick="alert(1)', id: 'n" onclick="alert(1)', node: 'Node', title: 'Warning' }, true)`, context);
  assert.ok(!html.includes('" onclick="'));
  assert.ok(html.includes('&quot;'));
});

test("viewer escapes view IDs in navigation attributes", () => {
  const m = structuredClone(model);
  m.views[0].id = 'context" onclick="alert(1)';
  m.views[1].id = 'journey" onclick="alert(1)';
  m.views[0].nodes.find(n => n.opens).opens = m.views[1].id;
  const { context, element } = viewerContext(m);
  vm.runInContext('state.view = M.views[1].id; chrome()', context);
  for (const id of ["crumbs", "levels"]) assert.ok(!element(id).innerHTML.includes('" onclick="'));
});
