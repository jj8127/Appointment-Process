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
  '@/lib/notifications': {
    getPushPermissionStatus: async () => 'denied', registerPushToken: jest.fn(),
    unregisterAllPushTokens: unregister,
  },
  '@/lib/notification-preferences-api': { getNotificationPreferences: jest.fn() },
  '@/lib/request-board-api': {
    clearAuth: async () => {}, clearRequestBoardState: clearBridge,
    getStoredAppSessionToken: async () => 'fictional-session-token',
    getStoredBridgeToken: async () => 'fictional-bridge-token',
    setAppSessionToken: async () => {},
    rbCheckAuth: async () => ({ authenticated: false, needsRelogin: false }),
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
  clearBridge.mockReset().mockImplementation(never);
  warning.mockClear();
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
