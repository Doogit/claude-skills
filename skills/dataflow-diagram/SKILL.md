---
name: dataflow-diagram
description: Generate an interactive, teaching-first data flow diagram of an application — how it works and how data moves, from one-box context down to the parts inside each stage, with a problems layer showing what is broken, unused or never connected. Every claim is checked against code (file:line anchors), an inventory coverage oracle, optional live SQLite row counts, and a fresh adversarial reviewer. Use when the user asks to "diagram this app", "draw the data flow", "show how this works", "explain the architecture visually", "map how data moves", or "/dataflow-diagram". Not for class/call graphs or file maps.
---

# dataflow-diagram

Output: one single-file `index.html` viewer (it fetches elkjs and fonts from CDNs when opened) (L0 context → L1 journey → L2 inside each stage, walkthrough, problems
layer, glossary, light/dark, phone width) plus `model.json`, `inventory.json` and `report.md`.

`SKILL_DIR` below = the folder holding this file. Run tools as `node <SKILL_DIR>/dfd.mjs …` (Node 24, no deps).
The inventory reads JS/TS code in depth; for `.py` and `.sql` it finds files and SQL tables only, so other
languages need more reading by hand in step 2.

## Rules that never bend

- **The model never grades itself.** `verify` (script), inventory coverage, the live check and a fresh
  adversarial subagent are the oracles. An unchecked AI scan of a real app can be substantially wrong.
- **No claim without evidence.** Every node and edge cites `file:line` + an `anchor` (text on that line). An edge
  you believe but cannot cite is `inferred: true` (drawn dashed, listed in the report).
- **Plan-only facts stay plan-only.** Anything taken from docs is `source: "plan"` and is never upgraded to
  `code`/`live` unless you re-derive it. Plans go stale: before keeping a plan fact, check it against code or live
  counts when you can. If they contradict it, state the checked fact (`code`/`live`) and drop the plan version.
- **Read targeted code** (Grep, then Read with offset/limit). Never read whole trees.
- **Privacy:** `verify --live` reads table row counts only. `groups` also returns the full values of the
  explicitly selected id/enum column; use it only for non-sensitive identifiers or states, never transcript,
  message, secret or free-text columns. The 200-value limit is not a privacy guarantee. Keep sensitive content
  out of the model.
- **Don't modify the target repo** beyond the output dir. If the repo forbids generated files (or the user says
  so), write output to a temp folder outside the repo with `--out`.

## Pipeline

Default output dir: `<repo>/docs/dataflow/`. Pass the same `--out <dir>` to every command.

