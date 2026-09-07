import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Run the already-built preview with only OS essentials and synthetic settings.
// No inherited service, telemetry or release credentials reach the child.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  ['path', 'systemroot', 'windir', 'temp', 'tmp'].includes(key.toLowerCase()),
));
Object.assign(env, {
  NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55491',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-anon',
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key-for-local-test',
  STAFF_SESSION_SECRET: 'synthetic-staff-secret-for-local-test',
  FC_GRAPH_SESSION_SECRET: 'synthetic-graph-secret-for-local-test',
  SENTRY_AUTH_TOKEN: '', SENTRY_DSN: '', NEXT_PUBLIC_SENTRY_DSN: '',
  NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY: '',
});
const child = spawn(process.execPath, [
  fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url)),
  'start', '--hostname', '127.0.0.1', '--port', '55492',
], { cwd: fileURLToPath(new URL('../', import.meta.url)), env, stdio: 'inherit', windowsHide: true });
child.on('exit', code => { process.exitCode = code ?? 1; });
process.on('SIGINT', () => child.kill());
process.on('SIGTERM', () => child.kill());
