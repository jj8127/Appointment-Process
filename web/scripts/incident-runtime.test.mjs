import assert from 'node:assert/strict';
import test from 'node:test';

// Requires the synthetic fixture and the production build on localhost only.
const base = 'http://localhost:55492';
const upstream = 'http://127.0.0.1:55491';
const inbox = (cookie, body = { type: 'inbox_list' }, origin = base) => fetch(`${base}/api/fc-notify`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', cookie, origin }, body: JSON.stringify(body),
});
const login = async (phone) => {
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password: 'fixture-pass' }),
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal('appSessionToken' in data, false);
  const headers = response.headers.getSetCookie();
  assert.ok(headers.some(c => c.startsWith('session_role=')));
  assert.ok(headers.some(c => c.startsWith('session_resident=')));
  assert.ok(headers.some(c => /^(staff_session|fc_graph_session)=.+HttpOnly/.test(c)));
  const cookie = headers.map(c => c.split(';')[0]).join('; ');
  return { cookie, role: data.role };
};

test('reproduces oversized legacy code and event filters without production data', async () => {
  const ids = Array.from({ length: 447 }, (_, n) => `00000000-0000-4000-8000-${String(n+1).padStart(12, '0')}`);
  for (const [table, key, filter] of [
    ['referral_codes', 'fc_id', `in.(${ids.join(',')})`],
    ['referral_events', 'or', `(inviter_fc_id.in.(${ids.join(',')}),invitee_fc_id.in.(${ids.join(',')}))`],
  ]) {
    const url = new URL(`${upstream}/rest/v1/${table}`);
    url.searchParams.set(key, filter);
    const response = await fetch(url);
    assert.ok([400, 431].includes(response.status));
  }
});

test('login creates a usable session and graph/list return all synthetic profiles using bounded requests', async () => {
  const { cookie } = await login('01000000001');
  const graphResponse = await fetch(`${base}/api/admin/referrals/graph`, { headers: { cookie } });
  assert.equal(graphResponse.status, 200);
  const graph = await graphResponse.json();
  assert.equal(graph.nodes.length, 447);
  assert.equal(graph.edges.length, 446);
  assert.equal(graph.permissions.scope, 'all');
  const listResponse = await fetch(`${base}/api/admin/referrals?page=1&pageSize=20`, { headers: { cookie } });
  assert.equal(listResponse.status, 200);
  const list = await listResponse.json();
  assert.equal(list.total, 447);
  assert.equal(list.items.length, 20);
  const stats = await (await fetch(`${upstream}/health`)).json();
  assert.ok(stats.codeRequests >= 24);
  assert.ok(stats.eventRequests >= 12);
  assert.ok(stats.maxFilterIds <= 40);
  assert.ok(stats.maxUrlBytes <= 8192);
});

test('verified inbox works for staff, manager and FC while unauthenticated/forged/cross-origin requests stay rejected', async () => {
  for (const phone of ['01000000001','01000000002','01000000003','01010000000']) {
    const { cookie } = await login(phone);
    const response = await inbox(cookie, { type: 'inbox_list', resident_id: 'forged', viewer_actor_phone: 'forged', viewer_actor_role: 'admin' });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.ok, true);
    if (phone === '01000000003') {
      const mutation = await fetch(`${base}/api/admin/referrals`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'backfill_missing_codes' }) });
      assert.equal(mutation.status, 403);
    }
    if (phone === '01010000000') {
      const graph = await (await fetch(`${base}/api/admin/referrals/graph`, { headers: { cookie } })).json();
      assert.equal(graph.permissions.scope, 'downline');
      assert.ok(graph.nodes.every(n => n.phone === ''));
    }
  }
  assert.equal((await inbox('')).status, 401);
  assert.equal((await inbox('session_role=admin; session_resident=01000000001')).status, 401);
  const { cookie } = await login('01000000001');
  assert.equal((await inbox(cookie, { type: 'inbox_list' }, 'https://foreign.invalid')).status, 403);
  const logout = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { cookie } });
  assert.ok(logout.headers.getSetCookie().some(c => c.startsWith('session_role=;') && c.includes('Max-Age=0')));
});
