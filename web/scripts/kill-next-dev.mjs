import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Best-effort helper for Windows: stale Next dev processes can keep `.next/dev/lock`
// open and cause "lockfile (os error 5)" on the next run.
function killNextDevWindows() {
  if (process.platform !== 'win32') return;

  const webDir = path.resolve(process.cwd());
  const webDirEscaped = webDir.replaceAll('"', '""');

  const ps = [
    `$webDir = "${webDirEscaped}";`,
    `$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |`,
    `  Where-Object { $_.CommandLine -and $_.CommandLine -like ("*" + $webDir + "*") -and (`,
    `    $_.CommandLine -match "\\\\next\\\\dist\\\\" -or $_.CommandLine -match "\\\\.next\\\\dev\\\\"`,
    `  ) };`,
    `$pids = @($procs | Select-Object -ExpandProperty ProcessId);`,
    `if ($pids.Count -gt 0) { Stop-Process -Id $pids -Force -ErrorAction SilentlyContinue }`,
    `ConvertTo-Json -Compress -InputObject $pids`,
  ].join(' ');

  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();

    let pids = [];
    try {
      pids = JSON.parse(out || '[]');
    } catch {
      pids = [];
    }

    if (!Array.isArray(pids)) {
      pids = typeof pids === 'number' ? [pids] : [];
    }

    if (pids.length > 0) {
      console.log(`[kill-next-dev] stopped pids: ${pids.join(', ')}`);
    }
  } catch {
    // If we can't enumerate/kill, don't block dev startup.
  }
}

killNextDevWindows();
