[CmdletBinding()]
param(
  [string]$AgentHome = (Join-Path $env:USERPROFILE ".smartbio-agent"),
  [switch]$Background
)

# Foreground by default (Ctrl+C stops the agent). -Background detaches and
# writes a PID file. The token is passed only as a process argument; it is
# never printed or written to a log by these scripts.
$ErrorActionPreference = "Stop"
$configPath = Join-Path $AgentHome "config.json"
if (-not (Test-Path -LiteralPath $configPath)) { throw "No config at $configPath. Run install.ps1 first." }

$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$tokenPath = [string]$config.token_path
$venvPython = [string]$config.venv_python
$workerUrl = [string]$config.worker_url
$pythonPath = [string]$config.python_path
$token = (Get-Content -LiteralPath $tokenPath -Raw).Trim()

if (-not $token) { throw "Token file is empty: $tokenPath" }
if (-not (Test-Path -LiteralPath $venvPython)) { throw "Virtual environment python not found: $venvPython" }
if (-not (Test-Path -LiteralPath $pythonPath)) { throw "smartbio source path not found: $pythonPath" }

$pidPath = Join-Path $AgentHome "agent.pid"
if (Test-Path -LiteralPath $pidPath) {
  $previous = 0
  if ([int]::TryParse((Get-Content -LiteralPath $pidPath -Raw).Trim(), [ref]$previous)) {
    if (Get-Process -Id $previous -ErrorAction SilentlyContinue) {
      throw "Agent already running with PID $previous. Stop it with uninstall.ps1 or remove $pidPath if stale."
    }
  }
  Remove-Item -LiteralPath $pidPath -Force
}

if ($env:PYTHONPATH) { $env:PYTHONPATH = "$pythonPath$([IO.Path]::PathSeparator)$env:PYTHONPATH" }
else { $env:PYTHONPATH = $pythonPath }

$agentArgs = @("-m", "smartbio.aiagent.agent", "--loop", "--url", $workerUrl, "--token", $token)

if ($Background) {
  $logPath = Join-Path $AgentHome "agent.log"
  $errPath = Join-Path $AgentHome "agent.err.log"
  $process = Start-Process -FilePath $venvPython -ArgumentList $agentArgs -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $logPath -RedirectStandardError $errPath
  [System.IO.File]::WriteAllText($pidPath, [string]$process.Id)
  Write-Host "Started local agent with PID $($process.Id). Logs: $logPath / $errPath"
  Write-Host "Stop with: powershell -ExecutionPolicy Bypass -File scripts\agent-setup\uninstall.ps1"
  exit 0
}

[System.IO.File]::WriteAllText($pidPath, [string]$PID)
try {
  & $venvPython @agentArgs
  exit $LASTEXITCODE
} finally {
  if (Test-Path -LiteralPath $pidPath) { Remove-Item -LiteralPath $pidPath -Force }
}
