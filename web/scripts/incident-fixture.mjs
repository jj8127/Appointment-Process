// Synthetic localhost-only upstream for the login/referral/inbox regression.
import { createServer } from 'node:http';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const profiles = Array.from({ length: 447 }, (_, index) => ({
  id: id(index + 1), name: `Fixture ${index + 1}`, phone: String(1010000000 + index).padStart(11, '0'),
  affiliation: 'Synthetic QA', signup_completed: true, is_manager_referral_shadow: false,
  recommender: index ? 'Fixture 1' : null, recommender_fc_id: index ? id(1) : null,
  life_commission_completed: true, nonlife_commission_completed: true,
  appointment_date_life: null, appointment_date_nonlife: null,
}));
const codes = profiles.map((p, index) => ({
  id: id(1001 + index), fc_id: p.id, code: `QA${String(index).padStart(6, '0')}`,
  is_active: true, created_at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(), disabled_at: null,
}));
const actors = [
  { id: id(9001), name: 'QA Admin', phone: '01000000001', active: true, staff_type: 'admin' },
  { id: id(9002), name: 'QA Developer', phone: '01000000002', active: true, staff_type: 'developer' },
];
const managers = [{ id: id(9003), name: 'QA Manager', phone: '01000000003', active: true }];
const stats = { codeRequests: 0, eventRequests: 0, maxFilterIds: 0, maxUrlBytes: 0, inboxRequests: 0 };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:55491');
  const reply = (data, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(data));
  };
  if (req.method === 'OPTIONS') return reply({});
  if (url.pathname === '/health') return reply({ ok: true, ...stats });
  if (url.pathname === '/functions/v1/login-with-password') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const role = body.phone === '01000000003' ? 'manager' : body.phone === profiles[0].phone ? 'fc' : 'admin';
    const actor = [...actors, ...managers, profiles[0]].find((a) => a.phone === body.phone);
    if (!actor || body.password !== 'fixture-pass') return reply({ ok: false, message: 'Synthetic credentials rejected' });
    return reply({ ok: true, role, residentId: actor.phone, displayName: actor.name, staffType: actor.staff_type ?? null, appSessionToken: 'synthetic-app-token' });
  }
  if (url.pathname === '/functions/v1/fc-notify') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    stats.inboxRequests++;
    const actor = [...actors, ...managers, profiles[0]].find((a) => a.phone === body.viewer_actor_phone);
    if (!actor || !['admin', 'manager', 'fc'].includes(body.viewer_actor_role)) {
      return reply({ ok: false, message: 'Verified notification viewer is required' }, 401);
    }
    return reply({ ok: true, notifications: [], notices: [] });
  }
  if (url.pathname.startsWith('/rest/v1/')) {
    const table = url.pathname.slice('/rest/v1/'.length);
    const filter = url.searchParams.get('fc_id') ?? url.searchParams.get('or') ?? '';
    if (['referral_codes', 'referral_events'].includes(table)) {
      const ids = Array.from(new Set(filter.match(/[0-9a-f]{8}-[0-9a-f-]{27}/g) ?? []));
      if (Buffer.byteLength(req.url) > 8192) return reply({ message: 'Bad Request' }, 400);
      stats.maxUrlBytes = Math.max(stats.maxUrlBytes, Buffer.byteLength(req.url));
      stats.maxFilterIds = Math.max(stats.maxFilterIds, ids.length);
      if (table === 'referral_codes') {
        stats.codeRequests++;
        return reply(codes.filter(c => ids.includes(c.fc_id)).sort((a,b) => b.created_at.localeCompare(a.created_at)));
      }
      stats.eventRequests++;
      return reply([]);
    }
    let rows = table === 'fc_profiles' ? profiles : table === 'admin_accounts' ? actors : table === 'manager_accounts' ? managers : [];
    for (const key of ['id', 'phone']) {
      const value = url.searchParams.get(key);
      if (value?.startsWith('eq.')) rows = rows.filter(row => String(row[key]) === value.slice(3));
      if (value?.startsWith('in.')) rows = rows.filter(row => value.includes(String(row[key])));
    }
    return reply(req.headers.accept?.includes('application/vnd.pgrst.object+json') ? rows[0] ?? null : rows);
  }
  return reply({ error: 'Synthetic endpoint not implemented' }, 404);
}).listen(55491, '127.0.0.1', () => console.log('Synthetic upstream ready on 127.0.0.1:55491'));
