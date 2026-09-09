param([string]$Device = 'emulator-5554', [ValidateSet('full', 'observe', 'performance')][string]$Mode = 'full', [string]$EvidenceTag = '')
$ErrorActionPreference = 'Stop'
if ($Device -notmatch '^emulator-[0-9]+$') { throw 'This runner targets an emulator only.' }
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$taskSdk = Join-Path $env:LOCALAPPDATA 'Android/Sdk'
$taskAdb = Join-Path $taskSdk 'platform-tools/adb.exe'
$taskAapt = Join-Path $taskSdk 'build-tools/36.0.0/aapt2.exe'
$taskApk = Join-Path $taskRoot '.codex-tmp/referral-emulator-apk/build/outputs/apk/release/app-release.apk'
$taskTestApk = Join-Path $taskRoot '.codex-tmp/referral-emulator-instrumentation/referral-graph-test.apk'
$taskEvidence = Join-Path $taskRoot '.codex-tmp/referral-emulator-evidence'
if ($EvidenceTag) {
  if ($EvidenceTag -notmatch '^[a-z0-9][a-z0-9-]{0,63}$') { throw 'Evidence tag must be a short safe identifier.' }
  $taskEvidence = Join-Path $taskEvidence $EvidenceTag
}
$taskPackage = 'com.jj8127.Garam_in.referralqa'
$taskBadging = (& $taskAapt dump badging $taskApk) -join "`n"
if ($LASTEXITCODE -ne 0 -or $taskBadging -notmatch "package: name='com\.jj8127\.Garam_in\.referralqa'") { throw 'Expected the isolated QA package.' }
if ($taskBadging.Contains("uses-permission: name='android.permission.INTERNET'")) { throw 'Offline QA APK unexpectedly requests INTERNET.' }
& $taskAdb -s $Device install -r $taskApk
if ($LASTEXITCODE -ne 0) { throw 'QA APK install failed.' }
& $taskAdb -s $Device install -r $taskTestApk
if ($LASTEXITCODE -ne 0) { throw 'Instrumentation install failed.' }
$taskResult = (& $taskAdb -s $Device shell am instrument -w -e mode $Mode 'com.garamin.graphqa.test/com.garamin.graphqa.GraphInstrumentation') -join "`n"
New-Item -ItemType Directory -Force -Path $taskEvidence | Out-Null
if ($Mode -eq 'performance') {
  & $taskAdb -s $Device pull "/sdcard/Android/data/$taskPackage/files/referral-graph-qa/report.json" (Join-Path $taskEvidence 'report.json')
} else {
  & $taskAdb -s $Device pull "/sdcard/Android/data/$taskPackage/files/referral-graph-qa/." $taskEvidence
}
if ($LASTEXITCODE -ne 0) { throw 'QA aggregate evidence transfer failed.' }
$taskSourceManifest = Join-Path $taskRoot '.codex-tmp/referral-emulator/performance-source.json'
if (Test-Path -LiteralPath $taskSourceManifest) { Copy-Item -LiteralPath $taskSourceManifest -Destination (Join-Path $taskEvidence 'performance-source.json') }
# The runner emits only its own assertion summaries and anonymous artifact paths.
$taskResult -split "`n" | Where-Object { $_ -match '^INSTRUMENTATION_RESULT: (result|failure|evidence)=|^INSTRUMENTATION_CODE:' } | Write-Output
if ($taskResult -notmatch 'INSTRUMENTATION_CODE: -1' -or $taskResult -match 'INSTRUMENTATION_RESULT: failure=') { throw 'Native QA failed; inspect the aggregate report.' }
Write-Output "Verified package without INTERNET. Evidence: $taskEvidence"
