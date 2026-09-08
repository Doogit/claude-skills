---
name: dynamic-workflows-codex
description: Run an implementation plan file through a Claude Code dynamic workflow where Opus orchestrates and Codex models (gpt-5.6-terra @ medium) do the implementation via `codex exec`. Use when the user says "/dynamic-workflows-codex <plan>", "run this plan with codex workers", "have codex implement this plan", or points at a plan file and wants Codex to build it while Claude orchestrates and verifies. Always does a slice:2 pilot first, never auto-merges.
---

# dynamic-workflows-codex

Orchestrate a plan file: **Opus** decomposes it into dependency waves, **Codex** (`gpt-5.6-terra`
at `medium` effort) implements each task in its own git worktree via `codex exec`, **Sonnet**
verifies + adversarially reviews each diff, **Sonnet** synthesizes a merge report. It never
auto-merges and never forks. Read `reference.md` (next to this file) for the verified
`codex exec` flags, model ids, and schemas.

The saved workflow is `~/.claude/workflows/dynamic-workflows-codex.js`; the worker subagent is
`~/.claude/agents/codex-worker.md`.

## Procedure

### 1. Preflight (do all before running anything)

- **Codex auth:** run `codex exec -m gpt-5.6-terra --skip-git-repo-check -s read-only "reply OK" </dev/null`
  (or `codex login status` if available). If it errors on auth, stop and tell the user to `codex login`.
- **Permissions:** confirm the intended CLI execution is authorized under the user's
  current settings. If denied, stop and report what needs resolution. Do not edit
  global settings or add permission allowlists.
- **Plan file exists** and names identifiable tasks (files + acceptance). If it's too vague to
  decompose, say so and ask the user to sharpen it.
- **Git state:** require a clean target repo root before execution; preserve existing changes and stop if dirty.
  Worktrees are created under `<repo>/.worktrees/` (auto-added to `.git/info/exclude`).

### 2. Always run a slice:2 pilot first — then STOP

(Not to be confused with `dryRun: true`, which stops after decomposition with no implementation.)
Invoke the workflow with a 2-task slice:

```
Workflow({ name: "dynamic-workflows-codex", args: { plan: "<abs path to plan>", slice: 2 } })
```

When it finishes: show the user (a) the generated script path from the tool result, (b) the
final report object, and (c) the per-agent token totals from `/workflows`. Confirm the
`codex-worker` agents actually shelled out to `codex exec` (they should show a Bash call to
`codex exec ...`). **Do not proceed to the full run without the user's go-ahead.**

**Triage the pilot — two outcomes look like a plain fail but aren't:**
- **Leaked to root.** The worktree is clean/identical to main, but the edits are sitting
  uncommitted in the **repo root** — Codex wrote outside `-C` and couldn't write `.git/index.lock`.
  The reviewer reports this as "worker did nothing"; it's actually complete code in the wrong place.
  `git -C <repo-root> status` and recover it (see §4), don't re-run blind.
- **False-green.** A task "passed" its `verifyCmd` because the check was a source grep the worker
  satisfied with an untested indirection (a config const, a spread) rather than the real behavior.

If the pilot shows either — especially for small, collision-free slices — weigh finishing the
work **directly** over re-dispatching. (One poor pilot burned ~410k tokens for 0 clean passes.)

### 3. Full run — only on explicit go-ahead

```
Workflow({ name: "dynamic-workflows-codex", args: { plan: "<abs path to plan>" } })
```

Optional args: `repo` (override the auto-discovered repo root), `dryRun: true` (decompose only,
no implementation), `slice: <n>` (first n tasks).

### 4. After completion

- Print the report: per-task status, branch (`dwc/<id>`), worktree path, files touched,
  unresolved findings, and the suggested merge order.
- List the worktrees: `git -C <repo> worktree list`.
- **Check the repo ROOT for leaked edits — not just the worktrees.** Run
  `git -C <repo> status --porcelain` on the root. Codex has been seen to write a task's (usually
  correct) implementation into the repo root instead of its worktree and then fail to commit, so the
  verifier reports the `dwc/<id>` branch as "clean / identical to main / worker did nothing" while the
  code is actually live in root — dirtying `main` and endangering any parallel session. If root is
  dirty on a task's files, stop and preserve the changes. Compare against the pre-run
  root status and establish ownership before copying anything. Do not restore or delete
  root files without explicit authorization for those exact paths.
