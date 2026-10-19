import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import * as userIntentPolicy from './user-intent-policy.ts';
import { createChatRequestGuard } from './chat-request-guard.ts';
import { QueryReadError } from './query-read-error.ts';
import * as queryContract from './supabase-query-contract.ts';
import * as messengerMessageContract from './messenger-message-contract.ts';
import * as presenceReadResponse from '../../../lib/presence-read-response.ts';
import * as presenceQueryContract from '../../../supabase/functions/_shared/presence-query-contract.ts';
import * as brandColors from './brand-colors.ts';

const require = createRequire(new URL('../../../package.json', import.meta.url));
const webRequire = createRequire(import.meta.url);
const React = require('react');
const { act, create } = require('react-test-renderer');
const ts = require('typescript');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const ui = new Proxy({}, { get: (_, key) => String(key) });
const target = (id, conversation = null) => ({
  fc_id: id,
  phone: `synthetic-${id}`,
  name: id,
  conversation_id: conversation,
  last_message: null,
  last_time: null,
  unread_count: 0,
});
const message = (id, conversationId = 'synthetic-conversation') => ({
  id,
  conversation_id: conversationId,
  sender_id: 'synthetic-admin',
  receiver_id: 'synthetic-A',
  content: id,
  created_at: '2026-01-01T00:00:00Z',
  is_read: false,
  message_type: 'text',
  file_url: null,
  file_name: null,
  file_size: null,
  attachments: [],
});

