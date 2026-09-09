$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$taskOutput = Join-Path $taskRoot '.codex-tmp/referral-emulator-instrumentation'
$taskSdk = Join-Path $env:LOCALAPPDATA 'Android/Sdk'
$taskTools = Join-Path $taskSdk 'build-tools/36.0.0'
$taskJava = Join-Path $env:JAVA_HOME 'bin'
$taskAndroidJar = Join-Path $taskSdk 'platforms/android-36/android.jar'
$taskClasses = Join-Path $taskOutput 'classes'
$taskDex = Join-Path $taskOutput 'dex'
New-Item -ItemType Directory -Force -Path $taskClasses, $taskDex | Out-Null

function Invoke-QaBuildTool {
  param([string]$TaskExecutable, [string[]]$TaskArguments)
  & $TaskExecutable @TaskArguments
  if ($LASTEXITCODE -ne 0) { throw "QA build tool failed: $TaskExecutable" }
}

$taskManifest = @'
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.garamin.graphqa.test">
  <uses-sdk android:minSdkVersion="24" android:targetSdkVersion="36" />
  <application android:label="Referral Graph Test Runner" android:debuggable="true" />
  <instrumentation android:name="com.garamin.graphqa.GraphInstrumentation" android:targetPackage="com.jj8127.Garam_in.referralqa" android:functionalTest="true" />
</manifest>
'@
$taskManifestPath = Join-Path $taskOutput 'AndroidManifest.xml'
[IO.File]::WriteAllText($taskManifestPath, $taskManifest, [Text.UTF8Encoding]::new($false))
$taskJar = Join-Path $taskOutput 'classes.jar'
$taskUnsigned = Join-Path $taskOutput 'unsigned.apk'
$taskAligned = Join-Path $taskOutput 'aligned.apk'
$taskApk = Join-Path $taskOutput 'referral-graph-test.apk'
Invoke-QaBuildTool (Join-Path $taskJava 'javac.exe') @('-encoding', 'UTF-8', '--release', '8', '-classpath', $taskAndroidJar, '-d', $taskClasses, (Join-Path $PSScriptRoot 'java/com/garamin/graphqa/GraphInstrumentation.java'))
Invoke-QaBuildTool (Join-Path $taskJava 'jar.exe') @('cf', $taskJar, '-C', $taskClasses, '.')
Invoke-QaBuildTool (Join-Path $taskTools 'd8.bat') @('--lib', $taskAndroidJar, '--min-api', '24', '--output', $taskDex, $taskJar)
Invoke-QaBuildTool (Join-Path $taskTools 'aapt2.exe') @('link', '-o', $taskUnsigned, '--manifest', $taskManifestPath, '-I', $taskAndroidJar)
Invoke-QaBuildTool (Join-Path $taskJava 'jar.exe') @('uf', $taskUnsigned, '-C', $taskDex, 'classes.dex')
Invoke-QaBuildTool (Join-Path $taskTools 'zipalign.exe') @('-f', '4', $taskUnsigned, $taskAligned)
Invoke-QaBuildTool (Join-Path $taskTools 'apksigner.bat') @('sign', '--ks', (Join-Path $taskRoot 'android/app/debug.keystore'), '--ks-key-alias', 'androiddebugkey', '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--out', $taskApk, $taskAligned)
Write-Output "Built SDK-only instrumentation: $taskApk"
