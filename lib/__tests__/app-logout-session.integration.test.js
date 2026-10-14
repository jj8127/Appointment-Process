/* global __dirname, jest, beforeEach, afterEach, test, expect */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');

global.IS_REACT_ACT_ENVIRONMENT = true;
const Focus = React.createContext(false);
const Router = React.createContext(null);
const never = () => new Promise(() => {});
const storage = {
  getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn(),
};
const unregister = jest.fn();
const clearBridge = jest.fn();
const checkAuth = jest.fn();
const persistToken = jest.fn();
const storedToken = jest.fn();
const platformStorage = { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() };
const platformRequest = jest.fn();
let appSessionRevision = 0;
const warning = jest.fn();
let root;
let session;
let actions;
let replacements;

// Run the real provider, logout coordinator, and navigation hook. Only device,
// persistence, and network boundaries are replaced with deterministic fixtures.
function loadSource(relativePath, dependencies) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exported = {};
  new Function('require', 'exports', code)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    return require(name);
  }, exported);
  return exported;
}

const provider = loadSource('hooks/use-session.tsx', {
  react: React,
  'react-native': { AppState: { addEventListener: () => ({ remove() {} }) } },
  '@/lib/logger': { logger: { warn: warning } },
  '@/lib/safe-storage': { safeStorage: storage },
  '@/lib/secure-token-storage': { sensitiveTokenStorage: platformStorage },
  '@/lib/platform-api': { platformRequest },
  '@/lib/notifications': {
    getPushPermissionStatus: async () => 'denied', registerPushToken: jest.fn(),
    unregisterAllPushTokens: unregister,
  },
  '@/lib/notification-preferences-api': { getNotificationPreferences: jest.fn() },
  '@/lib/request-board-api': {
    captureAppSessionOwner: () => { const owner = appSessionRevision; return () => owner === appSessionRevision; },
    clearAuth: async () => {}, clearRequestBoardState: clearBridge,
    getStoredAppSessionToken: storedToken,
    getStoredBridgeToken: async () => 'fictional-bridge-token',
    setAppSessionToken: (token) => { appSessionRevision += 1; return persistToken(token); },
    persistAuthChange: async (write) => write(),
    rbCheckAuth: checkAuth,
  },
});
const navigation = loadSource('hooks/use-app-logout.ts', {
  react: React,
  '@react-navigation/native': { useIsFocused: () => React.useContext(Focus) },
  'expo-router': { useRouter: () => React.useContext(Router) },
  '@/hooks/use-session': provider,
});

function Screen({ name }) {
  actions[name] = navigation.useAppLogout();
  return React.createElement('Screen', { name });
}

function NavigationHost() {
  session = provider.useSession();
  const [route, setRoute] = React.useState('settings');
  const router = React.useMemo(() => ({ replace(destination) {
    replacements.push({ destination, role: session.role, token: session.appSessionToken });
    setRoute('login');
  } }), []);
  return React.createElement(Router.Provider, { value: router },
    ['home', 'settings'].map((name) => React.createElement(Focus.Provider, {
      key: name, value: route === name,
    }, React.createElement(Screen, { name }))),
    // This host verifies route completion, not native login-screen rendering.
    route === 'login' && React.createElement('LoginDestination'));
}

