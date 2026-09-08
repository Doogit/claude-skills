# Usage: .\install.ps1 [-Target claude|codex|all] [-Force]
param([ValidateSet("claude", "codex", "all")][string]$Target = "claude", [switch]$Force)
$ErrorActionPreference = "Stop"
function Install-Piece([string]$Source, [string]$Destination) {
  if ((Test-Path -LiteralPath $Destination) -and -not $Force) {
    Write-Host "Skip existing: $Destination (-Force to update)"
    return
  }
  if (Test-Path -LiteralPath $Source -PathType Container) {
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    foreach ($item in Get-ChildItem -LiteralPath $Source -Force) {
      Install-Piece $item.FullName (Join-Path $Destination $item.Name)
    }
  } else {
    New-Item -ItemType Directory -Force -Path (Split-Path $Destination) | Out-Null
    Copy-Item -LiteralPath $Source -Destination $Destination -Force
    Write-Host "Installed: $Destination"
  }
}
$required = @()
if ($Target -in @("claude", "all")) { $required += @("skills/dynamic-workflows-plan", "skills/dynamic-workflows-codex", "workflows/dynamic-workflows-codex.js", "agents/codex-worker.md") }
if ($Target -in @("codex", "all")) { $required += @("codex/skills/dynamic-workflows-codex", "codex/skills/session-orchestration") }
foreach ($rel in $required) {
  if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $rel))) { throw "Package missing $rel. Choose the matching target or use the full repository." }
}
if ($Target -in @("claude", "all")) {
  $claudeDest = if ($env:CLAUDE_HOME) { $env:CLAUDE_HOME } else { Join-Path $HOME ".claude" }
  foreach ($rel in @("skills/dynamic-workflows-plan", "skills/dynamic-workflows-codex", "workflows/dynamic-workflows-codex.js", "agents/codex-worker.md")) {
    Install-Piece (Join-Path $PSScriptRoot $rel) (Join-Path $claudeDest $rel)
  }
}
if ($Target -in @("codex", "all")) {
  $codexDest = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME ".codex" }
  foreach ($rel in @("skills/dynamic-workflows-codex", "skills/session-orchestration")) {
    Install-Piece (Join-Path $PSScriptRoot "codex/$rel") (Join-Path $codexDest $rel)
  }
}
Write-Host "Done. Restart the selected agent application to refresh skill discovery."
