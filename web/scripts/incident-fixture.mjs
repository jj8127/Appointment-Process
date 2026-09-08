// Synthetic localhost-only upstream for login/referral/inbox and workbook regression.
import { createServer } from 'node:http';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// Optional multi-component sample for pointer/follower/unrelated-motion browser QA.
const branched = process.argv.includes('--branched');
const parentIndex = (index) => !branched ? (index ? 0 : null)
  : index === 0 || index === 399 ? null : index < 5 ? 0 : index < 399 ? 1 + ((index - 5) % 4) : 399;
const profiles = Array.from({ length: 447 }, (_, index) => ({
  id: id(index + 1), name: `Fixture ${index + 1}`, phone: String(1010000000 + index).padStart(11, '0'),
  affiliation: 'Synthetic QA', signup_completed: true, is_manager_referral_shadow: false,
  recommender: parentIndex(index) === null ? null : `Fixture ${parentIndex(index) + 1}`,
  recommender_fc_id: parentIndex(index) === null ? null : id(parentIndex(index) + 1),
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
  if (url.pathname === '/functions/v1/admin-action') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (body.action !== 'getResidentNumbers') return reply({ ok: false }, 400);
    return reply({ ok: true, residentNumbers: Object.fromEntries(body.payload.fcIds.map(id => [id, 'SYNTHETIC-ID'])) });
  }
  if (url.pathname.startsWith('/rest/v1/')) {
    const table = url.pathname.slice('/rest/v1/'.length);
    if (table === 'exam_payment_proof_uploads') {
      const ids = (url.searchParams.get('registration_id') ?? '').match(/[0-9a-f]{8}-[0-9a-f-]{27}/g) ?? [];
      return reply(ids.map(registration_id => ({ registration_id, storage_path: `synthetic/${registration_id}.png` })));
    }
    if (table === 'exam_registrations') {
      return reply(profiles.slice(0, 3).map((profile, index) => ({
        id: id(index + 1), resident_id: profile.phone, status: index === 1 ? 'rejected' : 'applied',
        created_at: '2026-09-01T00:00:00Z', round_id: id(900), is_confirmed: index === 0,
        includes_primary_exam: index !== 2, is_third_exam: index === 2, payment_proof_attached: index === 0,
        fee_paid_date: index === 0 ? '2026-08-31' : null,
        exam_locations: { location_name: 'Synthetic location' },
        exam_rounds: { round_label: 'Synthetic round', exam_date: '2026-09-20', exam_type: 'life' },
      })));
    }
    if (table === 'web_push_subscriptions' && req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (!['admin', 'fc'].includes(body.role)) {
        return reply({ message: 'web_push_subscriptions_role_check', code: '23514' }, 400);
      }
      stats.lastWebPushSubscriber = { role: body.role, residentId: body.resident_id };
      return reply({});
    }
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
  if (url.pathname === '/storage/v1/object/sign/exam-payment-proofs') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (body.expiresIn !== 30 * 24 * 60 * 60 || body.paths.length > 100) {
      return reply({ error: 'Unexpected synthetic signing request' }, 400);
    }
    return reply(body.paths.map(path => ({ path, signedURL: `/object/sign/exam-payment-proofs/${path}?token=synthetic` })));
  }
  return reply({ error: 'Synthetic endpoint not implemented' }, 404);
}).listen(55491, '127.0.0.1', () => console.log('Synthetic upstream ready on 127.0.0.1:55491'));
