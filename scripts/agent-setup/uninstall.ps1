[CmdletBinding()]
param(
  [string]$AgentHome = (Join-Path $env:USERPROFILE ".smartbio-agent")
)

# Removes only the local runtime directory created by install.ps1.
# User data (FASTA files, Worker/D1 results, repository files) is preserved.
$ErrorActionPreference = "Stop"
$pidPath = Join-Path $AgentHome "agent.pid"
if (Test-Path -LiteralPath $pidPath) {
  $agentPid = 0
  if ([int]::TryParse((Get-Content -LiteralPath $pidPath -Raw).Trim(), [ref]$agentPid)) {
    $process = Get-Process -Id $agentPid -ErrorAction SilentlyContinue
    if ($process) {
      Stop-Process -Id $agentPid -Force
      Write-Host "Stopped agent process $agentPid."
    }
  }
  Remove-Item -LiteralPath $pidPath -Force
}

foreach ($name in @("config.json", "agent.token", "agent.log", "agent.err.log")) {
  $path = Join-Path $AgentHome $name
  if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
}
$venvDir = Join-Path $AgentHome "venv"
if (Test-Path -LiteralPath $venvDir) { Remove-Item -LiteralPath $venvDir -Recurse -Force }
Write-Host "Removed local agent runtime at $AgentHome (config, token, PID, logs, venv)."
Write-Host "User data and Worker-side results were not touched."
if (Test-Path -LiteralPath $AgentHome) {
  Write-Host "$AgentHome still contains other files; it was left in place."
} else {
  Remove-Item -LiteralPath $AgentHome -Force
}