- **Gate every "passed" branch before trusting it.** A diff-only `pass` verdict is NOT green CI —
  when no `verifyCmd` ran, the reviewer judged from the diff and cannot catch type/test failures
  (a task once passed review carrying 6 real `tsc` errors). If the repo root has `node_modules`,
  run from inside each passing worktree: `npx --no-install tsc --noEmit -p <tsconfig>` and
  `npx --no-install vitest run <touched tests>` (Node resolves deps by walking up to the root).
- **Hand off to the user's normal gate/PR flow. Do NOT merge.** Each passing task is committed
  on its own branch (`dwc/<id>`) in a task worktree (single-dependency tasks start from their accepted dependency branch); the user integrates in the
  suggested order, running their own gates (tests/typecheck/lint) with deps installed. Failed
  tasks are left uncommitted in their worktree for rework.

## Context hygiene (orchestrator session)

- The Workflow keeps all subagent tool output (codex runs, diffs, reviewer reasoning) OUT of
  the main thread. The only thing that lands back in your context is the **compact return** —
  ~1 line per task + counts + short notes. That's deliberate.
- **Full detail is already on disk** in the run's `journal.jsonl` (one line per agent, full
  return). To drill into a specific task's codex output or a reviewer's findings, `Read` the
  relevant slice of that file — do NOT pass `verbose:true` just to inspect one task.
- `args.verbose: true` inlines the full report + raw digest into the return. Use it only for
  debugging the workflow itself; it defeats the context savings on large plans.
- When relaying results to the user, summarize from the compact return; don't paste raw JSON.

## Cleanup

After the user has merged (or abandoned) the task branches, remove the worktrees so they don't
accumulate: `git -C <repo> worktree remove <path>` for each, then `git -C <repo> worktree prune`.
The branches (`dwc/<id>`) remain until the user deletes them.

## Notes

- **Worker model/effort:** `gpt-5.6-terra` at `medium`; repair rounds escalate to `high`.
  Both live in the workflow (`WORKER_MODEL` / `WORKER_EFFORT` / `REPAIR_EFFORT`) and reach the
  worker via the task contract — change them there, never in the agent file or per-run.
- **Worktree deps:** worktrees have no `node_modules` of their own, but Node resolves deps by
  walking UP — when the repo root has `node_modules`, `npx --no-install tsc/vitest` run from
  inside the worktree and make `verifyCmd` a real gate. The decomposer prefers that shape; only
  a repo with no root deps falls back to dep-free checks + diff-only review.
- **DW-structured plans compose:** if the plan was written by `dynamic-workflows-plan` (Dispatch
  headers / YAML manifest / named gates), the decomposer takes `files[]`, waves, and `verifyCmd`
  from that structure verbatim instead of re-deriving them. Note the executor difference: this
  workflow uses a worktree per task and commits on pass, not that skill's shared-phase-worktree /
  orchestrator-commits model.
- **Independent worktrees, except chains:** tasks don't see each other's uncommitted work;
  that's why integration is manual and ordered by the report. Exception: a task with exactly
  ONE dep is a chain link — its worktree is based on the dep's committed `dwc/<dep>` branch
  (so it can build on that code), and it's skipped (`skipped-dep-failed`) if the dep didn't
  pass. Consequences: a chained branch contains its dep's commits (merge deps-first, which
  `suggested_merge_order` already does), and abandoning a dep orphans its chain. The
  decomposer splits any `l`-sized task into such a chain; multi-dep tasks are ordering-only
  and still base on HEAD.
- **Acceptance greps are gameable — prefer behavioral checks.** A `verifyCmd` that greps source
  (e.g. `grep -q 'type="step"'`) rewards satisfying the *string*, not the *behavior*: a worker can
  park the change in a config const/spread that fails the grep (or write a test that only asserts the
  constant), and the review can't run the code to catch it. When authoring plans, write `verifyCmd`
  as a test that renders/exercises the change; when gating a "passed" branch, distrust any test that
  asserts on a constant or exported config instead of observed output.
