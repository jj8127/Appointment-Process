// Splits fc-notify request time into phases using its Server-Timing header.
// A (test FC) calls a light action and the 1:1 list repeatedly; the gap between
// what the caller waited and the function's own total is network + gateway.
// Reads the MSGBOT_* variables; prints timings only.
import { createClient, percentile, readConfig } from './messenger-synthetic-traffic.mjs';

const rounds = Number(process.env.MSGBOT_ROUNDS ?? 15);
const config = readConfig();
const a = await createClient(config).login(config.a);

// MSGBOT_FUNCTION_REGION pins the function to one region (Supabase x-region header).
const region = process.env.MSGBOT_FUNCTION_REGION;
const call = async (body) => {
  const started = performance.now();
  const response = await fetch(`${config.url}/functions/v1/fc-notify`, {
    method: 'POST',
    headers: { apikey: config.anonKey, Authorization: `Bearer ${config.anonKey}`, 'Content-Type': 'application/json', 'x-app-session-token': a.token, ...(region ? { 'x-region': region } : {}) },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  const wall = performance.now() - started;
  const phases = {};
  let worker = '';
  for (const part of (response.headers.get('server-timing') ?? '').split(',')) {
    const [name, ...params] = part.trim().split(';');
    const dur = Number(params.find((p) => p.startsWith('dur='))?.slice(4));
    if (name === 'worker') worker = params.find((p) => p.startsWith('desc='))?.slice(5).replaceAll('"', '') ?? '';
    else if (name) phases[name] = dur;
  }
  return { json, wall, phases, worker, region: response.headers.get('x-sb-edge-region') ?? '' };
};

const conversation_id = (await call({ type: 'resolve_garamin_direct_conversation', target_id: config.b.phone })).json.conversation?.id;
const summarize = (label, rows) => {
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row.phases)))];
  const wall = rows.map((row) => row.wall);
  const total = rows.map((row) => row.phases.total ?? NaN);
  const outside = rows.map((row) => row.wall - (row.phases.total ?? 0));
  console.log(`\n${label} (n=${rows.length}, cold=${rows.filter((row) => row.worker === 'cold').length}, region=${rows[0]?.region || '?'})`);
  console.log(`  caller waited  p50=${percentile(wall, 50)?.toFixed(0)} p95=${percentile(wall, 95)?.toFixed(0)}`);
  console.log(`  inside function p50=${percentile(total, 50)?.toFixed(0)}`);
  console.log(`  outside (network+gateway) p50=${percentile(outside, 50)?.toFixed(0)}`);
  for (const key of keys.filter((k) => k !== 'total')) {
    console.log(`    ${key.padEnd(12)} p50=${percentile(rows.map((row) => row.phases[key] ?? 0), 50)?.toFixed(1)}`);
  }
};

const light = [], list = [];
for (let i = 0; i < rounds; i += 1) {
  light.push(await call({ type: 'inbox_unread_count' }));
  list.push(await call({ type: 'direct_message_list', conversation_id }));
}
summarize('inbox_unread_count', light);
summarize('direct_message_list (full)', list);
