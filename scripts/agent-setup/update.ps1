[CmdletBinding()]
param(
  [string]$AgentHome = (Join-Path $env:USERPROFILE ".smartbio-agent")
)

# Fast-forward only. Never rebases, resets, or rewrites history.
$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$configPath = Join-Path $AgentHome "config.json"
if (-not (Test-Path -LiteralPath $configPath)) { throw "No config at $configPath. Run install.ps1 first." }
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$venvPython = [string]$config.venv_python
if (-not (Test-Path -LiteralPath $venvPython)) { throw "venv python not found: $venvPython. Run install.ps1." }

Write-Host "Fast-forwarding $repoRoot ..."
git -C $repoRoot pull --ff-only
if ($LASTEXITCODE -ne 0) {
  throw "git pull --ff-only failed. Resolve local changes manually; this script never rewrites history."
}

& $venvPython -m pip install --disable-pip-version-check -r (Join-Path $repoRoot "python-engine\requirements.txt")
if ($LASTEXITCODE -ne 0) { throw "Requirements reinstall failed." }
Write-Host "Update complete. Restart the agent (start.ps1) and re-run health.ps1."
