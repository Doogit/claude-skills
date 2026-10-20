// Builds the self-contained viewer: template/viewer.html with the checked model inlined.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TEMPLATE = fileURLToPath(new URL("../template/viewer.html", import.meta.url));

export function renderViewer(model) {
  // "<" is escaped so no model text can close the <script> tag it sits in.
  const json = JSON.stringify(model).replace(/</g, "\\u003c");
  const title = `${model.meta.app ?? model.meta.repo} data flow`.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return readFileSync(TEMPLATE, "utf8").replace("__TITLE__", () => title).replace("__MODEL_JSON__", () => json);
}
