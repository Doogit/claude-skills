# Workflow skills for Claude Code and Codex

The skills I use to plan and run work across coding agents. Refreshed from my installed
files on September 8, 2026, with the public adaptations listed below.

The write-up is at [doogit.com](https://doogit.com/posts/claude-conducts-codex-builds/).

## Choose a workflow

| Package | What it does |
|---|---|
| Claude: `skills/dynamic-workflows-plan/` | Adds dispatch contracts and dependency gates to a plan produced with the separately installed `ce-plan` skill. |
| Claude: `skills/dynamic-workflows-codex/`, `workflows/`, `agents/` | Opus decomposes; a Haiku shim calls `codex exec`; Sonnet reviews. Terra/medium implements, high effort handles repairs. A two-task pilot precedes full execution. Passing tasks are committed on separate branches; nothing is pushed or merged. |
| Native Codex: `codex/skills/dynamic-workflows-codex/` | Executes durable plans through native Codex workers. Uses available agent routing and tools, with optional bounded pilots and worktree-only delivery by default. |
| Native Codex: `codex/skills/session-orchestration/` | Coordinates a session's planning, worker scope, review, and delivery. |

The two `dynamic-workflows-codex` skills belong to different applications. Install them
into their respective homes; do not copy the native skill over the Claude skill.

## Install

From a clone or extracted ZIP, choose a target. The default remains Claude for existing users.

```bash
bash install.sh --target claude
bash install.sh --target codex
bash install.sh --target all --force
```

```powershell
.\install.ps1 -Target claude
.\install.ps1 -Target codex
.\install.ps1 -Target all -Force
```

Existing pieces are skipped unless `--force` / `-Force` is supplied. Force overlays the
packaged files without nesting skill folders or deleting extra local files. Back up local
customizations before an update. `CLAUDE_HOME` and `CODEX_HOME` override the default
`~/.claude` and `~/.codex` destinations. No settings, credentials, model aliases, or
permission allowlists are changed. Restart the selected application after installation.

For a manual install, copy `skills/`, `workflows/`, and `agents/` into your Claude home;
copy the contents of `codex/skills/` into your Codex home's `skills/` directory.

## Prerequisites and limits

- The Claude bridge requires a Claude Code runtime supporting its Workflow API and a
  logged-in Codex CLI. Run the skill's preflight before execution. Model availability
  varies: set `WORKER_MODEL`, `WORKER_EFFORT`, and `REPAIR_EFFORT` in the workflow to values
  supported by your runtime. The included defaults describe my setup.
- The planning skill extends `ce-plan`, which is not bundled. It also mentions `ce-work`
  as a single-session alternative. Install those separately if using those paths.
- Native execution requires Codex native collaboration tools. Follow your current agent
  tool schema and routing rules. Referenced supporting skills, including
  `worktree-coordination` and `git-ship` for their respective operations, are not bundled;
  make them available before invoking those paths. Other optional review/planning skills
  named in the procedures are also separate dependencies.
- The bridge uses unattended `approval_policy="never"` with `workspace-write`. This
  cannot grant permissions. Authorize the intended work before launching; denied actions
  stop for resolution. The native workflow follows its own authorization contract.
- A diff review is not a passing build. Run actual project checks in each task worktree.
  With multiple dependencies, the bridge provides ordering but does not combine their
  branches automatically. Integration and merge remain explicit steps.

## Public adaptations

The native files are copied without content changes, with LF line endings. The Claude export retains the installed model
configuration, dependency handling, and review flow, with these changes for sharing:

- New worktrees use `git worktree add -b`; existing paths require ownership verification.
  There is no branch reset or silent branch-name fallback.
- Execution failures stop before review/repair; authorization denials are not automatically retried.
  A clean target root is required before execution. Root-leak guidance preserves
  changes and requires authorization before restoring or deleting root files.
- Machine-specific hook/config claims and a private component name were removed from
  the reference. Historical CLI evidence is labeled as historical; planning examples
  are labeled as templates, and the missing `ce-plan` prerequisite is explicit.

These are instruction and packaging checks, not a new paid end-to-end agent benchmark.
The [export manifest](EXPORT-MANIFEST.json) records hashes of both the installed inputs
and the shipped files so the adaptations can be audited.

## Download bundles

`python scripts/build_bundles.py --output <directory>` creates two reproducible archives:

- `dynamic-workflows-skills.zip`: the Claude package.
- `dynamic-workflows-codex-skills.zip`: the native Codex package.

Both include this README, license, manifest, and installers. Select the archive's target
when installing; use a repository clone for `--target all`.

## License

MIT. See [LICENSE](LICENSE).
