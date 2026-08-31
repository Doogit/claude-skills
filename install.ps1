# Install these Claude Code skills/workflows/agents into ~/.claude/.
# Usage: .\install.ps1 [-Force]   (-Force overwrites existing files)
param([switch]$Force)

$ErrorActionPreference = "Stop"
$src  = $PSScriptRoot
$dest = if ($env:CLAUDE_HOME) { $env:CLAUDE_HOME } else { Join-Path $HOME ".claude" }

function Install-Item($rel) {
  $from = Join-Path $src  $rel
  $to   = Join-Path $dest $rel
  New-Item -ItemType Directory -Force -Path (Split-Path $to) | Out-Null
  if ((Test-Path $to) -and -not $Force) {
    Write-Host "  skip (exists): $rel   [-Force to overwrite]"
  } else {
    Copy-Item $from $to -Recurse -Force
    Write-Host "  installed: $rel"
  }
}

Write-Host "Installing into $dest"
Install-Item "skills/dynamic-workflows-plan"
Install-Item "skills/dynamic-workflows-codex"
Install-Item "workflows/dynamic-workflows-codex.js"
Install-Item "agents/codex-worker.md"

Write-Host ""
Write-Host "Done. Restart Claude Code (or reload skills)."
Write-Host "For the Codex variant: run 'codex login' and add Bash(codex exec:*) to permissions.allow in ~/.claude/settings.json."