function harness(route = 'dashboard/chat', role = 'admin') {
  let session = { role, residentId: role === 'fc' ? '00000000001' : 'synthetic-admin', staffType: 'developer', hydrated: true, isReadOnly: role === 'manager' };
  let params = new URLSearchParams('targetId=00000000002');
  const requests = [];
  const notices = [];
  const intervals = new Map();
  let timer = 0;
  const refetch = () => {};
  let chatList = [target("A"), target("B", "room-B")];
  let chatListQueryFn;
  let chatListResponse = { payload: chatList, status: 200 };
  const mocks = {
    '@/lib/user-intent-policy': userIntentPolicy,
    '@/hooks/use-session': { useSession: () => session },
    'next/navigation': { useSearchParams: () => params, useRouter: () => ({ replace() {}, back() {} }) },
    '@tanstack/react-query': { useQuery: (options) => {
      if (options.queryKey?.[0] === 'admin-chat-list') chatListQueryFn = options.queryFn;
      return { data: chatList, refetch };
    } },
    '@/lib/chat-request-guard': { createChatRequestGuard },
    '@/lib/staff-identity': { getWebStaffChatActorId: () => session.residentId },
    '@/lib/presence-api': { fetchPresence: async () => [] },
    '@/lib/query-read-error': { QueryReadError },
    '@/lib/presence': { normalizePresencePhone: () => '', formatPresenceLabel: () => '', getPresenceColor: () => '' },
    '@/lib/admin-chat-url': { buildAdminDashboardChatUrl: () => '/dashboard/chat' },
    '@/components/QueryErrorAlert': { QueryErrorAlert: () => null },
    '@/components/NotificationDestinationReady': { NotificationDestinationReady: () => null },
    '@/components/MessengerAttachments': { MessengerAttachmentPicker: () => null, MessengerAttachmentList: () => null },
    '@/lib/messenger-attachment-client': {},
    '@/lib/messenger-attachment-commit': {},
    '@/lib/messenger-message-contract': messengerMessageContract,
    '@/lib/message-read-receipts': { formatUnreadReceiptCount: () => '', getDirectMessageUnreadCount: () => 0 },
    '@/lib/notification-delivery-feedback': { parseNotificationDeliveryFeedback: () => null },
    '@mantine/notifications': { notifications: { show: (notice) => notices.push(notice) } },
  };
  const code = ts.transpileModule(readFileSync(new URL(`../app/${route}/page.tsx`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports, require: (id) => {
      if (id in mocks) return mocks[id];
      if (id.endsWith('.module.css')) return { default: {} };
      if (id === 'dayjs') return webRequire(id);
      if (id === 'react' || id === 'react/jsx-runtime') return require(id);
      if (id === '@mantine/core' || id === '@tabler/icons-react') return ui;
      if (id === '@/lib/admin-chat-targets') return {};
      if (id === '@/lib/brand-colors') return brandColors;
      throw new Error(`Missing mock: ${id}`);
    },
    fetch: (url, options) => url === '/api/admin/chat-list'
      ? Promise.resolve({
          ok: chatListResponse.status >= 200 && chatListResponse.status < 300,
          status: chatListResponse.status,
          json: async () => chatListResponse.payload,
        })
      : new Promise((resolve, reject) => {
      requests.push({ ...JSON.parse(options.body), signal: options.signal, resolve: (data, status = 200) => resolve({ ok: status === 200, json: async () => data }), reject });
    }),
    AbortController, crypto: { randomUUID: () => `local-${++timer}` }, console,
    setTimeout: () => 0, requestAnimationFrame: () => 0,
    window: { setTimeout: () => 0, clearTimeout() {}, setInterval: (fn) => { const id = ++timer; intervals.set(id, fn); return id; }, clearInterval: (id) => intervals.delete(id), addEventListener() {}, removeEventListener() {} },
    document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
  });
  let renderer;
  return {
    requests, notices,
    async mount() { await act(async () => { renderer = create(React.createElement(exports.default)); }); },
    async select(name) { await act(async () => { renderer.root.findAllByType('Box').find((node) => node.props.onClick && node.findAllByType('Text').some((text) => text.props.children === name)).props.onClick(); }); },
    async resolve(type, data, status = 200) { const pending = requests.find((r) => r.type === type && !r.done); assert.ok(pending, type); pending.done = true; await act(async () => pending.resolve(data, status)); return pending; },
    async fail(type) { const pending = requests.find((r) => r.type === type && !r.done); assert.ok(pending, type); pending.done = true; await act(async () => pending.reject(new Error('synthetic-network-failure'))); },
    async send(text) { await act(async () => renderer.root.findByType('Textarea').props.onChange({ currentTarget: { value: text } })); await act(async () => { void renderer.root.findAllByType('ActionIcon').find((node) => node.findAllByType('IconSend').length).props.onClick(); }); },
    async resend() { await act(async () => { void renderer.root.findAllByType('ActionIcon').find((node) => node.findAllByType('IconSend').length).props.onClick(); }); },
    async key(text, event) { await act(async () => renderer.root.findByType('Textarea').props.onChange({ currentTarget: { value: text } })); await act(async () => renderer.root.findByType('Textarea').props.onKeyDown(event)); },
    async poll() { await act(async () => { for (const fn of intervals.values()) fn(); }); },
    async account(id) { session = { ...session, residentId: id }; await act(async () => renderer.update(React.createElement(exports.default))); },
    async conversation(id, conversationId) { chatList = chatList.map((row) => row.fc_id === id ? { ...row, conversation_id: conversationId } : row); await act(async () => renderer.update(React.createElement(exports.default))); },
    async room(id) { params = new URLSearchParams(`targetId=${id}`); await act(async () => renderer.update(React.createElement(exports.default))); },
    async readChatList(payload, status = 200) {
      chatListResponse = { payload, status };
      assert.equal(typeof chatListQueryFn, 'function');
      return chatListQueryFn();
    },
    texts() { return renderer.root.findAllByType('Text').map((node) => node.props.children); },
    input() { return renderer.root.findByType('Textarea').props.value; },
    async close() { await act(async () => renderer.unmount()); },
  };
}

function presenceFetcher(fetchImpl) {
  const code = ts.transpileModule(readFileSync(new URL('./presence-api.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    require: (id) => {
      if (id === '@/lib/logger') return { logger: { warn() {} } };
      if (id === '@/lib/query-read-error') return { QueryReadError };
      if (id === '@shared/lib/presence-read-response.ts') return presenceReadResponse;
      if (id === '@shared/supabase/functions/_shared/presence-query-contract.ts') {
        return presenceQueryContract;
      }
      throw new Error(`Missing presence mock: ${id}`);
    },
    fetch: fetchImpl,
  });
  return exports.fetchPresence;
}

function presenceRouteHarness({
  role = 'admin',
  malformedQuery = null,
  malformedData = null,
  rpcMissing = false,
  requestBody,
} = {}) {
  const currentPhone = '01011112222';
  const loggerCalls = [];
  const rows = {
    fc_profiles: [{ phone: currentPhone, signup_completed: true }],
    manager_accounts: [{ phone: currentPhone, active: true }],
    admin_accounts: [{ phone: currentPhone, active: true }],
    user_presence: [{
      phone: currentPhone,
      garam_in_at: null,
      garam_link_at: null,
      updated_at: null,
    }],
  };
  const queryNames = {
    fc_profiles: 'scope_fcs',
    manager_accounts: 'scope_managers',
    admin_accounts: 'scope_admins',
    user_presence: 'fallback',
  };
  const adminSupabase = {
    rpc: async () => {
      if (rpcMissing) {
        return {
          data: null,
          error: {
            code: 'PGRST202',
            message: 'Could not find the function public.get_user_presence',
          },
        };
      }
      return {
        data: malformedQuery === 'rpc'
          ? malformedData
          : [{
              phone: currentPhone,
              garam_in_at: null,
              garam_link_at: null,
              last_seen_at: null,
              is_online: false,
              updated_at: null,
            }],
        error: null,
      };
    },
    from(table) {
      let selected = [...rows[table]];
      const query = {
        select() { return query; },
        eq(field, value) {
          selected = selected.filter((row) => row[field] === value);
          return query;
        },
        in(field, values) {
          selected = selected.filter((row) => values.includes(row[field]));
          return query;
        },
        then(resolve) {
          const data = malformedQuery === queryNames[table] ? malformedData : selected;
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return query;
    },
  };
  const code = ts.transpileModule(readFileSync(new URL('../app/api/presence/route.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    require: (id) => {
      if (id === 'next/server') return { NextResponse: { json: (body, options) => ({ status: options?.status ?? 200, body }) } };
      if (id === '@/lib/admin-supabase') return { adminSupabase };
      if (id === '@/lib/csrf') return { checkRateLimit: () => ({ allowed: true }), SECURITY_HEADERS: {}, verifyOrigin: async () => ({ valid: true }) };
      if (id === '@/lib/server-session') return { getVerifiedServerSession: async () => ({ ok: true, session: { role, residentId: currentPhone } }) };
      if (id === '@/lib/supabase-query-contract') return queryContract;
      if (id === '@shared/supabase/functions/_shared/presence-query-contract.ts') {
        return presenceQueryContract;
      }
      if (id === '@/lib/api-error') {
        return {
          serverError: (error, label) => {
            loggerCalls.push([`[${label}] internal error`, error]);
            return { status: 500, body: { error: '요청 처리에 실패했습니다.' } };
          },
        };
      }
      throw new Error(`Missing presence route mock: ${id}`);
    },
  });
  return {
    loggerCalls,
    request: () => exports.POST(new Request('https://example.invalid/api/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody === undefined ? { phones: [currentPhone] } : requestBody),
    })),
  };
}

test('room switch discards old resolve, never lists or sends to the old conversation', async () => {
  const h = harness(); await h.mount(); await h.select('A'); await h.select('B');
  const old = await h.resolve('resolve_garamin_direct_conversation', { ok: true, data: { conversation: { id: 'room-A' } } });
  assert.equal(old.signal.aborted, true);
  assert.equal(h.requests.some((r) => r.type === 'direct_message_list' && r.conversation_id === 'room-A'), false);
  await h.send('new room');
  assert.equal(h.requests.find((r) => r.type === 'direct_message_send').conversation_id, 'room-B');
  await h.close();
});

test('account switch aborts the old list and prevents late read marks', async () => {
  const h = harness(); await h.mount(); await h.select('B'); await h.account('second-account');
  const old = await h.resolve('direct_message_list', { ok: true, data: { messages: [message('old-account')] } });
  assert.equal(old.signal.aborted, true); assert.equal(h.texts().includes('old-account'), false);
  assert.equal(h.requests.some((r) => r.type === 'direct_message_mark_read'), false);
  await h.close();
});

test('late poll cannot remove an optimistic or acknowledged send; switched-room send does not update new room', async () => {
  const h = harness(); await h.mount(); await h.select('B');
  await h.send('optimistic');
  await h.resolve('direct_message_list', { ok: true, data: { messages: [] } });
  assert.equal(h.texts().includes('optimistic'), true);
  await h.poll();
  await h.resolve('direct_message_send', { ok: true, data: { message: { ...message('ack', 'room-B'), content: 'optimistic' } } });
  await h.resolve('direct_message_list', { ok: true, data: { messages: [] } });
  assert.equal(h.texts().includes('optimistic'), true);
  await h.send('late-send'); await h.select('A');
  await h.resolve('direct_message_send', { ok: true, data: { message: message('old-ack') } });
  assert.equal(h.texts().includes('old-ack'), false); await h.close();
});

test('read failures are caught and visibly recoverable; manager does not mark read', async () => {
  const h = harness('dashboard/chat', 'manager'); await h.mount(); await h.select('B');
  await h.resolve('direct_message_list', { ok: false }, 503);
  assert.ok(h.texts().some((text) => typeof text === 'string' && text.includes('다시 시도')));
  await h.poll(); await h.resolve('direct_message_list', { ok: true, data: { messages: [message('recovered', 'room-B')] } });
  assert.equal(h.texts().includes('recovered'), true);
  assert.equal(h.requests.some((r) => r.type === 'direct_message_mark_read'), false); await h.close();
});

test('malformed direct message rows preserve stale messages and show a recoverable load error', async () => {
  const h = harness('dashboard/chat', 'admin');
  await h.mount();
  await h.select('B');
  await h.resolve('direct_message_list', { ok: true, data: { messages: [message('stable', 'room-B')] } });
  assert.equal(h.texts().includes('stable'), true);

  await h.poll();
  await h.resolve('direct_message_list', {
    ok: true,
    data: { messages: [{ ...message('unsafe', 'room-B'), file_url: 'javascript:alert(1)' }] },
  });
  assert.equal(h.texts().includes('stable'), true);
  assert.equal(h.texts().includes('unsafe'), false);
  assert.ok(h.texts().some((text) => typeof text === 'string' && text.includes('다시 시도')));
  await h.close();
});

test('FC route discards a slow resolve after target changes', async () => {
  const h = harness('chat', 'fc'); await h.mount(); await h.room('00000000003');
  const old = await h.resolve('resolve_garamin_direct_conversation', { ok: true, data: { conversation: { id: 'old-room' } } });
  assert.equal(old.signal.aborted, true);
  assert.equal(h.requests.some((r) => r.type === 'direct_message_list'), false); await h.close();
});

test('dashboard coalesces concurrent resolves and blocks duplicate sends while resolving', async () => {
  const h = harness(); await h.mount(); await h.select('A');
  await h.poll(); await h.send('one send'); await h.send('duplicate');
  assert.equal(h.requests.filter((r) => r.type === 'resolve_garamin_direct_conversation').length, 1);
  await h.resolve('resolve_garamin_direct_conversation', { ok: true, data: { conversation: { id: 'room-A' } } });
  const sends = h.requests.filter((r) => r.type === 'direct_message_send');
  assert.equal(sends.length, 1); assert.equal(sends[0].content, 'one send'); await h.close();
});

test('FC send waiting on resolve cannot send after target switch; repeated resolve is coalesced', async () => {
  const h = harness('chat', 'fc'); await h.mount(); await h.poll(); await h.send('old draft');
  assert.equal(h.requests.filter((r) => r.type === 'resolve_garamin_direct_conversation').length, 1);
  await h.room('00000000003');
  await h.resolve('resolve_garamin_direct_conversation', { ok: true, data: { conversation: { id: 'old-room' } } });
  assert.equal(h.requests.some((r) => r.type === 'direct_message_send'), false);
  assert.equal(h.notices.length, 0); await h.close();
});

test('resolving a conversation on the same FC does not remount or lose the in-flight send', async () => {
  const h = harness(); await h.mount(); await h.select('A'); await h.send('keep this send');
  await h.resolve('resolve_garamin_direct_conversation', { ok: true, data: { conversation: { id: 'room-A' } } });
  await h.conversation('A', 'room-A'); await h.select('A');
  assert.equal(h.texts().includes('keep this send'), true);
  await h.resolve('direct_message_send', { ok: true, data: { message: { ...message('same-room-ack', 'room-a'), content: 'keep this send' } } });
  assert.equal(h.texts().includes('keep this send'), true); await h.close();
});

test('list sequence and revision guard reject out-of-order and pre-mutation snapshots', () => {
  const guard = createChatRequestGuard(); guard.activate();
  const old = guard.beginList(); const latest = guard.beginList();
  assert.equal(guard.canApplyList(old), false); assert.equal(guard.canApplyList(latest), true);
  guard.changed(); assert.equal(guard.canApplyList(latest), false);
  const mutation = guard.snapshot(); guard.dispose(); guard.activate();
  assert.equal(guard.isCurrent(mutation), false);
});

test('dashboard chat list rejects a malformed successful response instead of showing an empty list', async () => {
  const h = harness();
  await h.mount();
  await assert.rejects(h.readChatList({ error: 'private detail' }, 503), (error) => error instanceof QueryReadError && error.status === 503);
  await assert.rejects(h.readChatList({ ok: true }), (error) => error instanceof QueryReadError && error.status === undefined);
  await assert.rejects(h.readChatList([{}]), (error) => error instanceof QueryReadError && error.status === undefined);
  assert.deepEqual(await h.readChatList([]), []);
  assert.deepEqual(await h.readChatList([target('valid')]), [target('valid')]);
  await h.close();
});

test('presence reads reject transport and malformed success responses while accepting valid snapshots', async () => {
  const valid = {
    phone: '01011112222',
    garam_in_at: null,
    garam_link_at: null,
    last_seen_at: null,
    is_online: false,
    updated_at: null,
  };
  const success = presenceFetcher(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, data: [valid] }),
  }));
  assert.deepEqual(await success(['010-1111-2222']), [valid]);

  const malformed = presenceFetcher(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, data: [{ phone: valid.phone }] }),
  }));
  await assert.rejects(malformed([valid.phone]), (error) => error instanceof QueryReadError && error.status === undefined);

  const failed = presenceFetcher(async () => ({
    ok: false,
    status: 503,
    json: async () => ({ ok: false }),
  }));
  await assert.rejects(failed([valid.phone]), (error) => error instanceof QueryReadError && error.status === 503);
});

