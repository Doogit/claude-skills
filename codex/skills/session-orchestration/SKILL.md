---
name: session-orchestration
description: Coordinate a substantial Codex session with durable planning, bounded agent dispatch, dependency-aware waves, safe editing isolation, verification gates, and delivery readiness. Use when work has at least two independent bounded lanes, requires independent review, or would materially pollute the primary context. Do not use merely because a task has multiple steps.
---

# Session Orchestration

Use this skill when the work benefits from distinct ownership, independent review, or offloading noisy investigation and verification. Keep single-lane work in the primary agent when delegation would cost more than it saves.

## Orchestrator Contract

The primary agent owns the objective, architecture, repository-wide decisions, task graph, integration, risk calls, and final judgment. Delegate bounded reconnaissance, independent implementation, verification, and review when scopes can be isolated.

At the start, establish:

- Objective and durable implementation-plan path.
- Intended base branch and current repository state.
- Delivery mode: working tree only, commit, or PR.
- Acceptance criteria and material constraints.
- Available agent capacity and whether concurrent editing is safe.

Do not infer permission to commit, push, or open a PR from the use of this skill. Use the requested delivery mode and load `git-ship` only when shipping is authorized.

Treat the modes distinctly: working-tree-only permits edits but no commits; commit permits local commits but no push; PR permits the commits and push required for the requested PR. Do not use commit-based worker integration in working-tree-only mode.

## Durable State Contract

For substantial multi-step work, create or adopt one repository-backed plan before the first editing wave. Follow the repository's plan convention; otherwise use `docs/plans/<YYYY-MM-DD>-<task-slug>.md`, or `.plans/` when the repository has no `docs/` directory.

The durable plan is the source of truth for the objective, task graph, dependencies, decisions, status, validation evidence, and first unfinished action. Use the native plan mechanism as a concise live mirror, not as the only record.

Update the durable plan:

- after every integration barrier;
- whenever a decision, prerequisite, scope boundary, or task status changes;
- before expected compaction, handoff, or session termination;
- after final verification and delivery readback.

Record mutable evidence with its branch, SHA, command or source, and verification time when freshness matters. Link logs and diffs instead of pasting large outputs. Keep exactly one clearly identified next action.

## Reconcile Before Editing

Inspect the applicable instructions, branch, status, base relation, worktrees, relevant history, and existing implementation. Read the plan fully when one exists. Classify significant requirements as implemented, partial, missing, different, obsolete, or blocked.

Correct stale plan assumptions from repository evidence. For substantial or high-risk plans, load `adversarial-plan-review` before committing to the execution graph. Ask the user only when the unresolved choice would materially change requested behavior, external contracts, security posture, or scope.

## Build The Execution Graph

Keep the execution graph in the durable plan and mirror only the current wave in the native plan. Do not duplicate raw worker transcripts or large logs in either place.

For each task record:

- ID and objective.
- Owned files or modules.
- Prerequisites and interfaces it consumes or produces.
- Acceptance criteria and required verification.
- Read-only or editing status.
- Parallel-safety and assigned worker.

Group ready tasks into small waves with explicit barriers. Do not parallelize unresolved interfaces, migrations, schema changes, shared resources, or overlapping files merely because slots are available.

## Native Agent Dispatch

Prefer native agent tools such as `spawn_agent`, `followup_task`, `send_message`, and `wait_agent`. Use CLI-launched workers only when native dispatch is unavailable. Reserve the primary agent for orchestration and dispatch no more ready tasks than the available worker capacity.

Use the enforced routing matrix: the default subagent is Terra at medium reasoning; `worker` handles ordinary implementation; `explorer` handles substantive read-only investigation; `luna` handles bounded reconnaissance, mechanical edits, documentation sweeps, and simple tests; and `sol` is reserved for primary orchestration, architecture, difficult debugging, security-sensitive work, adversarial review, and cross-cutting judgment. Every spawn must set `fork_turns` explicitly. Default to `fork_turns: "none"` or a bounded value from `"1"` through `"3"`; never use `fork_turns: "all"` for `worker`, `explorer`, `terra`, or `luna`. A full-history fork is allowed only for an explicitly selected `sol` agent when the complete conversation is materially necessary. Include necessary task context in the assignment instead of relying on inherited history. Escalate after ambiguity or a substantive failed attempt; do not repeatedly retry the same task with an underpowered worker.

