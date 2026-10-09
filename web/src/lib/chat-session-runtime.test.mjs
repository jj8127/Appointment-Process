import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import * as userIntentPolicy from './user-intent-policy.ts';
import { createChatRequestGuard } from './chat-request-guard.ts';

const require = createRequire(new URL('../../../package.json', import.meta.url));
const webRequire = createRequire(import.meta.url);
const React = require('react');
const { act, create } = require('react-test-renderer');
const ts = require('typescript');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const ui = new Proxy({}, { get: (_, key) => String(key) });
const target = (id, conversation = null) => ({ fc_id: id, phone: `synthetic-${id}`, name: id, conversation_id: conversation, unread_count: 0 });
const message = (id) => ({ id, sender_id: 'synthetic-admin', receiver_id: 'synthetic-A', content: id, created_at: '2026-01-01T00:00:00Z', is_read: false, message_type: 'text' });

function harness(route = 'dashboard/chat', role = 'admin') {
  let session = { role, residentId: role === 'fc' ? '00000000001' : 'synthetic-admin', staffType: 'developer', hydrated: true, isReadOnly: role === 'manager' };
  let params = new URLSearchParams('targetId=00000000002');
  const requests = [];
  const notices = [];
  const intervals = new Map();
  let timer = 0;
  const refetch = () => {};
  let chatList = [target("A"), target("B", "room-B")];
  const mocks = {
    '@/lib/user-intent-policy': userIntentPolicy,
    '@/hooks/use-session': { useSession: () => session },
    'next/navigation': { useSearchParams: () => params, useRouter: () => ({ replace() {}, back() {} }) },
    '@tanstack/react-query': { useQuery: () => ({ data: chatList, refetch }) },
    '@/lib/chat-request-guard': { createChatRequestGuard },
    '@/lib/staff-identity': { getWebStaffChatActorId: () => session.residentId },
    '@/lib/presence-api': { fetchPresence: async () => [] },
    '@/lib/presence': { normalizePresencePhone: () => '', formatPresenceLabel: () => '', getPresenceColor: () => '' },
    '@/lib/admin-chat-url': { buildAdminDashboardChatUrl: () => '/dashboard/chat' },
    '@/components/NotificationDestinationReady': { NotificationDestinationReady: () => null },
    '@/components/MessengerAttachments': { MessengerAttachmentPicker: () => null, MessengerAttachmentList: () => null },
    '@/lib/messenger-attachment-client': {},
    '@/lib/messenger-attachment-commit': {},
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
      if (id === 'dayjs') return webRequire(id);
      if (id === 'react' || id === 'react/jsx-runtime') return require(id);
      if (id === '@mantine/core' || id === '@tabler/icons-react') return ui;
      if (id === '@/lib/admin-chat-targets') return {};
      throw new Error(`Missing mock: ${id}`);
    },
    fetch: (url, options) => new Promise((resolve, reject) => {
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
    async send(text) { await act(async () => renderer.root.findByType('Textarea').props.onChange({ currentTarget: { value: text } })); await act(async () => { void renderer.root.findAllByType('ActionIcon').find((node) => node.findAllByType('IconSend').length).props.onClick(); }); },
    async key(text, event) { await act(async () => renderer.root.findByType('Textarea').props.onChange({ currentTarget: { value: text } })); await act(async () => renderer.root.findByType('Textarea').props.onKeyDown(event)); },
    async poll() { await act(async () => { for (const fn of intervals.values()) fn(); }); },
    async account(id) { session = { ...session, residentId: id }; await act(async () => renderer.update(React.createElement(exports.default))); },
    async conversation(id, conversationId) { chatList = chatList.map((row) => row.fc_id === id ? { ...row, conversation_id: conversationId } : row); await act(async () => renderer.update(React.createElement(exports.default))); },
    async room(id) { params = new URLSearchParams(`targetId=${id}`); await act(async () => renderer.update(React.createElement(exports.default))); },
    texts() { return renderer.root.findAllByType('Text').map((node) => node.props.children); },
    async close() { await act(async () => renderer.unmount()); },
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
  await h.resolve('direct_message_send', { ok: true, data: { message: { ...message('ack'), content: 'optimistic' } } });
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
  await h.poll(); await h.resolve('direct_message_list', { ok: true, data: { messages: [message('recovered')] } });
  assert.equal(h.texts().includes('recovered'), true);
  assert.equal(h.requests.some((r) => r.type === 'direct_message_mark_read'), false); await h.close();
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
  await h.resolve('direct_message_send', { ok: true, data: { message: { ...message('same-room-ack'), content: 'keep this send' } } });
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


test('dashboard Korean IME completion keeps the draft and does not send', async () => {
  const h = harness(); await h.mount(); await h.select('B');
  await h.key('한글', { key: 'Enter', shiftKey: false, nativeEvent: { isComposing: true }, preventDefault() { throw new Error('must not consume composition'); } });
  assert.equal(h.requests.some((row) => row.type === 'direct_message_send'), false);
  await h.key('한글', { key: 'Enter', shiftKey: false, nativeEvent: { keyCode: 229 }, preventDefault() { throw new Error('must not consume composition'); } });
  assert.equal(h.requests.some((row) => row.type === 'direct_message_send'), false);
  await h.close();
});