test('presence reads request every phone in bounded batches and merge the validated responses', async () => {
  const requestedBatches = [];
  const fetchAll = presenceFetcher(async (_url, options) => {
    const { phones } = JSON.parse(options.body);
    requestedBatches.push(phones);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        data: phones.map((phone) => ({
          phone,
          garam_in_at: null,
          garam_link_at: null,
          last_seen_at: null,
          is_online: false,
          updated_at: null,
        })),
      }),
    };
  });
  const phones = Array.from({ length: 201 }, (_, index) => `010${String(index).padStart(8, '0')}`);

  const rows = await fetchAll(phones);

  assert.deepEqual(requestedBatches.map((batch) => batch.length), [100, 100, 1]);
  assert.deepEqual(rows.map((row) => row.phone), phones);
});

test('presence route rejects null and non-array successful Supabase rows at every list boundary', async () => {
  const boundaries = [
    { malformedQuery: 'scope_managers', role: 'fc' },
    { malformedQuery: 'scope_admins', role: 'fc' },
    { malformedQuery: 'scope_fcs', role: 'admin' },
    { malformedQuery: 'scope_managers', role: 'admin' },
    { malformedQuery: 'scope_admins', role: 'admin' },
    { malformedQuery: 'rpc', role: 'admin' },
    { malformedQuery: 'fallback', role: 'admin', rpcMissing: true },
  ];

  for (const boundary of boundaries) {
    for (const malformedData of [null, { unexpected: true }]) {
      const h = presenceRouteHarness({ ...boundary, malformedData });
      const response = await h.request();

      assert.equal(response.status, 500, `${boundary.role}/${boundary.malformedQuery} must reject ${JSON.stringify(malformedData)}`);
      assert.equal(JSON.stringify(response.body), JSON.stringify({ error: '요청 처리에 실패했습니다.' }));
      assert.equal(h.loggerCalls.length, 1);
      assert.match(String(h.loggerCalls[0][1]?.message), /_(?:row|query)_contract_invalid$/);
    }
  }
});

