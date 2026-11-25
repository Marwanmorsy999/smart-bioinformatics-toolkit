<#
.SYNOPSIS
  Install REPLACEMENT provider credentials into one Cloudflare Worker environment.

.DESCRIPTION
  Interactive, fail-closed helper for the M7.1 credential rotation. Each value is
  read with Read-Host -AsSecureString and piped to `npx wrangler secret put` over
  stdin. Values are NEVER printed, echoed as part of a command, logged, or written
  to disk. Only secret NAMES appear on screen.

  Rotate the credential at the provider FIRST. The old Galaxy / smarts.bio keys
  were exposed in chat and must be considered compromised.

.PARAMETER Environment
  staging (default) or production. Production deliberately has NO --env flag.

.PARAMETER Provider
  galaxy, smartsbio, ninerouter, storage, or all (default).

.PARAMETER WhatIf
  Print ONLY the secret names that would be installed; prompt for nothing and
  contact nothing.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [ValidateSet("staging", "production")]
  [string]$Environment = "staging",

  [ValidateSet("galaxy", "smartsbio", "ninerouter", "storage", "all")]
  [string]$Provider = "all"
)

$ErrorActionPreference = "Stop"

# Ordered so output is deterministic. Names only - no values are stored here.
$SECRET_MAP = [ordered]@{
  galaxy     = @("GALAXY_BASE_URL", "GALAXY_API_KEY")
  smartsbio  = @(
    "SMARTSBIO_ENABLED", "SMARTSBIO_BASE_URL", "SMARTSBIO_API_KEY",
    "SMARTSBIO_WORKSPACE_ID", "SMARTSBIO_PUBLIC_AUTHORIZED"
  )
  ninerouter = @(
    "NINEROUTER_ENABLED", "NINEROUTER_BASE_URL", "NINEROUTER_API_KEY",
    "NINEROUTER_MODEL", "NINEROUTER_TIMEOUT"
  )
  storage    = @("ARTIFACT_SIGNING_KEY")
}

$selected = if ($Provider -eq "all") { @($SECRET_MAP.Keys) } else { @($Provider) }
$names = @()
foreach ($group in $selected) { $names += $SECRET_MAP[$group] }

# --dry-run / -WhatIf: names only, no prompts, no wrangler calls.
if ($WhatIfPreference) {
  foreach ($name in $names) { Write-Output $name }
  return
}

function ConvertTo-PlainText {
  param([System.Security.SecureString]$SecureValue)
  $pointer = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
  try {
    return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  }
  finally {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function Set-OneSecret {
  param([string]$Name)

  $secure = Read-Host -AsSecureString -Prompt "Hidden value for $Name"
  $plain = ConvertTo-PlainText -SecureValue $secure
  try {
    $wranglerArgs = @("wrangler", "secret", "put", $Name)
    # Production is the default (unqualified) environment. Never add --env.
    if ($Environment -eq "staging") { $wranglerArgs += @("--env", "staging") }

    # The value travels only through the child process stdin. The command line
    # contains the NAME only. Capture output and redact defensively.
    $captured = ($plain | & npx @wranglerArgs 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) {
      $safe = $captured.Replace($plain, "[REDACTED]")
      throw "wrangler secret put failed for ${Name}: $safe"
    }
    Write-Host "Installed secret name: $Name (environment: $Environment)"
  }
  finally {
    $plain = $null
    [System.GC]::Collect()
  }
}

# wrangler.toml lives in web-platform/, so run from there regardless of caller cwd.
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$webDir = Join-Path (Split-Path -Parent (Split-Path -Parent $scriptDir)) "web-platform"
if (-not (Test-Path (Join-Path $webDir "wrangler.toml"))) {
  throw "Expected wrangler.toml in $webDir; refusing to run from an unknown directory."
}

Push-Location $webDir
try {
  foreach ($name in $names) { Set-OneSecret -Name $name }
}
finally {
  Pop-Location
}
