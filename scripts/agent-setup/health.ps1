[CmdletBinding()]
param(
  [string]$AgentHome = (Join-Path $env:USERPROFILE ".smartbio-agent")
)

# Read-only checks. Never prints the token. Exits non-zero with actionable
# messages when Python, imports, Worker, token or observed polling is missing.
$ErrorActionPreference = "Continue"
$failures = @()
function Fail([string]$message) { $script:failures += $message; Write-Host "FAIL: $message" }
function Ok([string]$message) { Write-Host "OK: $message" }

$configPath = Join-Path $AgentHome "config.json"
if (-not (Test-Path -LiteralPath $configPath)) {
  Fail "No config at $configPath. Run install.ps1 first."
  exit 1
}
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$venvPython = [string]$config.venv_python
$workerUrl = ([string]$config.worker_url).TrimEnd("/")
$pythonPath = [string]$config.python_path
$tokenPath = [string]$config.token_path

if (-not (Test-Path -LiteralPath $venvPython)) { Fail "venv python missing: $venvPython. Run install.ps1." }
else {
  & $venvPython -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'
  if ($LASTEXITCODE -ne 0) { Fail "Python 3.10+ required in $venvPython." } else { Ok "Python version OK." }

  if ($env:PYTHONPATH) { $env:PYTHONPATH = "$pythonPath$([IO.Path]::PathSeparator)$env:PYTHONPATH" }
  else { $env:PYTHONPATH = $pythonPath }
  & $venvPython -c 'import smartbio.aiagent.agent, smartbio.fasta, smartbio.statistics, jsonschema'
  if ($LASTEXITCODE -ne 0) { Fail "Agent imports failed. Run update.ps1 (or install.ps1)." } else { Ok "Agent imports OK." }
}

if (-not (Test-Path -LiteralPath $tokenPath)) { Fail "Token file missing: $tokenPath. Run install.ps1." }
elseif (-not (Get-Content -LiteralPath $tokenPath -Raw).Trim()) { Fail "Token file is empty: $tokenPath" }
else {
  $acl = Get-Acl -LiteralPath $tokenPath
  $public = $acl.Access | Where-Object { $_.IdentityReference -match 'Everyone|BUILTIN\\Users|Authenticated Users' }
  if ($public) { Fail "Token file is readable by other accounts: $tokenPath. Re-run install.ps1." }
  else { Ok "Token present with owner-only ACL (value not shown)." }
}

$pidPath = Join-Path $AgentHome "agent.pid"
if (-not (Test-Path -LiteralPath $pidPath)) { Fail "No PID file at $pidPath. Start the agent with start.ps1." }
else {
  $agentPid = 0
  if (-not [int]::TryParse((Get-Content -LiteralPath $pidPath -Raw).Trim(), [ref]$agentPid)) { Fail "PID file is not a number: $pidPath" }
  elseif (-not (Get-Process -Id $agentPid -ErrorAction SilentlyContinue)) { Fail "Agent process $agentPid is not running. Start it with start.ps1." }
  else { Ok "Agent process $agentPid is running." }
}

try {
  $response = Invoke-RestMethod -Uri "$workerUrl/api/ai/backend" -TimeoutSec 5
  Ok "Worker reachable at $workerUrl (execution mode: $($response.execution_mode))."
  if (-not $response.last_agent_activity_at) {
    Fail "Worker has not observed an agent job claim. Start the agent, approve a plan, then retry. Idle agents leave no trace in D1."
  } elseif ($response.agent_status -ne "connected") {
    Fail "Last observed agent activity ($($response.last_agent_activity_at)) is older than the $($response.freshness_window_seconds)s freshness window. Check the agent log."
  } else {
    Ok "Last observed agent activity: $($response.last_agent_activity_at)."
  }
} catch {
  Fail "Worker unreachable at $workerUrl. Check the worker URL in config.json and start the worker."
}

if ($failures.Count -gt 0) { Write-Host "$($failures.Count) check(s) failed."; exit 1 }
Write-Host "All agent health checks passed."
exit 0
