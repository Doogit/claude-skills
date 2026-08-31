# dynamic-workflows-codex — reference

Verified on 2026-08-27 on this machine. Do not hardcode from memory — re-run Step 0 if the
Codex or Claude version changes.

## Verified environment

| Thing | Value (verified) |
|---|---|
| `claude --version` | 2.1.246 — supports `workflowSizeGuideline` (>=2.1.219) |
| `codex --version` | codex-cli 0.150.1 |
| `CLAUDE_CODE_SUBAGENT_MODEL` | NOT set — per-agent `model:` routing works |
| agent-model-guard hook | denies `fork` subagents, `explore`+opus, and generic+no-model. Our agents always pass an explicit `model` and use named agentType `codex-worker`, so none trip it. |

## Codex models (agent personas, from `~/.codex/config.toml`)

| Model id | Tier | Use |
|---|---|---|
| `gpt-5.6-luna` | lightweight | **worker default** (this tool) |
| `gpt-5.6-terra` | medium | heavier implementation |
| `gpt-5.6-sol` | heavy | orchestration/hard reasoning (not used here) |

Worker default = **`gpt-5.6-luna` at `model_reasoning_effort="xhigh"`** (extra-high).

## Verified `codex exec` invocation

Smoke-tested (exit 0, valid JSON written to the `-o` file):

```
codex exec \
  -m gpt-5.6-luna \
  -C "<absolute worktree dir>" \
  -s workspace-write \
  -c approval_policy="never" \
  -c model_reasoning_effort="xhigh" \
  --skip-git-repo-check \
  --output-schema "<absolute schema.json>" \
  -o "<absolute last.json>" \
  "<prompt>" \
  </dev/null 2>"<stderr file>"
```

Verified flag facts (from `codex exec --help`, codex-cli 0.150.1):

- **Model:** `-m, --model <MODEL>`.
- **Reasoning effort:** NOT a flag — set via `-c model_reasoning_effort="<low|medium|high|xhigh>"`.
- **Sandbox:** `-s, --sandbox <read-only|workspace-write|danger-full-access>`.
- **Approval:** NOT a flag for exec — set via `-c approval_policy="never"`.
- **Working dir:** `-C, --cd <DIR>` sets the workspace root (writes land here under workspace-write).
- **Output schema:** `--output-schema <FILE>` — path must be **absolute** (relative paths failed to resolve).
- **Final message:** `-o, --output-last-message <FILE>` — writes ONLY the final JSON message; read this, don't scrape stdout.
- **`--json`** emits JSONL events (not needed; `-o` is cleaner).
- **`--skip-git-repo-check`** allows running outside a git repo (harmless inside a worktree).
- **stdin:** close it (`</dev/null`) or codex blocks on "Reading additional input from stdin...".

## Design note — why explicit worktrees instead of `isolation:'worktree'`

`isolation:'worktree'` creates a *fresh* worktree per `agent()` call and always targets the
*session* repo. This tool needs (a) Implement -> Verify -> Repair to share ONE worktree per
task, and (b) to target the repo that the *plan* lives in (which may differ from the session
repo — e.g. a fixture). Per-call isolation can do neither. So each task gets a deterministic
worktree `<repo_root>/.worktrees/dwc-<task_id>` on branch `dwc/<task_id>`, created by the
first codex-worker and reused by verify/repair. `repo_root` is auto-discovered by the
Decompose agent via `git rev-parse --show-toplevel` on the plan's directory (override with
`args.repo`). `.worktrees/` is added to `.git/info/exclude` automatically.

Consequence: worktrees branch from HEAD and are independent — a later task does NOT see an
earlier task's uncommitted changes. Integration is manual, guided by the report's
`suggested_merge_order`. Acceptance commands run inside a worktree, which has NO `node_modules`
of its own — but see the next paragraph: root-level deps usually make real checks runnable anyway.

