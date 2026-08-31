---
name: dynamic-workflows-plan
description: "Create an implementation plan structured for execution by a Dynamic Workflows orchestrator / Conductor (multi-agent fan-out). Extends ce-plan: produce the plan substance with ce-plan's methodology, then partition into orchestrator-session phases with per-unit dispatch headers, named gates, an orchestration/commit model, a context-minimization contract, dependency mapping, and a follow-on registry. Use when the user says 'plan this for Dynamic Workflows', 'make a workflow-executable plan', 'plan a fan-out / multi-agent build', 'Conductor plan', or when a plan will be run by a Workflow rather than a single session. Repo-agnostic."
argument-hint: "[optional: feature description, requirements/plan doc path, or master-plan path to fold into]"
---

# Dynamic-Workflows Plan

`ce-plan` defines **HOW** to build. This skill defines **how a Dynamic Workflows orchestrator (Conductor) will
execute that build across many subagents** — so the plan is dispatch-ready without re-scoping, keeps orchestrator
and agent context tiny, and never mints avoidable approval prompts or wrong-branch commits.

**This skill extends `ce-plan`; it does not replace it.** Produce the plan *substance* (problem frame,
research, implementation units, test scenarios, dependency order) by following `ce-plan`. Then apply the
**Dynamic-Workflows structuring layer** below. The DW layer is the value-add; the substance still comes from
`ce-plan`'s quality bar.

## When to use

- The plan will be executed by a **`Workflow`** (fan-out of subagents), not a single interactive session.
- The work splits into **phases that each fit one orchestrator session** (one worktree / branch / PR).
- You want the Conductor to author the Workflow script **deterministically** — collisions, gates, and
  ownership readable from the plan, not re-derived.

**Not for:** a single-session task (`ce-plan` → `ce-work` is enough), or work that cannot be partitioned into
file-disjoint units. If unsure whether fan-out is warranted, plan with `ce-plan` and note the fan-out option.

## Executor profiles

The orchestration/commit model below (Step 4) targets the default executor: a **Claude-subagent fan-out**
(one shared worktree per phase, agents edit+gate only, orchestrator commits serially). If the plan will be run
by **`dynamic-workflows-codex`** instead, say so in the plan and note the differences — that executor uses a
**worktree per task**, **commits each passing task itself** on `dwc/<id>`, and its Codex workers see **only
their task prompt** (zero conversation context), so every work order must be fully self-contained and
`verifyCmd`-shaped gates matter (prefer `npx --no-install` checks resolvable from root `node_modules`). The
Dispatch headers, `owns`/`reads` sets, and named gates carry over verbatim — its decomposer consumes them
directly; only the Step-4 commit/worktree mandates differ.

## Core principle (why every rule below exists)

Token spend ≈ **context-size × turns** (~98% is context re-read each turn). Two levers dominate:
**keep the orchestrator thread tiny**, and **give each subagent only its slice**. Every structuring rule
here serves one of those, or serves *correctness of parallel execution* (no wrong-branch commits, no
false-fail gate reports, no undetected file collisions).

---

## Workflow

Run `ce-plan` Phases 0–4 first (research + units + test scenarios + dependency order). Then layer these steps.
Write tight — a bloated plan defeats the context lever it exists to protect.

### Step 1 — Partition into orchestrator-session phases

A **phase = one Conductor session = one worktree + branch + PR = one `Workflow` run.** Size each phase so a
single orchestrator can dispatch it, verify it, and land one PR.

- Group `ce-plan` units into phases by **shared subsystem and file-disjointness**, not by conceptual theme.
- Two units may run in **parallel within a phase only if their write sets are disjoint.** Split across phases
  when they touch a different subsystem OR when one carries a gate the other doesn't.
- Prefer **fewer, well-scoped phases** over many tiny ones — each phase pays worktree + gate overhead.
- **Scope guard:** name what keeps phases disjoint (e.g. a loosely-typed field change stays backend-only);
  flag anything that would pull in a shared file and push it to a follow-on.
- Each phase gets a **session-map row**: `Phase | units | fan-out shape | isolation (file sets)`.

### Step 2 — Write a per-unit Dispatch header

Every implementation unit carries a one-line header the Conductor parses to author the Workflow:

```
> Dispatch: <model> · <effort> · owns <write-set globs> · reads <bounded read-set> · gate <NAMED_GATE>
```

- **owns** = the unit's **write set** (files it edits/creates). This is what makes collision detection
  *mechanical*: two units in a phase collide iff their `owns` globs intersect. A shared **read** never collides.
- **reads** = the **bounded read set** beyond `owns`: the fixture-pattern test to mirror + the *one* external
  contract file (schema, spec section, sibling implementation) the unit must honor. Naming it stops the agent
  grepping the tree.
- **model / effort** = right-sized *per unit* (Step 6). Spec-following on a settled contract is the cheap tier;
  reserve the top tier for a genuinely hard slice.
- **gate** = a named gate defined once (Step 3).

### Step 3 — Define named gates once

Define each gate **once**, reference by name from every unit's Dispatch header. A gate names the exact
command sequence AND its known false-fails.

- **Scope the gate to the surface changed** — skip UI-build / smoke / e2e for a backend-only phase; skip
  backend suites for a docs/UI-only phase. Running gates the change can't affect wastes wall-clock and invites
  spurious failures.
- **Bake in known false-fails so agents don't report green as FAIL:** environment quirks (e.g. a sandbox
  `spawn EPERM` that passes on an elevated retry), and **wrong-root / monorepo dep false-fails** — always gate
  **from inside the phase worktree**, because a run from the wrong root mis-reports missing dependencies.
