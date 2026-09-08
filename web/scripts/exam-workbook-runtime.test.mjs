import assert from 'node:assert/strict';
import test from 'node:test';

// Built Next routes backed only by incident-fixture.mjs on localhost.
const base = 'http://localhost:55492';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function login(phone) {
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password: 'fixture-pass' }),
  });
  assert.equal(response.status, 200);
  return response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
}
const exportProofs = (cookie, body) => fetch(`${base}/api/admin/exam-applicants/payment-proof-export`, {
  method: 'POST', headers: { cookie, origin: base, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

test('proof export requires a verified staff session and rejects invalid input', async () => {
  assert.equal((await exportProofs('', { registrationIds: [id(1)] })).status, 401);
  const fc = await login('01010000000');
  assert.equal((await exportProofs(fc, { registrationIds: [id(1)] })).status, 403);
  const admin = await login('01000000001');
  for (const body of [null, {}, { registrationIds: [] }, { registrationIds: ['invalid'] }]) {
    assert.equal((await exportProofs(admin, body)).status, 400);
  }
});

test('staff export keeps selected IDs, deduplicates and batches 30-day proof links', async () => {
  for (const phone of ['01000000001', '01000000003']) {
    const cookie = await login(phone);
    const response = await exportProofs(cookie, { registrationIds: [id(2), id(2), id(3)] });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /no-store/);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.validDays, 30);
    assert.deepEqual(body.links.map(link => link.registrationId), [id(2), id(3)]);
    assert.ok(body.links.every(link => link.signedUrl.includes('token=synthetic')));
  }
  const cookie = await login('01000000001');
  const registrationIds = Array.from({ length: 205 }, (_, index) => id(index + 1));
  const response = await exportProofs(cookie, { registrationIds });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.links.map(link => link.registrationId), registrationIds);
});

test('applicant read retains export subject, application state and proof presence', async () => {
  const cookie = await login('01000000003');
  const response = await fetch(`${base}/api/admin/exam-applicants`, { headers: { cookie } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.applicants.length, 3);
  assert.equal(body.applicants[0].payment_proof_attached, true);
  assert.equal(body.applicants[1].status, 'rejected');
  assert.equal(body.applicants[2].includes_primary_exam, false);
  assert.equal(body.applicants[2].is_third_exam, true);
});
