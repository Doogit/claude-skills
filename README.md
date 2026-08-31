# claude-skills

Shareable [Claude Code](https://claude.com/claude-code) skills, workflows, and agents I use in
my own builds. Each lives in the directory Claude Code loads it from, so installing is copying
folders into `~/.claude/`.

Right now this holds the two **Dynamic Workflows** skills — the write-up is at
[doogit.com](https://doogit.com/posts/claude-conducts-codex-builds/).

## What's here

| Piece | What it does |
|---|---|
| `skills/dynamic-workflows-plan/` | Turns a plan into one structured for a Dynamic Workflows orchestrator: file-disjoint units, per-unit dispatch headers, named gates, self-contained work orders. Extends `ce-plan`. No Codex dependency. |
| `skills/dynamic-workflows-codex/` | Runs that plan as a fan-out where **Opus** decomposes, lightweight **Codex** workers implement each task in their own git worktree via `codex exec`, and **Sonnet** verifies and reports. Always pilots two tasks first; never auto-merges. |
| `workflows/dynamic-workflows-codex.js` | The workflow script `dynamic-workflows-codex` runs. |
| `agents/codex-worker.md` | The `codex-worker` shim agent — the non-reasoning plumbing that calls `codex exec` and returns its structured output verbatim. |

## Install

**Script:** from the repo root,

    ./install.sh      # macOS / Linux / Git Bash
    .\install.ps1     # Windows PowerShell

It copies each piece into `~/.claude/` (skills, workflows, agents). It won't overwrite an
existing file unless you pass `--force`.

**Manual:**

    skills/dynamic-workflows-plan/        ->  ~/.claude/skills/dynamic-workflows-plan/
    skills/dynamic-workflows-codex/       ->  ~/.claude/skills/dynamic-workflows-codex/
    workflows/dynamic-workflows-codex.js  ->  ~/.claude/workflows/dynamic-workflows-codex.js
    agents/codex-worker.md                ->  ~/.claude/agents/codex-worker.md

Restart Claude Code (or reload skills) and both appear as `/dynamic-workflows-plan` and
`/dynamic-workflows-codex`.

## Prerequisites for the Codex variant

`dynamic-workflows-plan` needs nothing beyond Claude Code — it only produces a plan. The Codex
executor needs two things:

1. **The Codex CLI, logged in.** Install it and run `codex login`. The workflow shells out to
   `codex exec`, so add `Bash(codex exec:*)` to `permissions.allow` in `~/.claude/settings.json`
   (a bare `Bash` entry also works).
2. **A model alias to match.** The worker defaults to `gpt-5.6-luna` at `xhigh` reasoning effort.
   Those are aliases in my own `~/.codex/config.toml`, **not** universal Codex model names. Map
   the worker to whatever Codex model you have — edit the model / `WORKER_EFFORT` in
   `workflows/dynamic-workflows-codex.js` and `agents/codex-worker.md`, or define matching aliases
   in your `~/.codex/config.toml`.

## Two things to know before you trust a run

- **It never merges.** Each passing task lands committed on its own `dwc/<id>` branch in its own
  worktree. You integrate through your normal gate/PR flow, in the order the report suggests.
- **A diff-only `pass` is not green CI.** When a worktree has no installed dependencies, the
  reviewer judges from the diff and can't run types/tests. Gate every "passed" branch with your
  real typecheck and tests before merging — `npx --no-install tsc --noEmit` usually resolves deps
  from the repo root without installing anything.

Verified on codex-cli 0.150.1 and Claude Code 2.1.246. See each skill's `SKILL.md` / `reference.md`
for the full procedure and the known failure modes (including the leak-to-root and false-green
cases worth watching for).

## License

MIT — see [LICENSE](LICENSE).
