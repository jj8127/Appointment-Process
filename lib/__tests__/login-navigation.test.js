/* global __dirname, jest, beforeEach, afterEach, test, expect */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');

global.IS_REACT_ACT_ENVIRONMENT = true;
const Session = React.createContext(null);
const replace = jest.fn();
const login = jest.fn();
const saveCredentials = jest.fn();
const notificationDecision = jest.fn();
let root;
let session;
let params;

// Render the actual login screen and its session-driven navigation effect.
// Device UI, credential storage, and authentication are deterministic boundaries.
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../app/login.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const dependencies = {
  react: React,
  'expo-router': { router: { replace, push: jest.fn() }, useLocalSearchParams: () => params },
  'react-native': {
    Image: 'Image', Pressable: 'Pressable', Text: 'Text', View: 'View',
    StyleSheet: { create: (styles) => styles },
  },
  '@expo/vector-icons': { Feather: 'Feather' },
  moti: { MotiView: 'MotiView' },
  'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
  '@/components/Button': { Button: 'Button' },
  '@/components/KeyboardAwareWrapper': { KeyboardAwareWrapper: 'KeyboardAwareWrapper' },
  '@/components/FormInput': { FormInput: 'FormInput' },
  '@/hooks/use-keyboard-padding': { useKeyboardPadding: () => 0 },
  '@/hooks/use-session': { useSession: () => React.useContext(Session) },
  '@/hooks/use-login': { useLogin: () => ({ login, loading: false }) },
  '@/lib/logger': { logger: { warn: jest.fn() } },
  '@/lib/notification-navigation-coordinator': { waitForNotificationNavigationDecision: notificationDecision },
  '@/lib/saved-login-credentials': {
    getSavedLoginCredentials: async () => null,
    clearSavedLoginCredentials: async () => {},
    setSavedLoginCredentials: saveCredentials,
  },
  '../assets/images/login.png': 1,
};
const exported = {};
new Function('require', 'exports', code)((name) => (
  Object.hasOwn(dependencies, name) ? dependencies[name] : require(name)
), exported);

function tree() {
  return React.createElement(Session.Provider, { value: { ...session } },
    React.createElement(exported.default));
}
async function render() {
  await act(async () => { if (root) root.update(tree()); else root = create(tree()); });
}
async function submit() {
  await act(async () => { await root.root.findByType('Button').props.onPress(); });
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  session = { role: null, residentId: '', hydrated: true, isRequestBoardDesigner: false };
  params = { skipAuto: '1' };
  replace.mockReset();
  login.mockReset().mockResolvedValue(false);
  saveCredentials.mockReset().mockResolvedValue(undefined);
  notificationDecision.mockReset().mockResolvedValue(false);
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
});

test.each([
  ['admin', { role: 'admin' }, '/'],
  ['FC', { role: 'fc' }, '/home-lite'],
  ['designer', { role: 'fc', isRequestBoardDesigner: true }, '/request-board'],
])('%s can log in after entering through the logout route', async (_name, identity, destination) => {
  await render();
  expect(replace).not.toHaveBeenCalled();
  login.mockImplementation(async () => {
    Object.assign(session, identity, { residentId: '01000000000' });
    root.update(tree());
    return true;
  });
  await submit();
  expect(replace.mock.calls).toEqual([[destination]]);
  expect(saveCredentials).toHaveBeenCalledTimes(1);
});

test('logout entry ignores a stale session, a pending login, and a failed login', async () => {
  session = { ...session, role: 'admin', residentId: '01000000000' };
  const attempt = deferred();
  login.mockReturnValue(attempt.promise);
  await render();
  let submission;
  await act(async () => { submission = root.root.findByType('Button').props.onPress(); });
  expect(replace).not.toHaveBeenCalled();
  await act(async () => { attempt.resolve(false); await submission; });
  expect(replace).not.toHaveBeenCalled();
  expect(saveCredentials).not.toHaveBeenCalled();

  // A subsequent valid attempt must release the guard even for the same identity.
  login.mockResolvedValue(true);
  await submit();
  expect(replace.mock.calls).toEqual([['/']]);
});

test('successful login waits for session propagation and hydration', async () => {
  session.hydrated = false;
  await render();
  login.mockResolvedValue(true);
  await submit();
  expect(replace).not.toHaveBeenCalled();
  Object.assign(session, { role: 'fc', residentId: '01000000000' });
  await render();
  expect(replace).not.toHaveBeenCalled();
  session.hydrated = true;
  await render();
  expect(replace.mock.calls).toEqual([['/home-lite']]);
});

test.each(['pending', 'failed'])('credential persistence being %s does not block successful login', async (state) => {
  saveCredentials.mockImplementation(() => state === 'pending'
    ? new Promise(() => {}) : Promise.reject(new Error('fictional storage failure')));
  await render();
  login.mockImplementation(async () => {
    Object.assign(session, { role: 'fc', residentId: '01000000000' });
    root.update(tree());
    return true;
  });
  await act(async () => { void root.root.findByType('Button').props.onPress(); });
  expect(replace.mock.calls).toEqual([['/home-lite']]);
});

test('successful relogin preserves pending notification navigation priority', async () => {
  notificationDecision.mockResolvedValue(true);
  await render();
  login.mockImplementation(async () => {
    Object.assign(session, { role: 'fc', residentId: '01000000000' });
    root.update(tree());
    return true;
  });
  await submit();
  expect(notificationDecision).toHaveBeenCalledTimes(1);
  expect(replace).not.toHaveBeenCalled();
});

test('ordinary login entry still restores an existing session automatically', async () => {
  params = {};
  session = { ...session, role: 'fc', residentId: '01000000000' };
  await render();
  expect(login).not.toHaveBeenCalled();
  expect(replace.mock.calls).toEqual([['/home-lite']]);
});

test('unmount cancels a relogin landing waiting on notification startup', async () => {
  const decision = deferred();
  notificationDecision.mockReturnValue(decision.promise);
  await render();
  login.mockImplementation(async () => {
    Object.assign(session, { role: 'fc', residentId: '01000000000' });
    root.update(tree());
    return true;
  });
  await submit();
  expect(notificationDecision).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
  root = null;
  await act(async () => decision.resolve(false));
  expect(replace).not.toHaveBeenCalled();
});
