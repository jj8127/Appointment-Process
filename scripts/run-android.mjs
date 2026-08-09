import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';

const adb = process.env.ADB_PATH
  || (process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', 'adb.exe')
    : 'adb');

const readDevices = () => {
  let output;
  try {
    output = execFileSync(adb, ['devices', '-l'], { encoding: 'utf8' });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`ADB 장치 목록을 읽지 못했습니다. ${detail}`);
  }

  return output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => !line.includes('_adb-tls-connect._tcp'))
    .map((line) => line.match(/^(.*?)\s+device(?:\s|$)/)?.[1]?.trim())
    .filter(Boolean);
};

const devices = readDevices();
if (devices.length === 0) {
  throw new Error(
    '온라인 Android 장치가 없습니다. 휴대폰에서 무선 디버깅을 켠 뒤 `adb connect <IP>:<디버깅포트>`를 먼저 실행하세요.',
  );
}

const requestedDevice = process.env.ANDROID_SERIAL?.trim();
const device = requestedDevice && devices.includes(requestedDevice)
  ? requestedDevice
  : devices.find((candidate) => candidate.includes(':')) || devices[0];

if (requestedDevice && requestedDevice !== device) {
  console.warn(`기존 ANDROID_SERIAL(${requestedDevice})을 무시하고 온라인 장치 ${device}를 사용합니다.`);
}

console.log(`Android 장치 선택: ${device}`);
const expoCli = path.resolve(process.cwd(), 'node_modules', 'expo', 'bin', 'cli');
const child = spawn(
  process.execPath,
  [expoCli, 'run:android', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: { ...process.env, ANDROID_SERIAL: device },
  },
);

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
