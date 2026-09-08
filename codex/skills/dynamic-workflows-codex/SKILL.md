---
name: dynamic-workflows-codex
description: Execute durable implementation plans with dependency-aware scheduling and appropriately sized native Codex workers. Use for running plans with workers or orchestrating implementation; supports planning-only and bounded pilots.
---

# Dynamic workflows for Codex

The primary owns scope, scheduling, integration and final judgment. Use native Codex collaboration
for bounded implementation and independent review when it adds value; do not fill slots for their
own sake. No Claude wrapper or additional MCP is required.

## Invocation and authority

Interpret ordinary language; these are prompts, not CLI arguments:

- `$dynamic-workflows-codex <plan path> -- plan only`
- `$dynamic-workflows-codex <plan path> -- execute UA1-UA3, working tree only`
- `$dynamic-workflows-codex <plan path> -- pilot 2 ready tasks, local commits`
- `$dynamic-workflows-codex <plan path> -- execute all buildable items, local commits`

Honor selected scope and existing authority across resumes. Execution permits in-scope implementation;
it does not itself authorize commits, push, PRs, merges, publication, credentials or operator-gated
actions. Default to working-tree-only. Local-commit mode permits scoped commits; requested PR mode
includes normal push and PR creation. Integration into a task-owned branch is distinct from merging
the target branch. Never auto-merge the target.

Resolve routine implementation choices and missing evidence autonomously. A discovered prerequisite
is in scope when necessary for selected acceptance criteria and it does not materially expand the
feature or risk; record the rationale and dependency before doing it. Explicit exclusions and gated
rows remain binding. Ask when a decision changes scope, external commitments, authority or an
unresolved product contract. Continue unaffected authorized work while waiting.

Plan-only reconciles and writes a plan only when requested; no implementation workers. Dry-run is
strictly read-only, including checkpoints. A pilot selects min(N, eligible ready tasks) by plan
priority, dependency unlock value, then stable ID. State constraints reducing the selection; stop
after those attempted outcomes, including failures, without substituting tasks to achieve N passes.
For full execution, start small when assumptions are new and continue without a pilot approval gate.

## Routing and context

Use the current primary and follow user model choices, applicable AGENTS.md and live tool schemas.
Keep machine-specific role/model defaults in that configuration, not in this procedure. A skill
cannot switch the primary model. Never change global configuration or evade routing hooks.

Route by uncertainty, consequence and coupling: ordinary implementation, substantive investigation,
mechanical work, and difficult architecture/security/review may need different available routes.
Split work at stable interfaces before increasing model size or reasoning. Diagnose a substantive
failure before escalating. Reserve primary capacity and respect the live concurrency limit.

Use supported roles and explicit `fork_turns: "none"` by default with self-contained contracts;
a bounded 1-3-turn fork is optional when needed. Avoid full-history forks. Respect role-bound models.
Reuse workers for focused follow-ups. No recursive spawning unless assigned a bounded delegation
budget. Return compact results and evidence pointers, not raw exploration or test logs.

## Reconcile progressively

Read the governing plan, applicable AGENTS.md, branch/base/status and worktree inventory first.
Record pre-existing dirty paths without secret contents. Use the existing master registry rather
than a competing backlog. Map selected task IDs, dependencies, recorded state and explicit gates.
Do not treat old completion claims as newly verified evidence.

Inspect implementation, detailed specs and direct producer/consumer contracts for the next ready
tasks. Expand only to resolve dependencies, shared resources or material uncertainty. Classify items
as done, partial, ready, obsolete or blocked from evidence; leave uninspected claims provisional.
Avoid a whole-repository audit before useful work can begin.

Before substantial/risky edits, examine assumptions, acceptance, security/data behavior and shared
contracts. Use adversarial-plan-review when useful; do not turn routine tasks into mandatory audits.
Create ready-task contracts using [references/contracts.md](references/contracts.md). Verify stale
ownership and commands rather than copying them blindly.

## Schedule and checkpoint

Schedule by verified dependencies AND ownership. Serialize shared files, unstable interfaces,
schema changes and mutable resources. Distinguish code prerequisites from scheduling constraints.
All prerequisites must actually be present in the consumer checkout; graph order alone is insufficient.

Use dependency-local gates: accept, integrate and validate completed work as soon as safe, then
release its consumers without waiting for unrelated workers. Serialize integration itself. Use a
whole-wave barrier only for a shared contract, resource or required integrated check. Check the
integrated revision relevant to the consumer before releasing it. Hold affected consumers whenever
a prerequisite changes or fails; continue unrelated ready work within ownership constraints.

