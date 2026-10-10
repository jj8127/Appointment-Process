import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import vm from 'node:vm';

const source = readFileSync(new URL('../configured-cors.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports, Request, Response, Headers });
const { applyConfiguredCors, withConfiguredCors } = exports;
const origins = ['https://first.example', 'https://second.example', 'http://127.0.0.1:8087'];
const base = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: {
  'Access-Control-Allow-Origin': origins[0], 'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info,x-app-session-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
} });
const request = (origin, method = 'POST') => new Request('https://edge.example/test', { method, headers: origin ? { Origin: origin } : {} });

test('second configured origin works for OPTIONS and actual responses', async () => {
  for (const method of ['OPTIONS', 'POST']) {
    const response = applyConfiguredCors(request(origins[1], method), base(), origins);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origins[1]);
    assert.equal(response.headers.get('Vary'), 'Origin');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), { ok: true });
  }
});
test('localhost works only when its complete origin is explicitly configured', () => {
  assert.equal(applyConfiguredCors(request(origins[2]), base(), origins).headers.get('Access-Control-Allow-Origin'), origins[2]);
  assert.equal(applyConfiguredCors(request(origins[2]), base(), origins.slice(0,2)).headers.get('Access-Control-Allow-Origin'), origins[0]);
});
test('untrusted origins and substring lookalikes are never reflected', () => {
  for (const origin of ['https://untrusted.example','https://first.example.evil.test','http://127.0.0.1:8088','null']) {
    assert.equal(applyConfiguredCors(request(origin), base(), origins).headers.get('Access-Control-Allow-Origin'), origins[0]);
  }
});
test('native requests without Origin keep their existing response', () => {
  const response = base();
  assert.equal(applyConfiguredCors(request(null), response, origins), response);
});
test('status, security headers and body survive every return path', async () => {
  for (const status of [200,204,400,401,403,404,409,429,500,503]) {
    const original = new Response(status === 204 ? null : 'safe-error', { status, headers: { 'Access-Control-Allow-Origin': origins[0], 'Vary': 'Accept-Encoding', 'X-Guard': 'preserved' } });
    const response = applyConfiguredCors(request(origins[1]), original, origins);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('X-Guard'), 'preserved');
    assert.equal(response.headers.get('Vary'), 'Accept-Encoding, Origin');
    assert.equal(await response.text(), status === 204 ? '' : 'safe-error');
  }
});
test('parallel origins do not share mutable headers', async () => {
  const handler = withConfiguredCors(async () => base(), origins);
  const responses = await Promise.all(origins.map(origin => handler(request(origin))));
  assert.deepEqual(responses.map(response => response.headers.get('Access-Control-Allow-Origin')), origins);
});
test('Vary origin is not duplicated and an empty configuration grants nothing new', () => {
  const response = new Response('ok', { headers: { 'Vary': 'Accept-Encoding, origin', 'Access-Control-Allow-Origin': origins[0] } });
  assert.equal(applyConfiguredCors(request(origins[1]), response, []).headers.get('Vary'), 'Accept-Encoding, origin');
  assert.equal(applyConfiguredCors(request(origins[1]), base(), []).headers.get('Access-Control-Allow-Origin'), origins[0]);
});
