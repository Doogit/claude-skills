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
