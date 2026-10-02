import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import * as restore from './client-session-restore.ts';
import * as transition from './client-session-transition.ts';

const require = createRequire(new URL('../../../package.json', import.meta.url));
const React = require('react');
const { act, create } = require('react-test-renderer');
const query = require('@tanstack/react-query');
const ts = require('typescript');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

for (const storageUnavailable of [false, true]) {
test(`provider clears account data and serializes logout before recovery login (storage ${storageUnavailable ? 'denied' : 'available'})`, async () => {
  let finishLogout;
  let logoutRequests = 0;
  const response = new Promise(resolve => { finishLogout = resolve; });
  const cookies = new Map();
  const storage = new Map();
  const redirects = [];
  const document = {
    get cookie() { return [...cookies].map(([key, value]) => `${key}=${value}`).join('; '); },
    set cookie(value) { const [pair] = value.split(';'); const [key, data] = pair.split('='); cookies.set(key, data); },
  };
  const exported = {};
  const code = ts.transpileModule(readFileSync(new URL('../hooks/use-session.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports: exported, require: id => {
    if (id === 'react' || id === 'react/jsx-runtime') return require(id);
    if (id === '@tanstack/react-query') return query;
    if (id === 'next/navigation') return { useRouter: () => ({ replace: path => redirects.push(path) }) };
    if (id === '@/lib/client-session-restore') return restore;
    if (id === '@/lib/client-session-transition') return transition;
    if (id === '@/lib/staff-identity') return { normalizeStaffType: () => null };
    if (id === '@/lib/logger') return { logger: { warn() {} } };
    throw new Error(`Unexpected fixture import: ${id}`);
  }, document, window: { location: { protocol: 'http:' } },
    localStorage: {
      setItem: (key, value) => {
        if (storageUnavailable) throw new Error('Synthetic storage unavailable');
        storage.set(key, value);
      },
      removeItem: key => {
        if (storageUnavailable) throw new Error('Synthetic storage unavailable');
        storage.delete(key);
      },
    },
    btoa: value => Buffer.from(value).toString('base64'),
    fetch: async () => { logoutRequests++; return response; }, AbortSignal,
  });
  let session;
  let mounts = 0;
  function Consumer() {
    session = exported.useSession();
    React.useEffect(() => { mounts++; }, []);
    const { data } = query.useQuery({ queryKey: ['private-records'], queryFn: async () => [], enabled: false });
    return React.createElement('snapshot', { role: session.role, records: data });
  }
  const client = new query.QueryClient();
  let renderer;
  try {
    await act(async () => { renderer = create(React.createElement(query.QueryClientProvider, { client },
      React.createElement(exported.SessionProvider, null, React.createElement(Consumer)))); });
    await act(async () => { session.loginAs('admin', '00000000001', 'Synthetic A'); });
    await act(async () => { client.setQueryData(['private-records'], ['synthetic-old-record']); });
    const mountsBeforeLogout = mounts;
    let logout;
    await act(async () => { logout = session.logout(); });
    assert.equal(logoutRequests, 1);
    assert.equal(session.role, null);
    assert.equal(session.transitioning, true);
    assert.equal(client.getQueryData(['private-records']), undefined);
    assert.ok(mounts > mountsBeforeLogout);
    assert.equal(redirects.length, 0);
    let newLoginStarted = false;
    const login = transition.withBrowserSessionTransition(async () => {
      newLoginStarted = true; session.loginAs('admin', '00000000002', 'Synthetic B');
    });
    await Promise.resolve();
    assert.equal(newLoginStarted, false);
    await act(async () => { finishLogout({ ok: true }); await logout; await login; });
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