**A diff-only `pass` verdict is NOT green CI (verified 2026-08-29).** When no `verifyCmd` runs
(the common case — no deps in the worktree), the Sonnet reviewer judges from the diff alone and
CANNOT catch `tsc`/lint/test-run failures. A task passed review while `CatalogEditor.tsx` carried
6 real type errors (null-narrowing in closures) that `tsc --noEmit` fails on. Always run the
project typecheck/tests on a "passed" branch before trusting it. **You often can, in-worktree:**
Node resolves `node_modules` by walking UP, so when `node_modules` lives at the *repo root*
(the parent of `.worktrees/`), `cd <worktree> && npx --no-install vitest run <file>` and
`npx --no-install tsc --noEmit -p <tsconfig>` resolve deps from the root and test the worktree's
own edited files — no install needed. (`next lint`/`eslint` may still need a local install; defer
lint to CI.) When node_modules sits at the repo root, a `verifyCmd` of exactly this shape makes the
gate real instead of advisory.

**Commit-on-pass:** the codex-worker leaves its changes uncommitted (so the Sonnet verifier
reviews the raw working tree). Only after a task's FINAL verdict is `pass` does a haiku step
`git add -A && git commit` it on its `dwc/<id>` branch — making the branch diffable and PR-able.
Failed tasks stay uncommitted for rework. Nothing is ever pushed or merged.

**Verify sees NEW files (fixed 2026-08-29):** the verify step first runs `git add -A`, then diffs
`--cached`. A plain `git diff` shows tracked changes only, so any task whose deliverable is a *new*
file (a new component, a new migration) was false-failed with a "file untracked / absent from the
diff" BLOCKER even though the file was complete on disk and `add -A` at commit would have shipped it.
Staging at review time is harmless (it does not commit) and makes untracked files visible to the
reviewer. Symptom that this regressed: every new-file task fails with an "absent from the diff"
finding while `git status` in the worktree shows the file as `??`.

**Codex authorization race under concurrency (fixed 2026-08-29):** a wave runs `parallel(waveTasks)`,
so N tasks launch `codex exec … approval_policy="never"` simultaneously. Under contention the
permission gate denies some with `Permission denied: codex exec with approval_policy=never requires
explicit user authorization` — the worker returns `status:"failed"`, `exit_code:1`, and an EMPTY
worktree (no code written). Observed: 2-way concurrency is fine; 3-way denied 2 of 3. `implement()`
now retries (bounded, ×5) on that specific stderr signature so waves self-heal without
force-serializing codex. If it ever recurs at high fan-out, the next lever is a codex concurrency
semaphore (cap 2) rather than more retries.

**Codex writes leaked to repo root (seen 2026-08-30):** despite `-C <worktree>` +
`-s workspace-write`, a task's file edits sometimes land in the **session/plan repo root** instead
of its worktree, and the worker then cannot create the commit (`.git/index.lock` cannot be written
under the sandbox). Symptom: the verifier reports the `dwc/<id>` branch as clean/identical to main
("worker did nothing" / empty worktree) while `git -C <repo-root> status` shows the task's files
modified/untracked in **root**. The code is usually complete and correct — recover it into the
task's worktree (copy the files across, then `git restore` the tracked ones in root and delete the
leaked untracked ones) rather than re-running. Non-deterministic: in one slice:2 pilot, one task
leaked to root while the other wrote correctly in-worktree. Because a leak dirties the shared root,
**always postflight `git -C <repo-root> status` when any task reports an empty worktree** — a dirty
root under a parallel session is a real hazard, not a cosmetic one.

## No forks / no session-context leakage

- No `agent()` call uses `subagent_type:'fork'`; the `agent-model-guard` hook hard-denies forks anyway.
- Every Codex worker gets a fully self-contained contract prompt. The Decompose agent is
  explicitly instructed to write task prompts for a model with zero conversation context.

## Schemas (authoritative copies live in the workflow script)

**RESULT** (codex-worker return):
```json
{ "status":"ok|failed", "codex_output":{...}|null, "exit_code":0,
  "files_touched":["path", "..."], "stderr_tail":"...", "error":null }
```

**FINDINGS / VERDICT** (Sonnet verifier):
```json
{ "pass":true, "severity":"none|low|medium|high|critical", "diffstat":"...",
  "findings":[{ "summary":"...", "file":"path|null", "suggestion":"...|null" }] }
```

**TASKS** (Opus decompose): `{ repo_root, tasks[]{id,title,files[],acceptance,deps[],size,prompt,verifyCmd?}, waves[][] }`.
**REPORT** (Opus synthesize): `{ tasks[]{id,title,status,branch,worktree,files_touched,unresolved_findings[]}, suggested_merge_order[], notes }`.

## args

`{ plan: "<path>", slice?: <n>, dryRun?: true, repo?: "<repo root override>" }`
