param([string]$Device = 'emulator-5554', [ValidateSet('baseline', 'current')][string]$Variant = 'current', [ValidateSet('full', 'observe', 'performance')][string]$Mode = 'full', [string]$EvidenceTag = '')
$ErrorActionPreference = 'Stop'
if ($Device -notmatch '^emulator-[0-9]+$') { throw 'This runner targets an emulator only.' }
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$taskEnvNames = @('EXPO_NO_DOTENV', 'EXPO_NO_TELEMETRY', 'SENTRY_AUTH_TOKEN', 'SENTRY_DISABLE_AUTO_UPLOAD', 'DEBUG')
$taskSavedEnv = @{}
foreach ($taskName in $taskEnvNames) { $taskSavedEnv[$taskName] = [Environment]::GetEnvironmentVariable($taskName, 'Process') }
Push-Location $taskRoot
try {
  $env:EXPO_NO_DOTENV = '1'
  $env:EXPO_NO_TELEMETRY = '1'
  $env:SENTRY_AUTH_TOKEN = ''
  $env:SENTRY_DISABLE_AUTO_UPLOAD = 'true'
  $env:DEBUG = ''
  node scripts/testing/referral-graph-performance.cjs --prepare --variant $Variant
  if ($LASTEXITCODE -ne 0) { throw 'Offline project preparation failed.' }
  node node_modules/expo/bin/cli export .codex-tmp/referral-emulator --platform android --output-dir ../referral-emulator-export-current --max-workers 2 --clear
  if ($LASTEXITCODE -ne 0) { throw 'Anonymous graph export failed.' }
  $taskExport = Join-Path $taskRoot '.codex-tmp/referral-emulator-export-current'
  $taskMetadata = Get-Content -Encoding UTF8 -Raw (Join-Path $taskExport 'metadata.json') | ConvertFrom-Json
  $taskBundle = (Resolve-Path (Join-Path $taskExport $taskMetadata.fileMetadata.android.bundle)).Path
  if (-not $taskBundle.StartsWith($taskExport + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Bundle must stay in the QA export.' }
  $taskAssets = Join-Path $taskRoot '.codex-tmp/referral-emulator-apk/assets'
  New-Item -ItemType Directory -Force -Path $taskAssets | Out-Null
  Copy-Item -LiteralPath $taskBundle -Destination (Join-Path $taskAssets 'index.android.bundle')
  & (Join-Path $PSScriptRoot 'build-instrumentation.ps1')
  Push-Location android
  try {
    .\gradlew.bat :app:assembleRelease --offline --no-daemon --no-parallel --max-workers 2 '-Dorg.gradle.jvmargs=-Xmx3072m -XX:MaxMetaspaceSize=1536m' -I ../scripts/testing/referral-graph-emulator/offline.init.gradle -PreactNativeArchitectures=x86_64 --console plain > ../.codex-tmp/referral-emulator-apk/build-current.log 2>&1
    $taskBuildCode = $LASTEXITCODE
  } finally { Pop-Location }
  if ($taskBuildCode -ne 0) { throw 'QA APK build failed; inspect the local build log.' }
  if (-not $EvidenceTag) { $EvidenceTag = "$Variant-$Mode" }
  & (Join-Path $PSScriptRoot 'verify-emulator.ps1') -Device $Device -Mode $Mode -EvidenceTag $EvidenceTag
} finally {
  Pop-Location
  foreach ($taskName in $taskEnvNames) { [Environment]::SetEnvironmentVariable($taskName, $taskSavedEnv[$taskName], 'Process') }
}
