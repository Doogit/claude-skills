#!/usr/bin/env bash
# Install these Claude Code skills/workflows/agents into ~/.claude/.
# Usage: ./install.sh [--force]   (--force overwrites existing files)
set -euo pipefail

FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${CLAUDE_HOME:-$HOME/.claude}"

copy() {
  # copy <relative path under repo, also the path under ~/.claude>
  local rel="$1"
  local from="$SRC/$rel"
  local to="$DEST/$rel"
  mkdir -p "$(dirname "$to")"
  if [ -e "$to" ] && [ "$FORCE" -ne 1 ]; then
    echo "  skip (exists): $rel   [--force to overwrite]"
  else
    cp -R "$from" "$to"
    echo "  installed: $rel"
  fi
}

echo "Installing into $DEST"
copy "skills/dynamic-workflows-plan"
copy "skills/dynamic-workflows-codex"
copy "workflows/dynamic-workflows-codex.js"
copy "agents/codex-worker.md"

echo
echo "Done. Restart Claude Code (or reload skills)."
echo "For the Codex variant: run 'codex login' and add Bash(codex exec:*) to permissions.allow in ~/.claude/settings.json."