Read-only workers may share the main checkout. Before more than one editing agent is active, load `worktree-coordination`. Give every editing worker an explicit worktree, branch, and non-overlapping ownership boundary. Treat dependency trees, build caches, databases, ports, and generated outputs as shared mutable resources unless proven isolated.

When the main checkout has unrelated dirty changes, perform implementation and final integration in a clean repo-local worktree. In commit or PR mode, editing workers may commit their own branches when their assignment explicitly allows it, then integrate through the repository's safe merge or cherry-pick workflow. In working-tree-only mode, prefer sequential editing in one isolated integration worktree; use concurrent editing worktrees only when a non-committing patch-transfer method and cleanup path are explicitly defined.

Every worker assignment must include:

```text
Task: <ID and objective>
Worktree/branch: <explicit path and branch, or read-only>
Ownership: <exact files/modules, including related tests>
Prerequisites: <stabilized inputs and assumptions>
Preserve: <interfaces, behavior, and hard repository rules>
Acceptance: <observable completion criteria>
Verification: <commands or inspections to run>
Constraints: You are not alone in the codebase. Do not revert others' work,
expand scope, or edit outside ownership. Report cross-cutting needs instead.
Return: STATUS / Changed / Files / Verification / Open
```

Give workers only the context needed for the assignment plus rules they could violate. Require this concise return shape:

```text
STATUS: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
Changed: <short summary>
Files: <paths or none>
Verification: <commands run and outcomes>
Open: <questions, blockers, risks>
```

## Wave Control And Integration

After dispatch, continue primary-agent work that does not duplicate the workers. Wait at meaningful barriers rather than busy-polling. Reuse an existing worker for closely related follow-up instead of spawning duplicates.

At each barrier:

1. Read worker results and inspect the actual repository state and diffs.
2. Compare each result with ownership and acceptance criteria.
3. Reject scope expansion, reconcile assumptions, and resolve integration issues.
4. Run the narrow checks needed to validate the integrated wave.
5. Update the durable plan with results, decisions, evidence, and the next action.
6. Release dependent tasks only after their prerequisites are stable.

Give an incomplete worker one focused follow-up when the missing result is recoverable. If the same task remains incomplete, evidence contradicts its assumptions, or a prerequisite changes, stop retrying variants and revise the execution graph or escalate the route. Do not release or continue dependent work after its prerequisite becomes invalid.

A worker summary is not proof. The primary agent owns integration and must preserve unrelated user changes.

## Review And Verification

Scale independent review to risk:

- Small, isolated work: primary self-review and focused verification may be sufficient.
- Substantial or risky work: use at least one independent reviewer that did not implement the relevant code.
- High-risk or broad work: separate adversarial code review from test and requirement-coverage review when that improves confidence.

The primary agent evaluates findings. Resolve substantiated blocker and high-severity findings before completion; re-review material remediation without creating an endless reviewer loop.

Before declaring completion, inspect the full relevant diff and repository status, reconcile each acceptance criterion with concrete evidence, and run proportional lint, typecheck, tests, build, smoke, or repository-specific checks. Never claim a check passed unless it ran successfully. Report skipped or unavailable checks and the risk they leave.

## Completion And Delivery

Before reporting completion or creating a handoff, reconcile the durable plan against the actual repository and external state. Mark obsolete or superseded tasks explicitly, record the final branch and SHA, identify temporary resources and cleanup obligations, and leave exactly one next action when work remains.

Report:

- What changed and which requirements are complete, deferred, or not applicable.
- Exact verification and its limits.
- Review findings and material remediations.
- Remaining risks, dirty state, branch/base relation, and worktree cleanup needs.
- Delivery state appropriate to the selected mode.

For PR delivery, use `git-ship` after implementation and validation are complete. Read back the remote PR state and distinguish local verification from current-commit CI, mergeability, and draft status.