test('presence route returns the canonical 400 response for malformed parsed request bodies', async () => {
  for (const requestBody of [null, 'not-an-object', {}, { phones: '01011112222' }, { phones: [42] }]) {
    const h = presenceRouteHarness({ requestBody });
    const response = await h.request();

    assert.equal(response.status, 400, `must reject ${JSON.stringify(requestBody)}`);
    assert.equal(JSON.stringify(response.body), JSON.stringify({ ok: false, message: 'Invalid JSON payload' }));
    assert.equal(h.loggerCalls.length, 0);
  }
});


test('dashboard Korean IME completion keeps the draft and does not send', async () => {
  const h = harness(); await h.mount(); await h.select('B');
  await h.key('한글', { key: 'Enter', shiftKey: false, nativeEvent: { isComposing: true }, preventDefault() { throw new Error('must not consume composition'); } });
  assert.equal(h.requests.some((row) => row.type === 'direct_message_send'), false);
  await h.key('한글', { key: 'Enter', shiftKey: false, nativeEvent: { keyCode: 229 }, preventDefault() { throw new Error('must not consume composition'); } });
  assert.equal(h.requests.some((row) => row.type === 'direct_message_send'), false);
  await h.close();
});

test('C05: dashboard Shift+Enter keeps the draft; explicit Enter sends exactly once', async () => {
  const h = harness(); await h.mount(); await h.select('B');
  let prevents = 0;
  await h.key('한글 본문', { key: 'Enter', shiftKey: true, nativeEvent: {}, preventDefault() { prevents++; } });
  assert.equal(h.requests.some((row) => row.type === 'direct_message_send'), false); assert.equal(h.input(), '한글 본문');
  await h.key('한글 본문', { key: 'Enter', shiftKey: false, nativeEvent: {}, preventDefault() { prevents++; } });
  assert.equal(h.requests.filter((row) => row.type === 'direct_message_send').length, 1); assert.equal(prevents, 1);
  await h.close();
});

test('C06/D06: network and malformed 200 send responses restore the original draft and retry key', async () => {
  for (const malformed of [false, true]) {
    const h = harness(); await h.mount(); await h.select('B'); await h.send('보존할 본문');
    const sent = h.requests.find((row) => row.type === 'direct_message_send');
    assert.equal(h.input(), '');
    if (malformed) await h.resolve('direct_message_send', { ok: true }); else await h.fail('direct_message_send');
    assert.equal(h.input(), '보존할 본문'); assert.equal(h.notices.at(-1).title, '전송 실패');
    await h.resend();
    const second = h.requests.filter((row) => row.type === 'direct_message_send')[1];
    assert.equal(second.client_message_id, sent.client_message_id);
    await h.close();
  }
});
