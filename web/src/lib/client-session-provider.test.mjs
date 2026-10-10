import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import * as restore from './client-session-restore.ts';
import * as transition from './client-session-transition.ts';
import * as queryReadError from './query-read-error.ts';

const require = createRequire(new URL('../../../package.json', import.meta.url));
const React = require('react');
const { act, create } = require('react-test-renderer');
const query = require('@tanstack/react-query');
const ts = require('typescript');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

for (const { cookieSession, storageUnavailable = false, logoutOk = true } of [
  { cookieSession: true },
  { cookieSession: false },
  { cookieSession: true, storageUnavailable: true, logoutOk: false },
]) {
test(`provider restores cookies=${cookieSession} and recovers login with storage=${!storageUnavailable}, logout=${logoutOk}`, async () => {
  let finishLogout;
  let logoutRequests = 0;
  const response = new Promise(resolve => { finishLogout = resolve; });
  const cookies = new Map(cookieSession ? [['session_role', 'manager'], ['session_resident', '00000000001']] : []);
  const storageKey = 'fc-onboarding/session';
  const legacySession = Buffer.from(encodeURIComponent(JSON.stringify({ role: 'admin', residentId: '00000000009' }))).toString('base64');
  const storage = new Map([[storageKey, legacySession]]);
  const redirects = [];
  const document = {
    get cookie() { return [...cookies].map(([key, value]) => `${key}=${value}`).join('; '); },
    set cookie(value) { const [pair] = value.split(';'); const [key, data] = pair.split('='); cookies.set(key, data); },
  };
  const exported = {};
  const alertExports = {};
  const context = { require: id => {
    if (id === 'react' || id === 'react/jsx-runtime') return require(id);
    if (id === '@tanstack/react-query') return query;
    if (id === 'next/navigation') return { useRouter: () => ({ replace: path => redirects.push(path) }) };
    if (id === '@/lib/client-session-restore') return restore;
    if (id === '@/lib/client-session-transition') return transition;
    if (id === '@/lib/staff-identity') return { normalizeStaffType: () => null };
    if (id === '@/lib/logger') return { logger: { warn() {} } };
    if (id === '@/hooks/use-session') return exported;
    if (id === '@/lib/query-read-error') return queryReadError;
    if (id === '@mantine/core') return { Alert: 'alert', Button: 'button', Group: 'group', Text: 'text' };
    throw new Error(`Unexpected fixture import: ${id}`);
  }, document, window: { location: { protocol: 'http:' } },
    localStorage: {
      setItem: () => assert.fail('session metadata must not be persisted'),
      removeItem: key => {
        if (storageUnavailable) throw new Error('Synthetic storage unavailable');
        storage.delete(key);
      },
    },
    fetch: async (url, options) => {
      assert.equal(url, '/api/auth/logout');
      assert.equal(options.method, 'POST');
      assert.ok(options.signal instanceof AbortSignal);
      logoutRequests++; return response;
    }, AbortSignal: { timeout: milliseconds => {
      assert.equal(milliseconds, 15_000);
      return AbortSignal.timeout(milliseconds);
    } },
  };
  for (const [source, exports] of [['../hooks/use-session.tsx', exported], ['../components/QueryErrorAlert.tsx', alertExports]]) {
    const code = ts.transpileModule(readFileSync(new URL(source, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(code, { ...context, exports });
  }
  let session;
  let mounts = 0;
  let readError = new queryReadError.QueryReadError(403);
  let retries = 0;
  function Consumer() {
    session = exported.useSession();
    React.useEffect(() => { mounts++; }, []);
    const { data } = query.useQuery({ queryKey: ['private-records'], queryFn: async () => [], enabled: false });
    return React.createElement('snapshot', { role: session.role, records: data },
      React.createElement(alertExports.QueryErrorAlert, { error: readError, onRetry() { retries++; } }));
  }
  const client = new query.QueryClient();
  let renderer;
  try {
    await act(async () => { renderer = create(React.createElement(query.QueryClientProvider, { client },
      React.createElement(exported.SessionProvider, null, React.createElement(Consumer)))); });
    assert.equal(session.hydrated, true);
    assert.equal(session.role, cookieSession ? 'manager' : null);
    assert.equal(session.residentId, cookieSession ? '00000000001' : '');
    assert.equal(storage.has(storageKey), storageUnavailable);
    assert.equal(renderer.root.findAllByType('button').length, 1);
    await act(async () => { renderer.root.findByType('button').props.onClick(); });
    assert.equal(retries, 1);
    assert.equal(logoutRequests, 0);
    readError = new queryReadError.QueryReadError(401);
    await act(async () => { session.loginAs('admin', '00000000001', 'Synthetic A'); });
    await act(async () => { client.setQueryData(['private-records'], ['synthetic-old-record']); });
    const mountsBeforeLogout = mounts;
    const recoveryButton = renderer.root.findAllByType('button').find(button => button.props.children === '다시 로그인');
    assert.equal(recoveryButton.props.href, undefined);
    await act(async () => { recoveryButton.props.onClick(); });
    assert.equal(logoutRequests, 1);
    assert.equal(session.role, null);
    assert.equal(session.transitioning, true);
    assert.equal(client.getQueryData(['private-records']), undefined);
    assert.ok(mounts > mountsBeforeLogout);
    assert.equal(redirects.length, 0);
    const logout = session.logout();
    let newLoginStarted = false;
    const login = transition.withBrowserSessionTransition(async () => {
      newLoginStarted = true; session.loginAs('admin', '00000000002', 'Synthetic B');
    });
    await Promise.resolve();
    assert.equal(newLoginStarted, false);
    await act(async () => { finishLogout({ ok: logoutOk }); await logout; await login; });
    assert.equal(session.transitioning, false);
    assert.equal(session.residentId, '00000000002');
    assert.equal(renderer.root.findByType('snapshot').props.records, undefined);
    assert.deepEqual(redirects, ['/auth']);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    client.clear();
  }
});
}
