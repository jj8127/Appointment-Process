import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import * as policy from './user-intent-policy.ts';
import * as readError from './query-read-error.ts';
import * as tempId from './admin-temp-id-update.ts';
import * as brandColors from './brand-colors.ts';

const require = createRequire(new URL('../../../package.json', import.meta.url));
const React = require('react');
const { act, create } = require('react-test-renderer');
const query = require('@tanstack/react-query');
const ts = require('typescript');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const components = new Map();
function component(name) {
  if (!components.has(name)) {
    const fn = ({ children, ...props }) => React.createElement(name, props, children);
    components.set(name, new Proxy(fn, { get: (target, key) => typeof key === 'string' && /^[A-Z]/.test(key) ? component(`${name}.${key}`) : Reflect.get(target, key) }));
  }
  return components.get(name);
}
const ui = new Proxy({}, { get: (_, key) => component(String(key)) });
const profile = (id) => ({ id, name: `Synthetic ${id}`, phone: `synthetic-${id}`, affiliation: 'Test', career_type: '신입', admin_memo: `stored ${id}`, status: 'draft', fc_documents: [] });

function harness() {
  let session = { hydrated: true, role: 'admin', residentId: 'synthetic-staff', isReadOnly: false };
  let owner = 'A'; const profiles = new Map([['A', profile('A')], ['B', profile('B')]]);
  let error = null; let referral = { ok: true, signupReferralCode: 'TEST-CODE' };
  const client = new query.QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  const requests = []; const notices = [];
  const mocks = {
    '@/lib/user-intent-policy': policy, '@/lib/query-read-error': readError, '@/lib/admin-temp-id-update': tempId,
    '@/types/referrals': { isRecommenderSelectionResult: (value) => Boolean(value && typeof value === 'object') },
    '@/lib/admin-document-client': { isAdminFcProfileDetail: (value) => Boolean(value && typeof value === 'object' && typeof value.id === 'string') },
    '@/components/QueryErrorAlert': { QueryErrorAlert: component('QueryErrorAlert') },
    '@/lib/presence-api': { fetchPresence: async () => [] }, '@/lib/presence': { formatPresenceLabel: () => '' },
    '@/lib/shared': { ADMIN_STEP_LABELS: { step0: '0단계', step1: '1단계' }, getAdminStepDisplay: () => ({ step: 1, label: 'Test', color: 'gray' }), getStatusDisplay: () => ({ label: 'Test', color: 'gray' }) },
    './page.module.css': { default: {} },
    '@/hooks/use-resident-number': { useResidentNumber: () => ({ residentNumberDisplay: 'synthetic', birthDateDisplay: '-' }) },
    '@/hooks/use-session': { useSession: () => session },
    '@/lib/show-admin-notification-warning': { showAdminNotificationWarning() {} },
    '@/components/RecommenderSelect': { RecommenderSelect: component('RecommenderSelect') },
    '@/components/ConfirmModal': { ConfirmModal: component('ConfirmModal') },
    '@/lib/fc-delete-client': { requestFcDelete: async () => ({ ok: true, deleted: true }), FC_DELETE_CLEANUP_WARNING: '' },
    '@/components/NotificationDestinationReady': { NotificationDestinationReady: () => null },
    '@mantine/notifications': { notifications: { show: (notice) => notices.push(notice) } },
    'next/link': { __esModule: true, default: () => null },
    'next/navigation': { useRouter: () => ({ back() {}, replace() {} }) },
    '@tanstack/react-query': { useMutation: query.useMutation, useQueryClient: () => client,
      useQuery: ({ queryKey, queryFn }) => {
        if (queryKey[0] === 'fc-profile') return { data: profiles.get(queryKey[1]), error, isLoading: false, refetch: queryFn };
        if (queryKey[0] === 'fc-signup-referral-code') return { data: 'TEST-CODE', isFetching: false, error: null, refetch: queryFn };
        return { data: null, isError: false };
      },
    },
    '@mantine/form': { useForm({ initialValues }) {
      const [values, setValues] = React.useState(initialValues); const dirty = React.useRef(false);
      return { values, setValues, resetDirty() { dirty.current = false; }, isDirty: () => dirty.current,
        getInputProps(field) { return { value: values[field], onChange: (event) => {
          const value = typeof event === 'string' ? event : event.currentTarget.value;
          dirty.current = true; setValues((previous) => ({ ...previous, [field]: value }));
        } }; },
      };
    } },
  };
  const code = ts.transpileModule(readFileSync(new URL('../app/dashboard/profile/[id]/page.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: (id) => {
    if (id in mocks) return mocks[id];
    if (id === 'react' || id === 'react/jsx-runtime') return require(id);
    if (id === '@/lib/brand-colors') return brandColors;
    if (id === '@mantine/core' || id === '@tabler/icons-react') return ui;
    if (id === 'dayjs') return createRequire(import.meta.url)(id);
    throw new Error(`Unmocked dependency: ${id}`);
  }, window: { confirm: () => false },
    fetch: (url, init) => {
      const body = JSON.parse(init.body);
      if (body.action === 'getInviteeReferralCode') return Promise.resolve({ ok: true, status: 200, json: async () => referral });
      return new Promise((resolve) => requests.push({ body, resolve: (payload) => resolve({ ok: true, json: async () => payload }) }));
    },
  });
  let renderer;
  const render = () => act(async () => {
    const params = { status: 'fulfilled', value: { id: owner }, then() {} };
    const element = React.createElement(query.QueryClientProvider, { client }, React.createElement(exports.default, { params }));
    if (renderer) renderer.update(element); else renderer = create(element);
  });
  const field = () => renderer.root.findAllByType('TextInput').find((node) => node.props.label === '이름');
  const button = (text) => renderer.root.findAllByType('Button').find((node) => node.props.children === text);
  return {
    render, requests, notices, field, button,
    memo: () => renderer.root.findByType('Textarea'),
    alerts: () => renderer.root.findAllByType('QueryErrorAlert'),
    async refresh(nextError = null) { profiles.set(owner, { ...profiles.get(owner), name: 'Server refreshed', admin_memo: 'server memo' }); error = nextError; await render(); },
    async switchOwner(id) { owner = id; error = null; await render(); },
    async account(id) { session = { ...session, residentId: id }; await render(); },
    async settle(index = 0) { await act(async () => { requests[index].resolve({ ok: true }); await new Promise((resolve) => setTimeout(resolve, 10)); }); },
    async referralResponse(value) { referral = value; const node = renderer.root.findAllByType('Button').find((item) => item.props.children === '다시 시도'); return node; },
    async close() { await act(async () => renderer.unmount()); client.clear(); },
  };
}