1. **Inventory** — `node <SKILL_DIR>/dfd.mjs inventory <repo> --out <dir>`. Deterministic facts with `file:line`:
   `entries` (bins, routes, timers, workers, hooks), `stores` (tables/files with write and read sites),
   `outside` (hosts, SDKs, child processes, env reads), `noCallers` (functions with no production caller, including
   ones called only from such functions — these carry `calledOnlyFrom`; imports don't count as calls). Ids look
   like `table:orders`, `route:GET /api/x`, `timer:...`, `env:ANTHROPIC_API_KEY`. It skips dot-folders and
   folders such as `docs`, `test`, `scripts`, `build`, `examples` (full list: `excludedDirs` in `inventory.json`);
   if real app code lives in one of them, say so in the report. SQL identifiers currently match by exact case;
   manually confirm differently cased CREATE/read/write/DROP/RENAME references before claiming a table is unused
   ([dialect-aware matching follow-up](https://github.com/Doogit/claude-skills/issues/3)).
2. **Understand** — read the README / plan docs for intent, then confirm in code. Group inventory items into 4–7
   stages in data order. Note what looks broken or unused (empty tables, no-caller functions, write-only stores).
3. **Write `model.json`** (schema below). For large apps, write a small generator script outside the repo that
   emits `model.json`; it is easier to fix than a hand-edited 2,000-line JSON. For every store edge, open that
   store's inventory `writes`/`reads` sites and name the function that contains the cited line; the edge's source
   must be that function's stage. A `noCallers` entry is one function (inventory gives its `line`..`endLine`), not
   its module: a "has callers" claim must be about the function that holds the site, so grep callers of that
   function before writing "live" or "nothing calls X".
4. **Verify loop** — `node <SKILL_DIR>/dfd.mjs verify <repo> --out <dir>` (add
   `--live sqlite --db <path> [--sqlite-module <path to better-sqlite3 or a package.json that has it>]` when the app
   has a SQLite DB). Fix every error and re-run until it passes with coverage ≥ 90%. Account for uncovered inventory
   items with a node's `inventory` list or an `excluded` entry with a real reason. Writes `model.checked.json` and
   `report.md`. For "which X never happened" facts (rules that never fired, states never reached), count rows per
   value of an id/enum column: `node <SKILL_DIR>/dfd.mjs groups <db.sqlite> --by <table.column> [--by …]
   [--sqlite-module <path>]`. It refuses columns with over 200 distinct values. Write the result as `source: "live"`
   health items and compare against the registered list in code.
5. **Adversarial review** — dispatch ONE fresh subagent (a mid-tier model such as Sonnet is enough) with only the paths to `model.json`,
   `inventory.json` and the repo. Prompt: "Try to refute every edge label, every `does`/`when`, and every health
   item in this model against the code. For each refutation give the claim, why it is wrong, and file:line
   evidence. For each edge into or out of a store, state which function contains the cited line and whether the
   edge's source really is that function. Don't edit files. Return a list, at most 40 lines." The reviewer is not an
   oracle: spot-check every high-severity refutation against the code before accepting it. Fix the model for each
   refutation that holds and re-run verify. List refutations you did not fix (and why) under a `## Review` heading
   appended to `report.md`.
6. **Render** — `node <SKILL_DIR>/dfd.mjs render <repo> --out <dir>` → `<dir>/index.html`.
7. **Look at it** — if you have a browser tool, serve the dir with a tiny Node static server on 127.0.0.1
   (background; stop it after), since browser tools often block file://. With no browser tool, ask the user to open
   `index.html` and report what they see. Check every view for boxes or labels overlapping, try the walkthrough,
   the problems toggle and drill-in, read console errors. Fix the model (split crowded views, shorten labels, add
   `pos` hints only as a last resort) and re-render. If the browser window can't be resized, count instead of
   eyeballing: in the page, loop the `VIEWS` object and, per view, count box overlaps with `overlaps(a, b)` (rects
   `[x, y, w, h]`) and edge crossings with `crossCount(c, d)` (two edge curves). Target 0 edge-through-box; note
   crossings above 3 in the report. A hidden tab stalls requestAnimationFrame, so use real clicks, not scripted ones.
8. **Report** — path to `index.html`, verify line (errors/warnings/coverage), the top problems the diagram shows,
   inferred edges, unfixed refutations. Don't publish or upload it unasked. Say where the output lives: temp-folder
   output is temporary, so copy `index.html` (+ `model.json` and the generator) somewhere durable.

## Model rules

- Element kinds: `actor` (outside person/system), `process` (a step that does work), `store` (where data is kept),
  plus `system` (the whole app, L0 only), `port` (link to a neighbouring stage), `unused` (built but not
  connected), `group` (a box holding processes that share flows).
- **One view per question**; the question is the heading. L0 "What goes in, and what comes out?", L1 "What path
  does the data take?", L2 one per stage ("How are orders checked?").
- **≤ 10 nodes per view** (hard cap 12; groups don't count). Over the cap → split into a child view or a group.
- Names come from what a user recognises, not identifiers ("Order history", not `writeOrderRows`). `does` is 1–3
  plain sentences; use `[[term]]` for glossary words and define each in `glossary`.
- Edge labels are **data nouns** ("priced orders"), not verbs. `when` says how often ("every 2 s", "on click").
- DFD lint (verify enforces): no store→store, actor→store or actor→actor edges; every process has an input and
  an output (ports and actors count).
- Child views are **balanced**: a stage's L2 view shows its parent neighbours as ports/actors.
- `opens` on a node = the child view id (makes it drillable); these links must not form cycles. `go` on a port
  = the view it links to and may link back to a parent.
- Health items: `sev` `broken` (wrong or failing) / `warn` (needs attention) / `unused` (built, never
  used), `source` `code` / `live` / `plan`, `title`, `detail`, `evidence`. Verify auto-adds items for write-only /
  read-only stores and empty tables (live).
- **`broken` needs code evidence**: a `source: "code"` anchor that shows the failure (verify errors otherwise). A
  live-only zero, or a plan-vs-live mismatch, is `warn`, and its `detail` names the possible causes: a data reset
  (check data age, e.g. the oldest row timestamp), opt-in feature, deferred human step, trigger data absent.
- Before writing any problem item, check the plan for parked / planned / deliberately-removed status and say so in
  the item. A never-fired rule or write-only table is often expected, not a defect.
- Unreachable processes must be `type: "unused"` or carry an `unused` health item. A store read/write that sits
  inside a no-caller function is not live: verify warns on it, errors if an edge cites it from a node shown as live,
  and ignores it for the automatic write-only / read-only items.
- Walks: one walkthrough of 6–12 steps following one real item through L1, each step a node or `"a>b"` edge with
  a `title` and a sentence.

## Schema (minimal example)

```json
{
  "meta": { "repo": "acme", "commit": "<sha>", "generated": "2026-10-14", "app": "Acme",
            "note": "Every drawn flow cites a code line." },
  "glossary": { "turn": "One reply from the model, with its token counts." },
  "views": [
    { "id": "context", "level": 0, "title": "The whole picture", "question": "What goes in, and what comes out?",
      "intro": "Acme reads your [[turn]]s and shows where money goes.",
      "nodes": [
        { "id": "logs", "type": "actor", "label": "Session logs", "sub": "one file per session",
          "does": "…", "evidence": [{ "file": "src/ingest.ts", "line": 40, "anchor": "readdir(" }] },
        { "id": "app", "type": "system", "label": "Acme", "opens": "journey", "does": "…",
          "evidence": [{ "file": "src/index.ts", "line": 12, "anchor": "listen(" }],
          "inventory": ["bin:acme"] }
      ],
      "edges": [
        { "from": "logs", "to": "app", "label": "new lines", "when": "every 30 s",
          "evidence": [{ "file": "src/ingest.ts", "line": 41, "anchor": "setInterval" }] }
      ] }
  ],
  "walks": [{ "id": "one-line", "title": "Follow one log line", "view": "journey",
              "steps": [{ "node": "s1", "title": "Read", "text": "…" }, { "edge": "s1>db", "title": "Saved", "text": "…" }] }],
  "excluded": [{ "inventory": "env:DEBUG", "reason": "dev-only switch" }]
}
```

Every check and accepted field: `<SKILL_DIR>/lib/verify.mjs`; a full working model:
`<SKILL_DIR>/test/fixtures/ts-mini/docs/dataflow/model.json`.

## Done means

`verify` passes with coverage ≥ 90%, the adversarial review has run, the viewer renders with no console errors,
and you looked at every view. Green verify alone is not "accurate" — the user's confirmation is.
