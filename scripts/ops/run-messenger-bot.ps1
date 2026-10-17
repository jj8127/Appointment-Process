# Runs scripts/ops/messenger-synthetic-traffic.mjs against production with the
# test FC (A) and a staff account (B). Passwords come from the user environment
# variables MSGBOT_A_PASSWORD / MSGBOT_B_PASSWORD when set, otherwise they are
# typed hidden; either way they leave this PowerShell process when it ends.
#   .\scripts\ops\run-messenger-bot.ps1                 # 6-round smoke run
#   .\scripts\ops\run-messenger-bot.ps1 -Rounds 60 -IntervalMs 30000
#   -Unattended fails instead of prompting (scheduled runs).
param(
  [int]$Rounds = 6,
  [int]$IntervalMs = 10000,
  [int]$DeleteEvery = 3,
  [int]$AttachEvery = 4,
  [string]$APhone = '01012341234',
  [string]$BPhone = '01058006018',
  # Another account's password lives in its own variable, e.g. MSGBOT_OWNER_PASSWORD.
  [string]$APasswordVar = 'MSGBOT_A_PASSWORD',
  [switch]$Unattended
)

function Read-Secret([string]$Prompt) {
  $secure = Read-Host -AsSecureString $Prompt
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

# Public values already shipped inside the app.
$env:MSGBOT_SUPABASE_URL = 'https://ubeginyxaotcamuqpmud.supabase.co'
$env:MSGBOT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InViZWdpbnl4YW90Y2FtdXFwbXVkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQxMjU0OTQsImV4cCI6MjA3OTcwMTQ5NH0.MrqF2XfJ9YnqB1zavP2whfQ6gDabzdCrSdSDbqRA8Qg'
$env:MSGBOT_A_PHONE = $APhone
$env:MSGBOT_B_PHONE = $BPhone
function Get-BotPassword([string]$Name, [string]$Prompt) {
  $value = [Environment]::GetEnvironmentVariable($Name, 'Process')
  if (-not $value) { $value = [Environment]::GetEnvironmentVariable($Name, 'User') }
  if ($value) { return $value }
  if ($Unattended) { throw "$Name is not set; set it as a user environment variable for scheduled runs." }
  Read-Secret $Prompt
}

$env:MSGBOT_A_PASSWORD = Get-BotPassword $APasswordVar "Password for $APhone (FC)"
$env:MSGBOT_B_PASSWORD = Get-BotPassword 'MSGBOT_B_PASSWORD' "Password for $BPhone (staff)"
$env:MSGBOT_ROUNDS = "$Rounds"
$env:MSGBOT_INTERVAL_MS = "$IntervalMs"
$env:MSGBOT_DELETE_EVERY = "$DeleteEvery"
$env:MSGBOT_ATTACH_EVERY = "$AttachEvery"
$env:MSGBOT_OUT = Join-Path $PSScriptRoot ("..\..\.messenger-bot\run-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.jsonl')
New-Item -ItemType Directory -Force (Split-Path $env:MSGBOT_OUT) | Out-Null

try {
  # The p50/p95 summary also lands next to the raw rows for scheduled runs.
  node (Join-Path $PSScriptRoot 'messenger-synthetic-traffic.mjs') 2>&1 |
    Tee-Object -FilePath ($env:MSGBOT_OUT -replace '\.jsonl$', '.log')
} finally {
  Remove-Item Env:MSGBOT_A_PASSWORD, Env:MSGBOT_B_PASSWORD -ErrorAction SilentlyContinue
}