test('W01/C04: actual FC editor keeps independent basic and memo drafts through success and failed refetches', async () => {
  const h = harness(); await h.render();
  assert.equal(h.memo().props.value, 'stored A');
  await h.refresh(); assert.equal(h.memo().props.value, 'server memo');
  await act(async () => h.button('수정').props.onClick());
  await act(async () => h.field().props.onChange({ currentTarget: { value: 'typed basic draft' } }));
  await act(async () => h.memo().props.onChange({ currentTarget: { value: 'typed memo draft' } }));
  await h.refresh(); assert.equal(h.field().props.value, 'typed basic draft'); assert.equal(h.memo().props.value, 'typed memo draft');
  await h.refresh(new Error('synthetic-read-failure'));
  assert.equal(h.field().props.value, 'typed basic draft'); assert.equal(h.memo().props.value, 'typed memo draft'); assert.equal(h.alerts().length, 1);
  await h.close();
});

for (const accountChange of [false, true]) {
  test(`D08: delayed FC save cannot close the new ${accountChange ? 'account' : 'profile'} editor`, async () => {
    const h = harness(); await h.render(); await act(async () => h.button('수정').props.onClick());
    await act(async () => h.field().props.onChange({ currentTarget: { value: 'first draft' } }));
    await act(async () => { h.button('저장').props.onClick(); h.button('저장').props.onClick(); await new Promise((resolve) => setTimeout(resolve, 10)); });
    assert.equal(h.requests.length, 1); assert.equal(h.requests[0].body.payload.fcId, 'A'); assert.equal(h.field().props.readOnly, true);
    if (accountChange) await h.account('second-synthetic-staff'); else await h.switchOwner('B');
    await act(async () => h.button('수정').props.onClick());
    await act(async () => h.field().props.onChange({ currentTarget: { value: 'new owner draft' } }));
    await h.settle();
    assert.equal(h.field().props.value, 'new owner draft'); assert.ok(h.button('저장')); assert.equal(h.field().props.readOnly, false);
    await h.close();
  });
}