beforeEach(() => {
  actions = {}; replacements = []; session = undefined;
  storage.setItem.mockReset().mockResolvedValue(undefined);
  storage.removeItem.mockReset().mockResolvedValue(undefined);
  storage.getItem.mockReset();
  unregister.mockReset().mockImplementation(never);
  appSessionRevision = 0;
  clearBridge.mockReset().mockImplementation(() => { appSessionRevision += 1; return never(); });
  checkAuth.mockReset().mockResolvedValue({ authenticated: false, needsRelogin: false });
  persistToken.mockReset().mockResolvedValue(undefined);
  storedToken.mockReset().mockResolvedValue('fictional-session-token');
  platformStorage.getItem.mockReset().mockResolvedValue(null);
  platformStorage.setItem.mockReset().mockResolvedValue(undefined);
  platformStorage.removeItem.mockReset().mockResolvedValue(undefined);
  platformRequest.mockReset().mockResolvedValue({ ok: true, member: { id: 'synthetic-member', name: '가상 회원' } });
  warning.mockClear();
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function mount(identity = { role: 'fc' }) {
  storage.getItem.mockResolvedValue(JSON.stringify({ residentId: '01000000000', ...identity }));
  await act(async () => { root = create(React.createElement(provider.SessionProvider, null,
    React.createElement(NavigationHost))); });
}

test.each(['account change', 'token replacement', 'logout'])('ignores late bridge success after %s', async (change) => {
  const pending = deferred();
  checkAuth.mockReturnValueOnce(pending.promise);
  await mount();
  await act(async () => {
    if (change === 'logout') session.logout();
    else if (change === 'token replacement') await session.replaceAppSessionToken('fictional-new-token');
    else session.loginAs('admin', '01000000001', '', 'admin');
  });
  await act(async () => { pending.resolve({ authenticated: true,
    user: { role: 'designer', phone: '01000000000' } }); });
  expect(session.requestBoardRole).toBeNull();
  expect(session.isRequestBoardDesigner).toBe(false);
  expect(session.requestBoardSyncStatus).not.toBe('ready');
});

test('does not clear a new bridge when login starts between reauth result and automatic cleanup', async () => {
  const pending = deferred(); checkAuth.mockReturnValueOnce(pending.promise);
  await mount();
  const changeAccount = pending.promise.then(() => {
    session.loginAs('admin', '01000000001', '', 'admin', false, false, null, 'fictional-new-login-token');
  });
  await act(async () => {
    pending.resolve({ authenticated: false, needsRelogin: true });
    await changeAccount;
  });
  expect(session).toMatchObject({ role: 'admin', residentId: '01000000001', appSessionToken: 'fictional-new-login-token' });
  expect(clearBridge).not.toHaveBeenCalled();
});

test('an old forced sync cannot release the newer single-flight request', async () => {
  const first = deferred(); const second = deferred();
  checkAuth.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  await mount();
  let forced; let shared;
  await act(async () => { forced = session.ensureRequestBoardSession({ force: true }); });
  await act(async () => { first.resolve({ authenticated: false, needsRelogin: true }); });
  await act(async () => { shared = session.ensureRequestBoardSession(); });
  expect(checkAuth).toHaveBeenCalledTimes(2);
  await act(async () => { second.resolve({ authenticated: true, user: { role: 'fc', phone: '01000000000' } }); });
  await expect(Promise.all([forced, shared])).resolves.toEqual([{ ok: true }, { ok: true }]);
  expect(session.requestBoardSyncStatus).toBe('ready');
  expect(clearBridge).not.toHaveBeenCalled();
});

test.each(['logout', 'new login'])('token persistence finishing after %s cannot restore the previous signed session', async (change) => {
  await mount({ role: 'admin', staffType: 'admin' });
  const pending = deferred(); persistToken.mockReturnValueOnce(pending.promise);
  let replacement;
  await act(async () => {
    replacement = session.replaceAppSessionToken('fictional-delayed-token');
    if (change === 'logout') session.logout();
    else session.loginAs('admin', '01000000001', '', 'admin', false, false, null, 'fictional-new-login-token');
  });
  await act(async () => { pending.resolve(); await replacement; });
  if (change === 'logout') {
    expect(session.role).toBeNull(); expect(session.appSessionToken).toBeNull();
  } else {
    expect(session).toMatchObject({ role: 'admin', residentId: '01000000001', appSessionToken: 'fictional-new-login-token' });
  }
});

test('late stored session restoration cannot undo logout before hydration', async () => {
  const pending = deferred(); storage.getItem.mockReturnValueOnce(pending.promise);
  await act(async () => { root = create(React.createElement(provider.SessionProvider, null,
    React.createElement(NavigationHost))); });
  await act(async () => { session.logout(); });
  await act(async () => { pending.resolve(JSON.stringify({ role: 'fc', residentId: '01000000000' })); });
  expect(session.hydrated).toBe(true);
  expect(session.role).toBeNull();
  expect(storedToken).not.toHaveBeenCalled();
});

test('legacy non-phone cleanup cannot delete metadata saved by a new login after cleanup settles', async () => {
  const cleanup = deferred();
  clearBridge.mockImplementationOnce(() => { appSessionRevision += 1; return cleanup.promise; });
  await mount({ role: 'fc', residentId: 'old-non-phone-id' });
  expect(session.hydrated).toBe(false);
  const removals = storage.removeItem.mock.calls.filter(([key]) => key === 'fc-onboarding/session').length;
  await act(async () => { session.loginAs('admin', '01000000001', '', 'admin', false, false, null, 'fictional-new-token'); });
  await act(async () => { cleanup.resolve(); });
  expect(session).toMatchObject({ role: 'admin', residentId: '01000000001', appSessionToken: 'fictional-new-token' });
  expect(storage.removeItem.mock.calls.filter(([key]) => key === 'fc-onboarding/session')).toHaveLength(removals);
  expect(JSON.parse(storage.setItem.mock.calls.at(-1)[1]).residentId).toBe('01000000001');
});

test('restores a legacy manager, migrates its token, and stores only session metadata', async () => {
  storedToken.mockResolvedValue(null);
  await mount({ role: 'manager', appSessionToken: 'fictional-legacy-token' });
  expect(session).toMatchObject({ role: 'admin', readOnly: true,
    residentId: '01000000000', residentMask: '010-0000-0000', appSessionToken: 'fictional-legacy-token' });
  expect(persistToken).toHaveBeenCalledWith('fictional-legacy-token');
  expect(storage.setItem).toHaveBeenCalled();
  for (const [, payload] of storage.setItem.mock.calls) {
    expect(JSON.parse(payload)).not.toHaveProperty('appSessionToken');
  }
  const writes = storage.setItem.mock.calls.length;
  await act(async () => { await session.replaceAppSessionToken('fictional-renewed-token'); });
  expect(storage.setItem).toHaveBeenCalledTimes(writes);
});

test('consumer restoration keeps its token out of FC authentication and Request Board', async () => {
  storage.getItem.mockImplementation(async key => key.endsWith('/platform-member')
    ? JSON.stringify({ id: 'synthetic-member', name: '가상 회원' }) : null);
  platformStorage.getItem.mockResolvedValue('fictional-consumer-token');
  await act(async () => { root = create(React.createElement(provider.SessionProvider, null,
    React.createElement(NavigationHost))); });
  expect(session).toMatchObject({ role: null, appSessionToken: null, platformHydrated: true,
    platformSessionToken: 'fictional-consumer-token', isPlatformSignedIn: true,
    platformMember: { id: 'synthetic-member', name: '가상 회원' } });
  expect(platformRequest).toHaveBeenCalledWith('verify', {}, 'fictional-consumer-token');
  expect(checkAuth).not.toHaveBeenCalled();
  expect(persistToken).not.toHaveBeenCalled();
});

test('a late consumer restore cannot overwrite a newly signed in consumer', async () => {
  storage.getItem.mockImplementation(async key => key.endsWith('/platform-member')
    ? JSON.stringify({ id: 'synthetic-old-member', name: '가상 이전 회원' }) : null);
  platformStorage.getItem.mockResolvedValue('fictional-old-consumer-token');
  const verification = deferred();
  platformRequest.mockReturnValue(verification.promise);
  clearBridge.mockImplementation(async () => { appSessionRevision += 1; });
  await act(async () => { root = create(React.createElement(provider.SessionProvider, null,
    React.createElement(NavigationHost))); });
  await act(async () => { await session.loginPlatformMember({ id: 'synthetic-new-member', name: '가상 새 회원' }, 'fictional-new-consumer-token'); });
  await act(async () => { verification.resolve({ member: { id: 'synthetic-old-member', name: '가상 이전 회원' } }); });
  expect(session).toMatchObject({ role: null, platformMember: { id: 'synthetic-new-member', name: '가상 새 회원' }, platformSessionToken: 'fictional-new-consumer-token' });
});

test.each([401, 403, 503])('consumer restore handles verification status %s without granting FC rights', async status => {
  storage.getItem.mockImplementation(async key => key.endsWith('/platform-member')
    ? JSON.stringify({ id: 'synthetic-member', name: '가상 회원' }) : null);
  platformStorage.getItem.mockResolvedValue('fictional-consumer-token');
  platformRequest.mockRejectedValue({ status });
  await act(async () => { root = create(React.createElement(provider.SessionProvider, null,
    React.createElement(NavigationHost))); });
  expect(session.role).toBeNull();
  expect(session.appSessionToken).toBeNull();
  expect(session.platformMember !== null).toBe(status === 503);
  expect(session.platformSessionToken !== null).toBe(status === 503);
  expect(checkAuth).not.toHaveBeenCalled();
});

test('consumer login clears FC ownership and FC login clears consumer ownership', async () => {
  clearBridge.mockImplementation(async () => { appSessionRevision += 1; });
  await mount({ role: 'admin', staffType: 'admin' });
  await act(async () => { await session.loginPlatformMember({ id: 'synthetic-member', name: '가상 회원' }, 'fictional-consumer-token'); });
  expect(session).toMatchObject({ role: null, appSessionToken: null, platformSessionToken: 'fictional-consumer-token', isPlatformSignedIn: true });
  expect(unregister).toHaveBeenCalledWith('fictional-session-token');
  expect(platformStorage.setItem).toHaveBeenCalledWith('fc-onboarding.platform-session-token', 'fictional-consumer-token');
  expect(storage.setItem.mock.calls.some(([, payload]) => payload.includes('fictional-consumer-token'))).toBe(false);
  await act(async () => { session.loginAs('fc', '01000000001', '가상 FC', null, false, false, null, 'fictional-fc-token'); });
  expect(session).toMatchObject({ role: 'fc', appSessionToken: 'fictional-fc-token', platformSessionToken: null, platformMember: null });
});

test('a late consumer login cannot replace a newer FC session', async () => {
  clearBridge.mockImplementation(async () => { appSessionRevision += 1; });
  await mount({ role: 'admin', staffType: 'admin' });
  const pending = deferred();
  platformStorage.setItem.mockReturnValueOnce(pending.promise);
  let consumerLogin;
  await act(async () => { consumerLogin = session.loginPlatformMember({ id: 'synthetic-member', name: '가상 회원' }, 'fictional-consumer-token').catch(error => error); });
  await act(async () => { session.loginAs('fc', '01000000001', '가상 FC', null, false, false, null, 'fictional-fc-token'); });
  await act(async () => { pending.resolve(); await consumerLogin; });
  expect(session).toMatchObject({ role: 'fc', platformSessionToken: null, platformMember: null, appSessionToken: 'fictional-fc-token' });
});

test('common-to-FC login exposes the signed token atomically while repeated persistence is delayed', async () => {
  clearBridge.mockImplementation(async () => { appSessionRevision += 1; });
  await mount({ role: 'admin', staffType: 'admin' });
  await act(async () => { await session.loginPlatformMember({ id: 'synthetic-member', name: '가상 회원' }, 'fictional-consumer-token'); });
  const pending = deferred(); persistToken.mockReturnValueOnce(pending.promise);
  await act(async () => { session.loginAs('fc', '01000000001', '가상 FC', null, false, false, null, 'fictional-installed-fc-token'); });
  expect(session).toMatchObject({ role: 'fc', platformMember: null, platformSessionToken: null,
    appSessionToken: 'fictional-installed-fc-token', isPlatformSignedIn: true });
  await act(async () => pending.resolve());
  expect(session.appSessionToken).toBe('fictional-installed-fc-token');
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = undefined;
});

test.each([
  ['admin', { role: 'admin', staffType: 'admin' }],
  ['developer', { role: 'admin', staffType: 'developer' }],
  ['manager', { role: 'admin', readOnly: true }],
  ['FC', { role: 'fc' }],
  ['designer', { role: 'fc', requestBoardRole: 'designer', isRequestBoardDesigner: true }],
])('%s logout commits once while storage and remote cleanup never settle', async (_name, identity) => {
  storage.getItem.mockResolvedValue(JSON.stringify({
    ...identity, residentId: '01000000000', displayName: '가상 테스트 계정',
  }));
  await act(async () => { root = create(React.createElement(provider.SessionProvider, null,
    React.createElement(NavigationHost))); });
  expect(session.hydrated).toBe(true);
  expect(session.role).toBe(identity.role);
  expect(replacements).toEqual([]);

  // Both clearSessionState's storage work and push unregistration are pending.
  storage.removeItem.mockImplementation(never);
  await act(async () => { actions.settings(); actions.settings(); });
  expect(session.role).toBeNull();
  expect(session.appSessionToken).toBeNull();
  expect(session.residentId).toBe('');
  expect(unregister).toHaveBeenCalledTimes(1);
  expect(unregister).toHaveBeenCalledWith('fictional-session-token');
  expect(replacements).toEqual([{
    destination: '/login?skipAuto=1', role: null, token: null,
  }]);
  expect(root.root.findAllByType('LoginDestination')).toHaveLength(1);
  expect(warning).not.toHaveBeenCalled();
});