- Auto-fix formatting only on files the phase touched.

### Step 4 — State the orchestration + commit model

This is where parallel execution goes wrong. State it explicitly per phase:

- **Agents edit + gate only; the orchestrator commits, serially,** via `git -C <worktree>`. Never let a
  subagent commit — its cwd can reset mid-run and land the commit on the wrong branch.
- **Units of one phase share ONE worktree** (they land on one branch/PR). Do **not** give each agent its own
  worktree isolation — parallel writes to *disjoint files in the shared tree* are fine; commits are serialized.
- Give **separate worktrees only to phases you run concurrently.**
- **Serialize any real shared write** (two units' `owns` intersect) — but first *verify the write actually
  happens*; a shared constants/threshold file is often only read, not written (see Anti-patterns).
- **Default fan-out shape is pipeline;** a barrier (parallel-then-wait) only where a stage genuinely needs
  all prior results. Find → adversarially verify each finding before the orchestrator commits.

### Step 5 — Write the context-minimization contract

Put this block in the plan so the Conductor authors a lean Workflow:

- **Agents receive the single work-order text as their prompt and never open the plan doc.** Biggest saver.
- **Work orders are self-contained** (`owns`/`reads`/`gate` + inline acceptance) so an agent opens only its
  `owns`+`reads` files.
- **Conductor entry point:** read only the work-order block + the session-map — not the whole plan.
- **Author shared guardrails once** as a Workflow script constant prepended to each agent prompt — not restated
  per unit.
- **Fixed return contract, nothing else:** *what changed · files touched · verify result (command + outcome) ·
  open questions.* Push diffs / full logs to an **artifact file**; return a **≤3-line pointer**. Run the whole
  fan-out as **one `Workflow`** that synthesizes in a final stage and returns a compact digest — so agent
  tool-output never lands in the main thread.

### Step 6 — Dependency map + right-sizing + follow-on registry

- **Dependency graph:** nodes with **no inbound edge are independently shippable now**; gated nodes carry
  **blocker + unblocked-by**. Parallelize two units only when file sets are disjoint.
- **Right-size model per unit at dispatch** — challenge any model named in a handoff/plan/prior session; it's a
  default to *beat*, not a mandate. If only one sub-slice is hard, split it out rather than provisioning the
  whole phase up.
- **Follow-on registry — account for everything the wave spawns.** Every follow-on (a deferred UI surface, a
  gated economic model, an owner decision, a post-data calibration) gets a **row in the right kind**
  (buildable / blocked-research / owner-decision) with blocker + unblocked-by — never buried inline in a work
  order. **Cross-link duplicates** to existing items instead of re-adding them.

### Step 7 — Plan home + handoff

- **Plan home decision (single source of truth):** if a master/registry plan already exists, **fold this in**
  (add rows + work orders + a session-map block + graph edges) and mark the source doc absorbed — do **not**
  spawn a parallel plan doc. Otherwise write a standalone DW plan.
- **Definition of done, per phase:** true-up the affected rows **in place** (status + verified date), commit
  the plan edit, stop. Never spawn a new followon/next-session doc.
- **Budget gate before any dispatch:** the orchestrator cannot read the status line — have it ask the operator
  for live `ctx / 5h / 7d` and **checkpoint instead of dispatching if elevated.**

---

## Templates

**Dispatch header (per unit):**
```
> Dispatch: sonnet · medium · owns `path/to/thing.ts` · reads its test (fixture pattern) + `path/to/contract.ext` · gate G-UNIT
```

**Named gate (once, in the session-map section):**
```
- G-UNIT (<phase, surface>): lint (auto-fix touched files) · typecheck · targeted `<test glob>` · then full test.
  Skip <gates the change can't affect>. Known false-fails: <env quirk → retry>; gate from inside the worktree.
```

**Session-map row (per phase):**
```
| Phase-N — <name> | U1, U2, U3 | <fan-out: which parallelize, which serialize + why> | <file sets; disjoint from Phase-M> |
```

**Optional machine-readable manifest** (when you want the Workflow script fully data-driven — a fenced block
the Conductor parses instead of the markdown headers):
```yaml
phase: Phase-1
units:
  - id: U1
    model: sonnet
    effort: medium
    owns: ["src/a.ts"]
    reads: ["test/a.test.ts", "src/contract.ts"]
    gate: G-UNIT
```

---

## Anti-patterns (observed, avoid)

- **Asserting a shared-file collision without checking.** "Both units edit the constants file → serialize" —
  when neither actually writes it. Read the file; confirm the write; only then serialize. Over-serializing
  silently kills the parallelism the phase exists for.
- **Per-agent worktrees for same-branch units.** Fragments one PR into conflicting trees.
- **Letting a subagent commit.** cwd race → wrong branch.
- **Passing the whole plan to every agent.** Re-reads a 600-line doc per agent per turn — the exact spend this
  structure exists to prevent.
- **Running every gate on every phase.** A backend-only change failing a flaky UI perf gate reads as a
  regression it didn't cause.
- **Burying follow-ons inline.** "…unless a supported model is added" in a work order is a lost item; register
  it as a row.
- **Spawning a new next-session/followon plan doc.** Breaks single-source-of-truth; true-up in place.
- **Bloating the plan to look thorough.** The plan is read at dispatch; padding is re-read tax. One idea per
  sentence; a unit is intent + at most one qualifier.

## Reference

For worked examples of each contract element (a real phased detector-refinement wave, a folded master-plan
registry, dispatch headers, named gates, and the follow-on registry), see
`references/dw-contract.md`.
