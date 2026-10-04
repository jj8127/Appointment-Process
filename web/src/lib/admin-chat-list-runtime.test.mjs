import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import * as targets from './admin-chat-targets.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const session = { role: 'admin', residentDigits: '00000000001', staffType: 'admin', accountId: 'own-account' };
const columns = {
  fc_profiles: ['id', 'name', 'phone', 'signup_completed', 'affiliation', 'created_at'],
  messages: ['id', 'sender_id', 'receiver_id', 'content', 'created_at', 'is_read'],
  messenger_attachment_delivery_batches: ['id', 'committed_message_ids', 'context_kind', 'status', 'deleted_at'],
  messenger_message_attachments: ['batch_id', 'attachment_id', 'sort_order', 'created_at'],
  garamin_direct_conversations: ['id', 'fc_id'],
  garamin_direct_threads: ['id', 'legacy_conversation_id', 'counterparty_role', 'counterparty_actor_id'],
};

function fixture({ role = 'admin', staffType = 'admin', denied = false } = {}) {
  const profiles = Array.from({ length: 205 }, (_, index) => ({ id: `fc-${index}`, name: `Synthetic ${index}`, phone: `010${String(index).padStart(8, '0')}`, signup_completed: true, affiliation: null }));
  const messages = profiles.map((profile, index) => ({ id: `message-${index}`, sender_id: profile.phone, receiver_id: session.residentDigits, content: '', created_at: '2026-01-01T00:00:00Z', is_read: false }));
  const ownRole = role === 'manager' ? 'manager' : staffType === 'developer' ? 'developer' : 'admin';
  const rows = {
    fc_profiles: profiles,
    messages,
    messenger_attachment_delivery_batches: [
      { id: 'committed', committed_message_ids: [...messages.map((row) => row.id), 'unrelated-message'], context_kind: 'direct_broadcast', status: 'committed', deleted_at: null, messenger_message_attachments: [{ sort_order: 0 }, { sort_order: 1 }] },
      { id: 'pending', committed_message_ids: [messages[0].id], context_kind: 'direct', status: 'pending', deleted_at: null, messenger_message_attachments: [{ sort_order: 0 }] },
      { id: 'deleted', committed_message_ids: [messages[0].id], context_kind: 'direct', status: 'committed', deleted_at: '2026-01-01', messenger_message_attachments: [{ sort_order: 0 }] },
      { id: 'group', committed_message_ids: [messages[0].id], context_kind: 'group', status: 'committed', deleted_at: null, messenger_message_attachments: [{ sort_order: 0 }] },
    ],
    garamin_direct_conversations: profiles.map((profile, index) => ({ id: `legacy-${index}`, fc_id: profile.id })),
    garamin_direct_threads: profiles.flatMap((profile, index) => [
      { id: `own-${index}`, legacy_conversation_id: `legacy-${index}`, counterparty_role: ownRole, counterparty_actor_id: session.accountId },
      { id: `other-${index}`, legacy_conversation_id: `legacy-${index}`, counterparty_role: ownRole, counterparty_actor_id: 'other-account' },
      { id: `shared-${index}`, legacy_conversation_id: `legacy-${index}`, counterparty_role: 'admin', counterparty_actor_id: null },
    ]),
  };
  const calls = [];
  const adminSupabase = { from(table) {
    assert.ok(columns[table], `unexpected table ${table}`);
    let selected = [...rows[table]];
    const query = {
      select(fields) {
        for (const field of fields.split(',')) {
          if (field === 'messenger_message_attachments(sort_order)') continue;
          assert.ok(columns[table].includes(field), `${table}.${field} does not exist in production schema`);
        }
        return query;
      },
      eq(field, value) { selected = selected.filter((row) => row[field] === value); calls.push({ table, method: 'eq', field, value }); return query; },
      is(field, value) { selected = selected.filter((row) => row[field] === value); return query; },
      in(field, values) { if (field !== 'context_kind') assert.ok(values.length <= 100); selected = selected.filter((row) => values.includes(row[field])); calls.push({ table, method: 'in', field, size: values.length }); return query; },
      overlaps(field, values) { assert.ok(values.length <= 100); selected = selected.filter((row) => row[field].some((id) => values.includes(id))); calls.push({ table, method: 'overlaps', size: values.length }); return query; },
      or(expression) { assert.equal(expression, `sender_id.eq.${session.residentDigits},receiver_id.eq.${session.residentDigits}`); return query; },
      order() { return query; }, limit(limit) { selected = selected.slice(0, limit); return query; },
      then(resolve) { return Promise.resolve({ data: selected, error: null }).then(resolve); },
    };
    return query;
  } };
  const code = ts.transpileModule(readFileSync(new URL('../app/api/admin/chat-list/route.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: (id) => {
    if (id === 'next/server') return { NextResponse: { json: (body, options) => ({ status: options?.status ?? 200, body }) } };
    if (id === '@/lib/admin-chat-targets') return targets;
    if (id === '@/lib/admin-supabase') return { adminSupabase };
    if (id === '@/lib/server-session') return { getVerifiedReadOnlyAdminSession: async () => denied ? { ok: false, status: 401, error: 'Unauthorized' } : { ok: true, session: { ...session, role, staffType } } };
    throw new Error(`Unexpected dependency ${id}`);
  } });
  return { GET: exports.GET, calls };
}

for (const [role, staffType] of [['admin', 'admin'], ['admin', 'developer'], ['manager', null]]) {
  test(`chat-list ${role}/${staffType} uses actual batch schema, bounded filters and exact canonical actor`, async () => {
    const h = fixture({ role, staffType }); const response = await h.GET();
    assert.equal(response.status, 200); assert.equal(response.body.length, 205);
    for (const item of response.body) {
      assert.equal(item.last_message, '파일 2개'); assert.equal(item.unread_count, 1);
      assert.equal(item.conversation_id, `own-${item.fc_id.slice(3)}`);
    }
    assert.equal(h.calls.filter((call) => call.method === 'overlaps').length, 3);
    assert.equal(h.calls.filter((call) => call.table === 'garamin_direct_threads' && call.field === 'counterparty_actor_id').length, 3);
  });
}

test('chat-list authentication rejection performs no privileged queries', async () => {
  const h = fixture({ denied: true }); assert.equal((await h.GET()).status, 401); assert.equal(h.calls.length, 0);
});
