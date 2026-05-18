[CmdletBinding()]
param(
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$DigestDir = Join-Path $RepoRoot '.codex-tmp\insurance-digest'
$Today = Get-Date -Format 'yyyy-MM-dd'
$LastMessagePath = Join-Path $DigestDir "codex-cli-$Today.txt"
$JsonLogPath = Join-Path $DigestDir "codex-cli-$Today.jsonl"

New-Item -ItemType Directory -Force -Path $DigestDir | Out-Null

$Prompt = @"
You are running the GaramIn insurance digest fallback from a Windows scheduled task.

Before doing any work, check whether today's KST post titled `보험 이슈 브리핑 YYYY.MM.DD` already exists in the GaramIn `보험소식` board category. If it exists, verify `fc-notify latest_notice` and FC/admin `inbox_list` include the post, repair only missing notification rows through `fc-notify` if needed, and stop.

If today's post is missing, search credible public Korean insurance-related sources from the last 24 hours. Prefer financial regulators, official insurance associations, insurance research institutes, and major media. Exclude blogs, ads, duplicate wire copies, unclear sources, and anything without a credible URL.

Write one very short and very easy Korean digest. Do not paste raw URLs in visible content. Use short source names such as `출처: 금융감독원`. Do not add AI/reference/disclaimer copy. Save a JSON payload to `.codex-tmp/insurance-digest/YYYY-MM-DD.json` with `title`, `content`, non-empty `sourceUrls`, and optional `sourceLabels`.

Run `npm run ops:post-insurance-digest -- --input-file .codex-tmp/insurance-digest/YYYY-MM-DD.json`, then verify board detail, home latest notice, and FC/admin inbox rows. Do not edit tracked source files or docs. If shell, search, or posting fails, report the exact blocker instead of saying it uploaded.
"@

$CodexArgs = @(
  'exec',
  '--search',
  '--dangerously-bypass-approvals-and-sandbox',
  '-m', 'gpt-5.2',
  '-C', $RepoRoot.Path,
  '--json',
  '--output-last-message', $LastMessagePath,
  $Prompt
)

if ($DryRun) {
  [pscustomobject]@{
    repoRoot = $RepoRoot.Path
    digestDir = $DigestDir
    lastMessagePath = $LastMessagePath
    jsonLogPath = $JsonLogPath
    codex = (Get-Command codex).Source
  } | ConvertTo-Json -Depth 3
  exit 0
}

Push-Location $RepoRoot
try {
  & codex @CodexArgs *> $JsonLogPath
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
