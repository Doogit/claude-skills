#!/usr/bin/env bash
# Usage: ./install.sh [--target claude|codex|all] [--force]
set -euo pipefail
FORCE=0
TARGET=claude
while [ "$#" -gt 0 ]; do
  case "$1" in
    --force) FORCE=1; shift ;;
    --target) [ "$#" -ge 2 ] || { echo "--target needs a value" >&2; exit 2; }; TARGET="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
case "$TARGET" in claude|codex|all) ;; *) echo "Invalid target: $TARGET" >&2; exit 2 ;; esac
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
required=()
if [ "$TARGET" = claude ] || [ "$TARGET" = all ]; then
  required+=(skills/dynamic-workflows-plan skills/dynamic-workflows-codex workflows/dynamic-workflows-codex.js agents/codex-worker.md)
fi
if [ "$TARGET" = codex ] || [ "$TARGET" = all ]; then
  required+=(codex/skills/dynamic-workflows-codex codex/skills/session-orchestration)
fi
for rel in "${required[@]}"; do
  [ -e "$SRC/$rel" ] || { echo "Package missing $rel. Choose the matching target or use the full repository." >&2; exit 2; }
done
copy_piece() {
  local from="$1" to="$2"
  if { [ -e "$to" ] || [ -L "$to" ]; } && [ "$FORCE" -ne 1 ]; then
    echo "Skip existing: $to (--force to update)"
    return
  fi
  if [ -d "$from" ]; then
    mkdir -p "$to"
    cp -R "$from/." "$to/"
  else
    mkdir -p "$(dirname "$to")"
    cp "$from" "$to"
  fi
  echo "Installed: $to"
}
if [ "$TARGET" = claude ] || [ "$TARGET" = all ]; then
  CLAUDE_DEST="${CLAUDE_HOME:-$HOME/.claude}"
  for rel in skills/dynamic-workflows-plan skills/dynamic-workflows-codex workflows/dynamic-workflows-codex.js agents/codex-worker.md; do
    copy_piece "$SRC/$rel" "$CLAUDE_DEST/$rel"
  done
fi
if [ "$TARGET" = codex ] || [ "$TARGET" = all ]; then
  # Codex discovers user-installed skills from ~/.agents/skills. Keep ~/.codex
  # configuration untouched; it is not a skill-discovery location.
  AGENTS_DEST="${AGENTS_HOME:-$HOME/.agents}"
  for rel in skills/dynamic-workflows-codex skills/session-orchestration; do
    copy_piece "$SRC/codex/$rel" "$AGENTS_DEST/$rel"
  done
fi
echo "Done. Restart the selected agent application to refresh skill discovery."
