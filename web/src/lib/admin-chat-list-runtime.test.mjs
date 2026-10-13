import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import * as targets from './admin-chat-targets.ts';
import * as queryContract from './supabase-query-contract.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const session = {
  role: 'admin',
  residentDigits: '00000000001',
  staffType: 'admin',
  accountId: 'own-account',
};
const columns = {
  fc_profiles: ['id', 'name', 'phone', 'signup_completed', 'affiliation', 'created_at'],
  messages: ['id', 'sender_id', 'receiver_id', 'content', 'created_at', 'is_read', 'deleted_at'],
  messenger_attachment_delivery_batches: [
    'id',
    'committed_message_ids',
    'context_kind',
    'status',
    'deleted_at',
  ],
  garamin_direct_conversations: ['id', 'fc_id'],
  garamin_direct_threads: [
    'id',
    'legacy_conversation_id',
    'counterparty_role',
    'counterparty_actor_id',
  ],
};

const queryNameForTable = (table) => ({
  fc_profiles: 'participants',
  messages: 'messages',
  messenger_attachment_delivery_batches: 'batches',
  garamin_direct_conversations: 'conversations',
  garamin_direct_threads: 'threads',
})[table];

function fixture({
  role = 'admin',
  staffType = 'admin',
  denied = false,
  profileCount = 205,
  messageRows = null,
  queryError = null,
  queryErrorName = 'participants',
  malformedQuery = null,
  malformedData = null,
  mutateRow = null,
} = {}) {
  const profiles = Array.from({ length: profileCount }, (_, index) => ({
    id: `fc-${index}`,
    name: `Synthetic ${index}`,
    phone: `010${String(index).padStart(8, '0')}`,
    signup_completed: true,
    affiliation: null,
    created_at: '2026-01-01T00:00:00Z',
  }));
  const messages = messageRows ?? profiles.map((profile, index) => ({
    id: `message-${index}`,
    sender_id: profile.phone,
    receiver_id: session.residentDigits,
    content: '',
    created_at: '2026-01-01T00:00:00Z',
    is_read: false,
    deleted_at: null,
  }));
  const ownRole = role === 'manager'
    ? 'manager'
    : staffType === 'developer'
      ? 'developer'
      : 'admin';
  const rows = {
    fc_profiles: profiles,
    messages,
    messenger_attachment_delivery_batches: [
      {
        id: 'committed',
        committed_message_ids: [...messages.map((row) => row.id), 'unrelated-message'],
        context_kind: 'direct_broadcast',
        status: 'committed',
        deleted_at: null,
        messenger_message_attachments: [{ sort_order: 0 }, { sort_order: 1 }],
      },
      {
        id: 'pending',
        committed_message_ids: [messages[0]?.id ?? 'unused'],
        context_kind: 'direct',
        status: 'pending',
        deleted_at: null,
        messenger_message_attachments: [{ sort_order: 0 }],
      },
      {
        id: 'deleted',
        committed_message_ids: [messages[0]?.id ?? 'unused'],
        context_kind: 'direct',
        status: 'committed',
        deleted_at: '2026-01-01T00:00:00Z',
        messenger_message_attachments: [{ sort_order: 0 }],
      },
      {
        id: 'group',
        committed_message_ids: [messages[0]?.id ?? 'unused'],
        context_kind: 'group',
        status: 'committed',
        deleted_at: null,
        messenger_message_attachments: [{ sort_order: 0 }],
      },
    ],
    garamin_direct_conversations: profiles.map((profile, index) => ({
      id: `legacy-${index}`,
      fc_id: profile.id,
    })),
    garamin_direct_threads: profiles.flatMap((profile, index) => [
      {
        id: `own-${index}`,
        legacy_conversation_id: `legacy-${index}`,
        counterparty_role: ownRole,
        counterparty_actor_id: session.accountId,
      },
      {
        id: `other-${index}`,
        legacy_conversation_id: `legacy-${index}`,
        counterparty_role: ownRole,
        counterparty_actor_id: 'other-account',
      },
      {
        id: `shared-${index}`,
        legacy_conversation_id: `legacy-${index}`,
        counterparty_role: 'admin',
        counterparty_actor_id: null,
      },
    ]),
  };
  const calls = [];
  const loggerCalls = [];
  const malformedQueriesInjected = new Set();
  const mutatedQueries = new Set();
  const queryErrorsInjected = new Set();

  const adminSupabase = {
    async rpc(name, args) {
      assert.equal(name, 'get_internal_messenger_summaries_v1');
      assert.equal(args.p_viewer_id, session.residentDigits);
      assert.ok(Array.isArray(args.p_target_ids));
      assert.ok(args.p_target_ids.length > 0 && args.p_target_ids.length <= 100);
      calls.push({ method: 'rpc', name, size: args.p_target_ids.length });

      const queryName = 'summaries';
      const error = queryError
        && queryErrorName === queryName
        && !queryErrorsInjected.has(queryName)
        ? queryError
        : null;
      if (error) queryErrorsInjected.add(queryName);
      if (error) return { data: null, error };

      let resultRows = args.p_target_ids.map((targetId) => {
        const related = messages
          .filter((row) => row.deleted_at === null && (
            (row.sender_id === session.residentDigits && row.receiver_id === targetId)
            || (row.sender_id === targetId && row.receiver_id === session.residentDigits)
          ))
          .sort((left, right) => right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id));
        const latest = related[0] ?? null;
        const hasAttachment = latest && rows.messenger_attachment_delivery_batches.some((batch) =>
          batch.status === 'committed'
          && batch.deleted_at === null
          && ['direct', 'direct_broadcast'].includes(batch.context_kind)
          && batch.committed_message_ids.includes(latest.id)
        );
        return {
          target_id: targetId,
          last_message: latest ? (latest.content.trim() || (hasAttachment ? '첨부파일' : null)) : null,
          last_time: latest?.created_at ?? null,
          unread_count: related.filter((row) =>
            row.receiver_id === session.residentDigits && row.sender_id === targetId && !row.is_read
          ).length,
        };
      });
      if (mutateRow
        && mutateRow.queryName === queryName
        && resultRows.length > 0
        && !mutatedQueries.has(queryName)
      ) {
        mutatedQueries.add(queryName);
        resultRows = [mutateRow.apply(resultRows[0]), ...resultRows.slice(1)];
      }
      const shouldInjectMalformed = malformedQuery === queryName
        && !malformedQueriesInjected.has(queryName);
      if (shouldInjectMalformed) malformedQueriesInjected.add(queryName);
      return { data: shouldInjectMalformed ? malformedData : resultRows, error: null };
    },
    from(table) {
      assert.ok(columns[table], `unexpected table ${table}`);
      const queryName = queryNameForTable(table);
      let selected = [...rows[table]];
      let range = null;
      const orderSpecs = [];
      const query = {
        select(fields) {
          for (const field of fields.split(',')) {
            if (field === 'messenger_message_attachments(sort_order)') continue;
            assert.ok(columns[table].includes(field), `${table}.${field} does not exist in production schema`);
          }
          return query;
        },
        eq(field, value) {
          selected = selected.filter((row) => row[field] === value);
          calls.push({ table, method: 'eq', field, value });
          return query;
        },
        is(field, value) {
          selected = selected.filter((row) => row[field] === value);
          calls.push({ table, method: 'is', field, value });
          return query;
        },
        in(field, values) {
          if (field !== 'context_kind') assert.ok(values.length <= 100);
          selected = selected.filter((row) => values.includes(row[field]));
          calls.push({ table, method: 'in', field, size: values.length });
          return query;
        },
        overlaps(field, values) {
          assert.ok(values.length <= 100);
          selected = selected.filter((row) =>
            Array.isArray(row[field]) && row[field].some((id) => values.includes(id))
          );
          calls.push({ table, method: 'overlaps', size: values.length });
          return query;
        },
        or(expression) {
          assert.equal(
            expression,
            `sender_id.eq.${session.residentDigits},receiver_id.eq.${session.residentDigits}`,
          );
          calls.push({ table, method: 'or', expression });
          return query;
        },
        order(field, options = {}) {
          assert.ok(columns[table].includes(field));
          orderSpecs.push({ field, ascending: options.ascending !== false });
          calls.push({ table, method: 'order', field, ascending: options.ascending !== false });
          return query;
        },
        range(from, to) {
          range = { from, to };
          calls.push({ table, method: 'range', from, to });
          return query;
        },
        then(resolve, reject) {
          const error = queryError
            && queryName === queryErrorName
            && !queryErrorsInjected.has(queryName)
            ? queryError
            : null;
          if (error) queryErrorsInjected.add(queryName);

          selected.sort((left, right) => {
            for (const { field, ascending } of orderSpecs) {
              const leftValue = left[field];
              const rightValue = right[field];
              if (leftValue === rightValue) continue;
              const result = String(leftValue).localeCompare(String(rightValue));
              return ascending ? result : -result;
            }
            return 0;
          });
          let resultRows = range
            ? selected.slice(range.from, range.to + 1)
            : selected;
          if (mutateRow
            && mutateRow.queryName === queryName
            && resultRows.length > 0
            && !mutatedQueries.has(queryName)
          ) {
            mutatedQueries.add(queryName);
            resultRows = [mutateRow.apply(resultRows[0]), ...resultRows.slice(1)];
          }
          const shouldInjectMalformed = malformedQuery === queryName
            && !malformedQueriesInjected.has(queryName);
          if (shouldInjectMalformed) malformedQueriesInjected.add(queryName);
          const data = error
            ? null
            : shouldInjectMalformed
              ? malformedData
              : resultRows;
          return Promise.resolve({ data, error }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const code = ts.transpileModule(
    readFileSync(new URL('../app/api/admin/chat-list/route.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    require: (id) => {
      if (id === 'next/server') {
        return {
          NextResponse: {
            json: (body, options) => ({ status: options?.status ?? 200, body }),
          },
        };
      }
      if (id === '@/lib/admin-chat-targets') return targets;
      if (id === '@/lib/admin-supabase') return { adminSupabase };
      if (id === '@/lib/supabase-query-contract') return queryContract;
      if (id === '@/lib/api-error') {
        return {
          serverError: (error, label) => {
            loggerCalls.push([`[${label}] internal error`, error]);
            return { status: 500, body: { error: '요청 처리에 실패했습니다.' } };
          },
        };
      }
      if (id === '@/lib/server-session') {
        return {
          getVerifiedReadOnlyAdminSession: async () => denied
            ? { ok: false, status: 401, error: 'Unauthorized' }
            : { ok: true, session: { ...session, role, staffType } },
        };
      }
      throw new Error(`Unexpected dependency ${id}`);
    },
  });
  return { GET: exports.GET, calls, loggerCalls };
}

for (const [role, staffType] of [['admin', 'admin'], ['admin', 'developer'], ['manager', null]]) {
  test(`chat-list ${role}/${staffType} uses strict batches and the canonical actor`, async () => {
    const h = fixture({ role, staffType });
    const response = await h.GET();
    assert.equal(response.status, 200);
    assert.equal(response.body.length, 205);
    for (const item of response.body) {
      assert.equal(item.last_message, '첨부파일');
      assert.equal(item.unread_count, 1);
      assert.equal(item.conversation_id, `own-${item.fc_id.slice(3)}`);
    }
    assert.equal(h.calls.filter((call) => call.method === 'rpc').length, 3);
    const actorFilters = h.calls.filter((call) =>
      call.table === 'garamin_direct_threads' && call.field === 'counterparty_actor_id'
    );
    assert.ok(actorFilters.length >= 3);
    assert.ok(actorFilters.every((call) => call.value === session.accountId));
    assert.ok(h.calls
      .filter((call) => ['in', 'overlaps'].includes(call.method) && call.field !== 'context_kind')
      .every((call) => call.size <= 100));
  });
}

test('chat-list authentication rejection performs no privileged queries', async () => {
  const h = fixture({ denied: true });
  assert.equal((await h.GET()).status, 401);
  assert.equal(h.calls.length, 0);
});

test('chat-list logs query detail without exposing it to the browser', async () => {
  const queryError = new Error('private table and path detail');
  const h = fixture({ queryError });
  const response = await h.GET();

  assert.equal(response.status, 500);
  assert.equal(JSON.stringify(response.body), JSON.stringify({ error: '요청 처리에 실패했습니다.' }));
  assert.equal(JSON.stringify(response.body).includes(queryError.message), false);
  assert.equal(h.loggerCalls.length, 1);
  assert.equal(h.loggerCalls[0][1], queryError);
});

test('chat-list paginates participants and requests bounded deterministic summary batches', async () => {
  const messages = [
    ...Array.from({ length: 501 }, (_, index) => ({
      id: `newer-${String(index).padStart(4, '0')}`,
      sender_id: '01000000000',
      receiver_id: session.residentDigits,
      content: `newer ${index}`,
      created_at: `2026-01-02T00:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}Z`,
      is_read: false,
      deleted_at: null,
    })),
    {
      id: 'older-other-counterparty',
      sender_id: session.residentDigits,
      receiver_id: '01000000001',
      content: 'older but still the latest for this FC',
      created_at: '2026-01-01T00:00:00Z',
      is_read: true,
      deleted_at: null,
    },
  ];
  const h = fixture({ profileCount: 501, messageRows: messages });
  const response = await h.GET();

  assert.equal(response.status, 200);
  assert.equal(response.body.length, 501);
  assert.equal(response.body.find((item) => item.fc_id === 'fc-0').unread_count, 501);
  assert.equal(
    response.body.find((item) => item.fc_id === 'fc-1').last_message,
    'older but still the latest for this FC',
  );
  const participantRanges = h.calls.filter((call) =>
    call.table === 'fc_profiles' && call.method === 'range'
  );
  assert.deepStrictEqual(participantRanges.map(({ from, to }) => [from, to]), [[0, 499], [500, 999]]);
  assert.deepStrictEqual(h.calls.filter((call) => call.method === 'rpc').map((call) => call.size), [100, 100, 100, 100, 100, 1]);
  assert.equal(h.calls.some((call) => call.table === 'messages'), false);
  assert.equal(h.calls.some((call) => call.table === 'messenger_attachment_delivery_batches'), false);
});

test('chat-list rejects null and non-array successful rows at every list boundary', async () => {
  for (const malformedQuery of ['participants', 'summaries', 'conversations', 'threads']) {
    for (const malformedData of [null, { unexpected: true }]) {
      const h = fixture({ malformedQuery, malformedData });
      const response = await h.GET();

      assert.equal(response.status, 500, `${malformedQuery} must reject ${JSON.stringify(malformedData)}`);
      assert.equal(JSON.stringify(response.body), JSON.stringify({ error: '요청 처리에 실패했습니다.' }));
      assert.equal(h.loggerCalls.length, 1);
      assert.match(String(h.loggerCalls[0][1]?.message), /_contract_invalid$/);
    }
  }
});

test('chat-list rejects malformed rows instead of skipping or defaulting them', async () => {
  const malformedRows = [
    {
      queryName: 'participants',
      apply: (row) => ({ ...row, name: null }),
    },
    {
      queryName: 'summaries',
      apply: (row) => ({ ...row, unread_count: null }),
    },
    {
      queryName: 'conversations',
      apply: (row) => ({ ...row, fc_id: null }),
    },
    {
      queryName: 'threads',
      apply: (row) => ({ ...row, legacy_conversation_id: null }),
    },
  ];

  for (const mutateRow of malformedRows) {
    const h = fixture({ mutateRow });
    const response = await h.GET();

    assert.equal(response.status, 500, `${mutateRow.queryName} must reject a malformed row`);
    assert.equal(h.loggerCalls.length, 1);
    assert.match(String(h.loggerCalls[0][1]?.message), /_contract_invalid$/);
  }
});

test('chat-list rejects malformed summaries and out-of-scope relation ids', async () => {
  const mutations = [
    { queryName: 'summaries', apply: (row) => ({ ...row, target_id: 'outside-request' }) },
    { queryName: 'conversations', apply: (row) => ({ ...row, fc_id: 'outside-fc' }) },
    { queryName: 'threads', apply: (row) => ({ ...row, legacy_conversation_id: 'outside-conversation' }) },
  ];

  for (const mutateRow of mutations) {
    const h = fixture({ mutateRow });
    const response = await h.GET();

    assert.equal(response.status, 500, `${mutateRow.queryName} must stay request-bound`);
    assert.equal(h.loggerCalls.length, 1);
    assert.match(String(h.loggerCalls[0][1]?.message), /_contract_invalid$/);
  }
});

test('chat-list rejects duplicate summary identities returned by the RPC', async () => {
  const h = fixture({
    mutateRow: { queryName: 'summaries', apply: (row) => ({ ...row, target_id: '01000000001' }) },
  });
  const response = await h.GET();

  assert.equal(response.status, 500);
  assert.equal(h.loggerCalls.length, 1);
  assert.match(
    String(h.loggerCalls[0][1]?.message),
    /admin_chat_summary_relation_contract_invalid/,
  );
});