Persist compact state in the existing registry or its linked execution checkpoint, following repo
conventions. Before dispatch, record scope/authority, task ownership, input revision or identified
uncommitted state, acceptance and required checks. Immediately record returned worker IDs and active
state; if interrupted between spawn and recording, reconcile live agents before any replacement.
Checkpoint again on blocking, ownership/input changes, accepted integration and before handoff.
Maintain one first unfinished action plus pending tasks; keep temporary logs outside product docs.
Do not create a new journal for every event or duplicate the master backlog. Dry-run writes nothing.

## Execute and isolate

Give editing workers absolute task-owned worktree paths under the repo's prescribed location.
Workers verify `git rev-parse --show-toplevel` and branch, and use that path explicitly for commands
and patches. Creating a worktree does not change the parent's cwd. Never allow overlapping editing.
Read-only work may share a checkout, but review must observe a stable diff or detect changes to it.

- **Working-tree-only:** sequence edits in one isolated integration worktree. Parallelize independent
  investigation and review where safe. Dependents see verified prior edits without commits. Do not
  introduce parallel patch transfer merely to increase concurrency. If explicitly needed, define
  and validate transfer, including new files, ownership and checks before concurrent editing.
- **Local commits/PR:** independent task worktrees start from verified inputs. After required checks
  and review, commit only owned paths. The primary integrates accepted commits into a task-owned
  branch, checks the result and starts consumers from it, with all prerequisites materialized.

Isolate dependency installations, mutable caches, databases, ports and generated outputs. Parent
node_modules does not prove correct versions or checkout. Do not recursively clean through junctions.
If native collaboration is unavailable, proceed sequentially when sufficient and disclose the limit.
Use CLI workers only after verifying current flags/auth and preserving sandbox/approval policy;
never import permission allowlists, approval overrides or retries around permission denials.

## Acceptance and recovery

At each task acceptance/integration inspect tracked AND new files, status, base relation and worker
output. Confirm paths and checks belong to the intended worktree. Compare root status with the
baseline for leaks. Pause affected workers on unexpected edits; attribute ownership and preserve
both versions. Do not blindly restore/delete root files. Resume affected edits only once safely
isolated; if ownership remains ambiguous ask for the missing decision and continue unaffected work.

Match evidence to the change. Behavior changes need meaningful behavioral checks plus applicable
static checks; docs/mechanical changes may use source verification, rendering or structural checks.
Do not invent behavior tests for nonbehavioral edits. Run required repository gates regardless.
An exit-zero summary or grep cannot replace a required behavioral check. Record checks as passed,
failed, not run or environment-blocked. A required environment-blocked check leaves the primary task
blocked (validation environment), with an unblock condition, until required validation passes.
Run narrow checks, then applicable integrated gates; repeat
only when changes or unresolved concerns invalidate prior evidence.

Use an independent reviewer for substantial/risky changes, with contract, actual diff/base including
new files and validation evidence. Small low-risk changes may use primary self-review. Resolve only
evidence-backed findings. Reviewer output and worker DONE do not themselves establish integration
acceptance; verify evidence against the actual accepted state.

On failure, hold affected consumers, preserve the diff and diagnose code, missing context,
environment or scope. Repair within authority; retry only with a changed input/approach or evidence
that a transient condition cleared. Reuse the worker for focused repair. Default to one focused
repair and targeted recheck per failure cause; a further attempt needs new evidence and a recorded
reason. If unresolved, mark the task blocked with cause, attempted remedy and unblock condition,
then continue independent work. Never loop solely to obtain a pass or weaken checks. Skill task
statuses do not override separate platform goal-status rules.

In working-tree-only mode, a failed uncommitted task remains owned. Repair it before reusing that
worktree for unrelated edits. Continue independent read-only work meanwhile; use another editing
worktree only with the explicit transfer method above. Never discard or commit without authority.

## Finish or resume

Before finishing, reconcile every selected item, the integrated diff, dirty files and outstanding
implementation/review/checks. Do not declare completion with required work outstanding; distinguish
completed scope from exhausted ready work with blockers. Mark shipped only under the repo's shipping
definition. Report concise outcomes, verification limits, worktrees/commits and first unfinished action.
Report token usage only when measured.

Stop task-created services when no longer needed. Preserve unfinished worktrees and identify cleanup
ownership. Remove only known safe, clean, unnecessary worktrees whose work is preserved; never force
delete branches or recursively traverse junctions.

On resume, read the checkpoint once and verify mutable branch/worktree/agent/input/check state.
Recover or stop still-active ownership before redispatch; do not duplicate running work. Reuse valid
evidence, inspect only changed claims, then perform the first unfinished ready action. If it is
blocked, record why and continue another eligible task. Do not restart completed work or ask again
for authority already granted. Optional session-orchestration conventions are not a prerequisite.
