[CmdletBinding()]
param(
  [string]$AgentHome = (Join-Path $env:USERPROFILE ".smartbio-agent"),
  [string]$WorkerUrl = "http://127.0.0.1:8787",
  [string]$Python = "python"
)

# Local, user-scoped install. No global installs, no secrets printed or stored
# in the config file. Re-running keeps an existing token (the Worker secret
# must stay in sync with the token file).
$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$requirements = Join-Path $repoRoot "python-engine\requirements.txt"
$srcPath = Join-Path $repoRoot "python-engine\src"

if (-not (Test-Path -LiteralPath $requirements)) {
  throw "Requirements file not found: $requirements"
}
if (-not (Test-Path -LiteralPath $AgentHome)) {
  New-Item -ItemType Directory -Force -Path $AgentHome | Out-Null
}

$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls $AgentHome /inheritance:r /grant:r "${sid}:(OI)(CI)(F)" | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Warning "Could not restrict $AgentHome with icacls; restrict it manually before storing a token."
}

& $Python -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'
if ($LASTEXITCODE -ne 0) {
  throw "Python 3.10 or newer is required. Found: $(& $Python --version 2>&1)"
}

$venvDir = Join-Path $AgentHome "venv"
if (-not (Test-Path -LiteralPath (Join-Path $venvDir "Scripts\python.exe"))) {
  & $Python -m venv $venvDir
  if ($LASTEXITCODE -ne 0) { throw "Could not create the virtual environment at $venvDir" }
}
$venvPython = Join-Path $venvDir "Scripts\python.exe"
& $venvPython -m pip install --disable-pip-version-check -r $requirements
if ($LASTEXITCODE -ne 0) { throw "Could not install requirements from $requirements" }

$tokenPath = Join-Path $AgentHome "agent.token"
if (-not (Test-Path -LiteralPath $tokenPath) -or -not (Get-Content -LiteralPath $tokenPath -Raw).Trim()) {
  $token = (& $venvPython -c 'import secrets; print(secrets.token_urlsafe(32))').Trim()
  if (-not $token) { throw "Token generation failed." }
  [System.IO.File]::WriteAllText($tokenPath, $token, [System.Text.UTF8Encoding]::new($false))
  Write-Host "Generated a new agent token (not displayed)."
} else {
  Write-Host "Keeping the existing agent token (not displayed)."
}
& icacls $tokenPath /inheritance:r /grant:r "${sid}:(R,W)" | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Warning "Could not restrict $tokenPath with icacls; restrict it manually."
}

$config = [ordered]@{
  worker_url = $WorkerUrl
  token_path = $tokenPath
  venv_python = $venvPython
  python_path = $srcPath
  created_at = (Get-Date).ToUniversalTime().ToString("o")
}
$configPath = Join-Path $AgentHome "config.json"
[System.IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 4), [System.Text.UTF8Encoding]::new($false))

Write-Host ""
Write-Host "Local agent installed in $AgentHome"
Write-Host "Config: $configPath (contains no secret; only the token file path)"
Write-Host "Token:  $tokenPath (owner-only; never printed)"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. From web-platform, set the Worker secret to the same token value:"
Write-Host '     get-content <token path> | wrangler secret put AI_AGENT_TOKEN'
Write-Host "  2. Start the worker at $WorkerUrl (for example: wrangler dev --local)."
Write-Host "  3. Start the agent:  powershell -ExecutionPolicy Bypass -File scripts\agent-setup\start.ps1"
Write-Host "  4. Check health:     powershell -ExecutionPolicy Bypass -File scripts\agent-setup\health.ps1"
