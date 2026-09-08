# dynamic-workflows-codex â€” reference

This public export was refreshed on September 8, 2026. Before execution, run the
skill's preflight capability checks against your installed Claude Code and Codex CLI.
The original local smoke tests used codex-cli 0.150.1 and Claude Code 2.1.246;
they are historical evidence, not a compatibility guarantee for this export.

## Worker configuration

Model availability depends on your account and runtime. Check the selected model
before running; change `WORKER_MODEL`, `WORKER_EFFORT`, and `REPAIR_EFFORT` in the
workflow if needed. The installer does not create aliases or modify global config.

Worker default = **`gpt-5.6-terra` at `model_reasoning_effort="medium"`**. Set in the workflow
(`WORKER_MODEL` / `WORKER_EFFORT`; repair rounds use `REPAIR_EFFORT="high"`) and passed to the
worker through the task contract's `model` / `effort` fields.

## Verified `codex exec` invocation

Invocation pattern (verify support locally before use):

```
codex exec \
  -m gpt-5.6-terra \
  -C "<absolute worktree dir>" \
  -s workspace-write \
  -c approval_policy="never" \
  -c model_reasoning_effort="medium" \
  --skip-git-repo-check \
  --output-schema "<absolute schema.json>" \
  -o "<absolute last.json>" \
  "<prompt>" \
  </dev/null 2>"<stderr file>"
```

Verified flag facts (from `codex exec --help`, codex-cli 0.150.1):

- **Model:** `-m, --model <MODEL>`.
- **Reasoning effort:** NOT a flag â€” set via `-c model_reasoning_effort="<low|medium|high|xhigh>"`.
- **Sandbox:** `-s, --sandbox <read-only|workspace-write|danger-full-access>`.
- **Approval:** NOT a flag for exec â€” set via `-c approval_policy="never"`.
- **Working dir:** `-C, --cd <DIR>` sets the working directory; verify actual write locations after execution.
- **Output schema:** `--output-schema <FILE>` â€” path must be **absolute** (relative paths failed to resolve).
- **Final message:** `-o, --output-last-message <FILE>` â€” writes ONLY the final JSON message; read this, don't scrape stdout.
- **`--json`** emits JSONL events (not needed; `-o` is cleaner).
- **`--skip-git-repo-check`** allows running outside a git repo (harmless inside a worktree).
- **stdin:** close it (`</dev/null`) or codex blocks on "Reading additional input from stdin...".

## Design note â€” why explicit worktrees instead of `isolation:'worktree'`

`isolation:'worktree'` creates a *fresh* worktree per `agent()` call and always targets the
*session* repo. This tool needs (a) Implement -> Verify -> Repair to share ONE worktree per
task, and (b) to target the repo that the *plan* lives in (which may differ from the session
repo â€” e.g. a fixture). Per-call isolation can do neither. So each task gets a deterministic
worktree `<repo_root>/.worktrees/dwc-<task_id>` on branch `dwc/<task_id>`, created by the
first codex-worker and reused by verify/repair. `repo_root` is auto-discovered by the
Decompose agent via `git rev-parse --show-toplevel` on the plan's directory (override with
`args.repo`). `.worktrees/` is added to `.git/info/exclude` automatically.

Independent tasks start from HEAD. A task with one accepted dependency starts from
that dependency's committed branch. Multiple dependencies currently impose ordering
only: combine their changes through an explicit integration step before assuming they
are all present. Integration is manual, guided by `suggested_merge_order`.
Acceptance commands run in each task worktree; install project dependencies as required.

**A diff-only `pass` verdict is NOT green CI (verified 2026-08-29).** When no `verifyCmd` runs
(the common case â€” no deps in the worktree), the Sonnet reviewer judges from the diff alone and
CANNOT catch `tsc`/lint/test-run failures. A task passed review while a component carried
6 real type errors (null-narrowing in closures) that `tsc --noEmit` fails on. Always run the
project typecheck/tests on a "passed" branch before trusting it. **You often can, in-worktree:**
Node resolves `node_modules` by walking UP, so when `node_modules` lives at the *repo root*
(the parent of `.worktrees/`), `cd <worktree> && npx --no-install vitest run <file>` and
`npx --no-install tsc --noEmit -p <tsconfig>` resolve deps from the root and test the worktree's
own edited files â€” no install needed. (`next lint`/`eslint` may still need a local install; defer
lint to CI.) When node_modules sits at the repo root, a `verifyCmd` of exactly this shape makes the
gate real instead of advisory.

**Commit-on-pass:** the codex-worker leaves its changes uncommitted (so the Sonnet verifier
reviews the raw working tree). Only after a task's FINAL verdict is `pass` does a haiku step
`git add -A && git commit` it on its `dwc/<id>` branch â€” making the branch diffable and PR-able.
Failed tasks stay uncommitted for rework. Nothing is ever pushed or merged.

**Verify sees NEW files (fixed 2026-08-29):** the verify step first runs `git add -A`, then diffs
`--cached`. A plain `git diff` shows tracked changes only, so any task whose deliverable is a *new*
file (a new component, a new migration) was false-failed with a "file untracked / absent from the
diff" BLOCKER even though the file was complete on disk and `add -A` at commit would have shipped it.
Staging at review time is harmless (it does not commit) and makes untracked files visible to the
reviewer. Symptom that this regressed: every new-file task fails with an "absent from the diff"
finding while `git status` in the worktree shows the file as `??`.

**Authorization failures:** the worker uses unattended `approval_policy="never"`
inside `workspace-write`. This does not grant permission or bypass a sandbox. Run only
within previously authorized scope. Permission or authorization denials stop the public
workflow; resolve them before retrying. No installer changes permission settings.

**Codex writes leaked to repo root (seen 2026-08-30):** despite `-C <worktree>` +
`-s workspace-write`, a task's file edits sometimes land in the **session/plan repo root** instead
of its worktree, and the worker then cannot create the commit (`.git/index.lock` cannot be written
under the sandbox). Symptom: the verifier reports the `dwc/<id>` branch as clean/identical to main
("worker did nothing" / empty worktree) while `git -C <repo-root> status` shows the task's files
modified/untracked in **root**. Preserve the changes and compare with the pre-run root status. Establish ownership
before copying files into a task worktree. Do not restore or delete root files without
explicit authorization for the exact paths. Always inspect root status when a task
reports an unexpectedly empty worktree.

## No forks / no session-context leakage

- No `agent()` call uses `subagent_type:'fork'`. Follow any additional routing rules in your environment.
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
