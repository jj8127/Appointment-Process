[CmdletBinding()]
param(
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$DigestDir = Join-Path $RepoRoot '.codex-tmp\insurance-digest'
$Today = Get-Date -Format 'yyyy-MM-dd'
$PromptPath = Join-Path $DigestDir "codex-prompt-$Today.txt"
$LastMessagePath = Join-Path $DigestDir "codex-cli-$Today.txt"
$JsonLogPath = Join-Path $DigestDir "codex-cli-$Today.jsonl"
$ErrorLogPath = Join-Path $DigestDir "codex-cli-$Today.err.log"
$PrecheckLogPath = Join-Path $DigestDir "precheck-$Today.json"
$CodexTimeoutSeconds = 60 * 45

New-Item -ItemType Directory -Force -Path $DigestDir | Out-Null

$Prompt = @'
You are running the GaramIn insurance digest fallback from a Windows scheduled task.

Before doing any work, check whether today's KST post titled `보험소식 브리핑 YYYY.MM.DD` already exists in the GaramIn `일반` board category. If it exists, verify FC/admin `inbox_list` include the post, repair only missing notification rows through `fc-notify` if needed, and stop.

If today's post is missing, search credible public Korean insurance-related sources from the previous Monday through Sunday in KST. Prefer financial regulators, official insurance associations, insurance research institutes, and major media. Exclude blogs, ads, duplicate wire copies, unclear sources, and anything without a credible URL.

Write one very short and very easy Korean digest. Use the title `보험소식 브리핑 YYYY.MM.DD`. Do not paste raw URLs in visible content. Use short source names such as `출처: 금융감독원`. Do not add AI/reference/disclaimer copy. Save a JSON payload to `.codex-tmp/insurance-digest/YYYY-MM-DD.json` with `title`, `content`, non-empty `sourceUrls`, and optional `sourceLabels`.

Run `npm run ops:post-insurance-digest -- --input-file .codex-tmp/insurance-digest/YYYY-MM-DD.json`, then verify board detail and FC/admin inbox rows. Do not edit tracked source files or docs. If shell, search, or posting fails, report the exact blocker instead of saying it uploaded.
'@

$CodexArgs = @(
  'exec',
  '--dangerously-bypass-approvals-and-sandbox',
  '-C', $RepoRoot.Path,
  '--json',
  '--output-last-message', $LastMessagePath,
  '-'
)

$CodexCommand = Get-Command codex.cmd -ErrorAction SilentlyContinue
if (-not $CodexCommand) {
  $CodexCommand = Get-Command codex -ErrorAction Stop
}
$CodexPath = $CodexCommand.Source

function Stop-ProcessTree {
  param([int]$RootProcessId)

  $children = Get-CimInstance Win32_Process |
    Where-Object { $_.ParentProcessId -eq $RootProcessId }

  foreach ($child in $children) {
    Stop-ProcessTree -RootProcessId ([int]$child.ProcessId)
  }

  Stop-Process -Id $RootProcessId -Force -ErrorAction SilentlyContinue
}

function Test-CodexTurnCompleted {
  if (-not (Test-Path -LiteralPath $LastMessagePath)) {
    return $false
  }
  if (-not (Test-Path -LiteralPath $JsonLogPath)) {
    return $false
  }
  return [bool](Select-String -LiteralPath $JsonLogPath -Pattern '"type":"turn.completed"' -SimpleMatch -Quiet)
}

if ($DryRun) {
  [pscustomobject]@{
    repoRoot = $RepoRoot.Path
    digestDir = $DigestDir
    promptPath = $PromptPath
    lastMessagePath = $LastMessagePath
    jsonLogPath = $JsonLogPath
    errorLogPath = $ErrorLogPath
    precheckLogPath = $PrecheckLogPath
    codex = $CodexPath
    timeoutSeconds = $CodexTimeoutSeconds
  } | ConvertTo-Json -Depth 3
  exit 0
}

Push-Location $RepoRoot
$CodexProcess = $null
try {
  Remove-Item -LiteralPath $LastMessagePath, $JsonLogPath, $ErrorLogPath, $PrecheckLogPath -ErrorAction SilentlyContinue

  & node '.\scripts\ops\post-insurance-digest.mjs' '--check-existing' *> $PrecheckLogPath
  $PrecheckExitCode = $LASTEXITCODE
  if ($PrecheckExitCode -eq 0) {
    exit 0
  }
  if ($PrecheckExitCode -ne 2) {
    exit $PrecheckExitCode
  }

  Set-Content -LiteralPath $PromptPath -Value $Prompt -Encoding utf8

  $CodexProcess = Start-Process `
    -FilePath $CodexPath `
    -ArgumentList $CodexArgs `
    -WorkingDirectory $RepoRoot.Path `
    -RedirectStandardInput $PromptPath `
    -RedirectStandardOutput $JsonLogPath `
    -RedirectStandardError $ErrorLogPath `
    -WindowStyle Hidden `
    -PassThru

  $deadline = (Get-Date).AddSeconds($CodexTimeoutSeconds)
  $completedByOutput = $false

  while ((Get-Date) -lt $deadline) {
    if ($CodexProcess.HasExited) {
      break
    }
    if (Test-CodexTurnCompleted) {
      $completedByOutput = $true
      break
    }
    Start-Sleep -Seconds 5
  }

  if (-not $CodexProcess.HasExited) {
    Stop-ProcessTree -RootProcessId $CodexProcess.Id
    if ($completedByOutput) {
      exit 0
    }
    "Codex fallback timed out after $CodexTimeoutSeconds seconds." | Out-File -LiteralPath $ErrorLogPath -Append -Encoding utf8
    exit 124
  }

  exit $CodexProcess.ExitCode
} finally {
  Pop-Location
}
