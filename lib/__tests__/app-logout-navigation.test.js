/* global __dirname, jest, beforeEach, afterEach, test, expect */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');

global.IS_REACT_ACT_ENVIRONMENT = true;
const Session = React.createContext(null);
const Focus = React.createContext(false);
const Router = React.createContext(null);
let root;
let session;
let focused;
let logout;
let replace;
let actions;

const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../hooks/use-app-logout.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const exportsUnderTest = {};
new Function('require', 'exports', code)((name) => ({
  react: React,
  '@react-navigation/native': { useIsFocused: () => React.useContext(Focus) },
  'expo-router': { useRouter: () => React.useContext(Router) },
  '@/hooks/use-session': { useSession: () => React.useContext(Session) },
})[name], exportsUnderTest);

function Screen({ name }) {
  actions[name] = exportsUnderTest.useAppLogout();
  return React.createElement('Screen', { name });
}
function tree() {
  return React.createElement(Session.Provider, { value: { ...session, logout } },
    ['home', 'settings'].map((name) => React.createElement(Router.Provider, {
      key: name, value: { replace: (route) => replace(name, route) },
    }, React.createElement(Focus.Provider, { value: focused === name }, React.createElement(Screen, { name })))));
}
async function render() {
  await act(async () => { if (root) root.update(tree()); else root = create(tree()); });
}
beforeEach(() => {
  session = { role: 'admin', hydrated: true };
  focused = 'home';
  logout = jest.fn();
  replace = jest.fn();
  actions = {};
});
afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; });

test('waits for local session clearing before the single login replacement', async () => {
  await render();
  await act(async () => actions.home());
  expect(logout).toHaveBeenCalledTimes(1);
  expect(replace).not.toHaveBeenCalled();
  session.role = null;
  await render();
  expect(replace.mock.calls).toEqual([['home', '/login?skipAuto=1']]);
});

test('does not await a never-resolving cleanup promise', async () => {
  logout.mockImplementation(() => { session.role = null; return new Promise(() => {}); });
  await render();
  await act(async () => { actions.home(); root.update(tree()); });
  expect(replace.mock.calls).toEqual([['home', '/login?skipAuto=1']]);
});

test('ignores repeated logout presses in the same frame', async () => {
  await render();
  await act(async () => { actions.home(); actions.home(); actions.home(); });
  expect(logout).toHaveBeenCalledTimes(1);
});

test('only settings redirects when an authenticated home is retained behind it', async () => {
  focused = 'settings';
  await render();
  await act(async () => actions.settings());
  session.role = null;
  await render();
  await render(); // Router/context identities changed; no duplicate replacement.
  expect(replace.mock.calls).toEqual([['settings', '/login?skipAuto=1']]);
});

test('does not navigate during hydration, then sends unauthenticated entry to login', async () => {
  session = { role: null, hydrated: false };
  await render();
  expect(replace).not.toHaveBeenCalled();
  session.hydrated = true;
  await render();
  expect(replace).toHaveBeenCalledTimes(1);
});

test('also handles a session cleared by the header or expiry', async () => {
  await render();
  session.role = null;
  await render();
  expect(logout).not.toHaveBeenCalled();
  expect(replace.mock.calls).toEqual([['home', '/login?skipAuto=1']]);
});

test('a later authenticated session can log out again', async () => {
  await render();
  await act(async () => actions.home());
  session.role = null;
  await render();
  session.role = 'fc';
  await render();
  await act(async () => actions.home());
  session.role = null;
  await render();
  expect(logout).toHaveBeenCalledTimes(2);
  expect(replace).toHaveBeenCalledTimes(2);
});
