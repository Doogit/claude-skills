# Dispatch and return contracts

Use compact fields in the existing plan or dispatch message; a separate manifest is optional.

```text
Task: ID, objective and user-visible outcome
Inputs: relevant plan/spec sections; dependencies actually present; base SHA or identified dirty state
Ownership: absolute worktree, branch, allowed files/modules/tests; shared-resource reservations
Exclusions: APIs, files, services or behaviors this task may not change
Route: supported role/model/effort and brief reason when non-obvious
Acceptance: observable outcome, failure behavior and compatibility requirements
Verification: appropriate commands, required environment and which checks gate consumers
Delivery: working-tree-only | local commits | PR; commits only if explicitly authorized
Constraints: You are not alone. Preserve others' edits. Use absolute paths; verify checkout/branch.
Report needed scope changes before exceeding ownership. Do not spawn children without assigned budget.
Return: status, changed files, tested revision/state, actual checks/results, concerns, commit if allowed,
and specific blocker/unblock condition. Summarize; point to large evidence instead of copying logs.
```

Worker status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT.
DONE means assigned implementation/checks passed, not that integration or shipping is complete.
DONE_WITH_CONCERNS means work exists but a check or concern remains; required unresolved gates hold
consumers. NEEDS_CONTEXT identifies a specific missing input. BLOCKED records cause, attempted remedy
and unblock condition. Check results: passed | failed | not run | environment-blocked.

The primary maintains this compact checkpoint in or linked from the existing registry:

```text
Selected scope and delivery authority:
Root/integration baseline; pre-existing dirty paths:
Task | dependencies/input state | ownership/worktree | worker ID | state | evidence
Shared-resource reservations and required integration gates:
Failures: cause, attempts, new evidence for retry, unblock condition, held consumers
First unfinished action:
```

Task states can be pending, ready, dispatched, reviewing, accepted or blocked; preserve equivalent
existing registry labels. Record dispatch intent before spawning, worker ID immediately afterward,
then blocking, changed ownership/inputs and acceptance. Only the primary accepts tasks after required
review, integration and checks. Identify uncommitted inputs with a recorded diff/file inventory or
fingerprint, including new files; do not copy secrets. Revalidate if that state changes.

Examples:

- A changes an API contract; B consumes it. B waits for A's accepted implementation to be present
  in B's input. Independent slow task D does not hold B unless a shared gate requires it.
- C depends on A and B. Integrate and check both before C starts; original HEAD is insufficient.
- A failed prerequisite holds its consumers, while unrelated ready work proceeds. In working-tree-only
  mode, preserve the failed diff and continue independent read-only work until editing is safe.
- Documentation changes use appropriate source/link/render checks plus required repo gates; do not
  manufacture behavior tests. Missing required runtime validation remains environment-blocked.
- On interrupted dispatch, inspect live agents and owned worktrees before spawning a replacement.

For independent review supply acceptance, actual stable diff/base including new files, and evidence.
Request severity, concrete trigger, source evidence and required correction without a desired verdict.
A focused repair gets a targeted recheck; further retries need new evidence, not repeated instructions.
