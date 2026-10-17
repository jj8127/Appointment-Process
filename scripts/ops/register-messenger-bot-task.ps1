# Registers a daily Windows Task Scheduler run of run-messenger-bot.ps1 for the
# signed-in user. The task stores no password: it runs only while the user is
# logged on and reads MSGBOT_A_PASSWORD / MSGBOT_B_PASSWORD from the user
# environment. Output goes to .messenger-bot\run-*.jsonl and run-*.log.
#   .\scripts\ops\register-messenger-bot-task.ps1             # daily 09:30, 20 rounds
#   .\scripts\ops\register-messenger-bot-task.ps1 -At 14:00 -Rounds 30
#   .\scripts\ops\register-messenger-bot-task.ps1 -Remove
param(
  [string]$At = '09:30',
  [int]$Rounds = 20,
  [int]$IntervalMs = 15000,
  [string]$TaskName = 'GaraminMessengerBot',
  [switch]$Remove
)

if ($Remove) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  return
}

foreach ($name in 'MSGBOT_A_PASSWORD', 'MSGBOT_B_PASSWORD') {
  if (-not [Environment]::GetEnvironmentVariable($name, 'User')) {
    Write-Warning "$name is not set as a user environment variable; scheduled runs will fail until it is."
  }
}

$script = Join-Path $PSScriptRoot 'run-messenger-bot.ps1'
$arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$script`" -Rounds $Rounds -IntervalMs $IntervalMs -Unattended"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory (Resolve-Path (Join-Path $PSScriptRoot '..\..'))
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force |
  Select-Object TaskName, State
