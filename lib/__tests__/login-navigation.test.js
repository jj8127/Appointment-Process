/* global __dirname, jest, beforeEach, afterEach, test, expect */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');

global.IS_REACT_ACT_ENVIRONMENT = true;
const Session = React.createContext(null);
const replace = jest.fn();
const dismissTo = jest.fn();
const login = jest.fn();
const signup = jest.fn();
const saveCredentials = jest.fn();
const clearCredentials = jest.fn();
const notificationDecision = jest.fn();
const navigation = { isFocused: jest.fn(() => true) };
let root;
let session;
let params;
let Screen;
let strictMode;

// Render the actual login screen and its session-driven navigation effect.
// Device UI, credential storage, and authentication are deterministic boundaries.
const dependencies = {
  react: React,
  'expo-router': { Redirect: 'Redirect', Stack: { Screen: 'StackScreen' }, router: { replace, dismissTo, push: jest.fn() }, useLocalSearchParams: () => params, useNavigation: () => navigation },
  'react-native': {
    Image: 'Image', Pressable: 'Pressable', Text: 'Text', TextInput: 'TextInput', View: 'View',
    Keyboard: { dismiss: jest.fn() }, Platform: { OS: 'android' },
    StyleSheet: { create: (styles) => styles },
  },
  'react-native-reanimated': { LayoutAnimationConfig: ({ children }) => children },
  // The stacked signup shows every question here; the sheet always renders its consent and submit.
  '@/components/StackedForm': {
    StackField: ({ children }) => children, StackItem: ({ children }) => children,
    StackSheet: ({ children, footer }) => React.createElement(React.Fragment, null, children, footer),
    StackButton: 'StackButton', StackDockedNext: 'StackDockedNext', StackSubmit: 'StackSubmit', stackFormStyles: {},
  },
  '@/lib/signup-steps': {
    PLATFORM_SIGNUP_STEPS: ['name', 'phone', 'code', 'password', 'confirmation'], SIGNUP_MOTION: { focusDelay: 0 },
    getStackOrder: (steps) => [...steps].reverse(), advanceStackReveal: (_steps, revealed) => ({ revealed, advanced: false }),
  },
  '@expo/vector-icons': { Feather: 'Feather' },
  moti: { MotiView: 'MotiView' },
  'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
  '@/components/Button': { Button: 'Button' },
  '@/components/Toast': { useToast: () => ({ showToast: () => {} }), toast: { success: (message) => ({ message }) } },
  '@/components/KeyboardAwareWrapper': { KeyboardAwareWrapper: 'KeyboardAwareWrapper' },
  '@/components/FormInput': { FormInput: 'FormInput' },
  '@/components/ModuonBrand': { default: 'ModuonBrand' },
  '@/hooks/use-keyboard-padding': { useKeyboardPadding: () => 0, useKeyboardVisible: () => false },
  '@/hooks/use-session': { useSession: () => React.useContext(Session) },
  '@/hooks/use-draft-exit-guard': { useDraftExitGuard: () => () => {} },
  '@/hooks/use-login': { useLogin: () => ({ acceptLoginResponse: async () => 'fc', handleLoginRejection: async () => false }) },
  '@/lib/use-read-attempt': { useReadAttempt: () => () => () => true },
  '@/lib/request-board-api': { captureAppSessionOwner: () => () => true },
  '@/lib/platform-api': { PlatformApiError: class extends Error {}, platformRequest: async action => {
    if (action === 'signup') return signup();
    if (!await login()) throw new Error('합성 로그인 실패');
    return { insuranceSession: { ok: true, residentId: '01000000000' } };
  } },
  '@/lib/logger': { logger: { warn: jest.fn() } },
  '@/lib/open-external-url': { openExternalUrl: jest.fn() },
  '@/lib/referral-deeplink': { consumePendingReferralCode: async () => null, normalizeReferralInviteCode: () => null },
  '@/lib/notification-navigation-coordinator': { waitForNotificationNavigationDecision: notificationDecision },
  '@/lib/saved-login-credentials': {
    getSavedLoginCredentials: async () => ({ phone: '01000000000', password: 'Synthetic1!' }),
    clearSavedLoginCredentials: clearCredentials,
    setSavedLoginCredentials: saveCredentials,
  },
  '../assets/images/login.png': 1,
};
function loadScreen(file) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../app/services', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exported = {};
  new Function('require', 'exports', code)((name) => (
    Object.hasOwn(dependencies, name) ? dependencies[name] : require(name)
  ), exported);
  return exported.default;
}
const Login = loadScreen('login.tsx');
const Signup = loadScreen('signup.tsx');

function tree() {
  const child = React.createElement(Session.Provider, { value: { ...session } },
    React.createElement(Screen));
  return strictMode ? React.createElement(React.StrictMode, null, child) : child;
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
  session = { role: null, residentId: '', hydrated: true, isPlatformSignedIn: false, isRequestBoardDesigner: false };
  params = { skipAuto: '1' };
  Screen = Login;
  strictMode = false;
  replace.mockReset();
  dismissTo.mockReset();
  login.mockReset().mockResolvedValue(false);
  signup.mockReset().mockResolvedValue({ memberId: 'synthetic-member', displayName: '합성 회원', appSessionToken: 'synthetic-token' });
  saveCredentials.mockReset().mockResolvedValue(undefined);
  clearCredentials.mockReset().mockResolvedValue(undefined);
  notificationDecision.mockReset().mockResolvedValue(false);
  navigation.isFocused.mockReset().mockReturnValue(true);
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
});

test.each([
  ['admin', { role: 'admin' }, '/'],
  ['FC', { role: 'fc' }, '/'],
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
  expect(replace.mock.calls).toEqual([['/']]);
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
  expect(replace.mock.calls).toEqual([['/']]);
});

test.each([
  ['the notification destination takes focus', false, []],
  ['a stale pending flag leaves this screen focused', true, [['/']]],
])('successful relogin yields to pending notification navigation until %s', async (_name, stillFocused, expected) => {
  jest.useFakeTimers();
  try {
    notificationDecision.mockResolvedValue(true);
    await render();
    login.mockImplementation(async () => {
      Object.assign(session, { role: 'fc', residentId: '01000000000' });
      root.update(tree());
      return true;
    });
    await submit();
    expect(notificationDecision).toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    navigation.isFocused.mockReturnValue(stillFocused);
    await act(async () => { jest.advanceTimersByTime(1200); });
    expect(replace.mock.calls).toEqual(expected);
  } finally {
    jest.useRealTimers();
  }
});

test('a pending notification on ordinary entry is never overridden without a manual login', async () => {
  jest.useFakeTimers();
  try {
    notificationDecision.mockResolvedValue(true);
    params = {};
    session = { ...session, role: 'fc', residentId: '01000000000' };
    await render();
    await act(async () => { jest.advanceTimersByTime(5000); });
    expect(replace).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

test('ordinary login entry still restores an existing session automatically', async () => {
  params = {};
  session = { ...session, role: 'fc', residentId: '01000000000' };
  await render();
  expect(login).not.toHaveBeenCalled();
  expect(replace.mock.calls).toEqual([['/']]);
});

test.each([
  ['ordinary guest entry', {}, true],
  ['insurance deep link', { service: 'insurance' }, true],
  ['guest entry before hydration', { service: 'insurance' }, false],
])('%s can return directly to the public service home', async (_name, entryParams, hydrated) => {
  params = entryParams;
  session.hydrated = hydrated;
  await render();
  expect(replace).not.toHaveBeenCalled();

  const backButton = root.root.findByProps({ accessibilityLabel: '전체 서비스로 돌아가기' });
  await act(async () => backButton.props.onPress());

  expect(replace.mock.calls).toEqual([['/']]);
  expect(login).not.toHaveBeenCalled();
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

test.each([
  ['FC', { role: 'fc' }, { pathname: '/apply-gate', params: { next: '/?mode=insurance' } }],
  ['admin', { role: 'admin' }, '/?mode=insurance'],
  ['designer', { role: 'fc', isRequestBoardDesigner: true }, '/request-board'],
])('insurance selection resumes %s after manual login and hydration', async (_name, identity, destination) => {
  params = { skipAuto: '1', service: 'insurance' };
  session = { ...session, ...identity, residentId: '01000000000', hydrated: false };
  await render();
  expect(replace).not.toHaveBeenCalled();
  login.mockResolvedValue(true);
  await submit();
  expect(replace).not.toHaveBeenCalled();
  session.hydrated = true;
  await render();
  expect(replace.mock.calls).toEqual([[destination]]);
});

test.each(['unrecognised', ['insurance', 'insurance']])('unknown or repeated service intent %j uses ordinary landing', async (service) => {
  params = { service };
  session = { ...session, role: 'fc', residentId: '01000000000' };
  await render();
  expect(replace.mock.calls).toEqual([['/']]);
});

test('insurance intent yields to notification navigation', async () => {
  params = { service: 'insurance' };
  session = { ...session, role: 'fc', residentId: '01000000000' };
  notificationDecision.mockResolvedValue(true);
  await render();
  expect(notificationDecision).toHaveBeenCalledTimes(1);
  expect(replace).not.toHaveBeenCalled();
});

test('unmount cancels insurance intent waiting on notification startup', async () => {
  params = { service: 'insurance' };
  session = { ...session, role: 'fc', residentId: '01000000000' };
  const decision = deferred();
  notificationDecision.mockReturnValue(decision.promise);
  await render();
  await act(async () => root.unmount());
  root = null;
  await act(async () => decision.resolve(false));
  expect(replace).not.toHaveBeenCalled();
});

test('a common member automatically resumes the requested insurance registration', async () => {
  params = { service: 'insurance' };
  session = { ...session, isPlatformSignedIn: true };
  await render();
  expect(replace.mock.calls).toEqual([[{ pathname: '/apply-gate', params: { next: '/?mode=insurance' } }]]);
});

test('an incomplete FC identity does not loop from common login into the protected home', async () => {
  params = { service: 'insurance' };
  session = { ...session, role: 'fc', residentId: '', isPlatformSignedIn: true };
  await render();
  expect(replace).not.toHaveBeenCalled();
});

test.each(['login', 'signup'])('%s returns to the existing account without replacing another account into history', async screen => {
  Screen = screen === 'login' ? Login : Signup;
  params = {};
  session = { ...session, isPlatformSignedIn: true };
  await render();
  expect(dismissTo.mock.calls).toEqual([['/services/account']]);
  expect(replace).not.toHaveBeenCalled();
  expect(root.root.findAllByType('Redirect')).toHaveLength(0);
});

test.each(['login', 'signup'])('%s successful submission requests scoped account dismissal rather than replacement', async screen => {
  Screen = screen === 'login' ? Login : Signup;
  session.loginPlatformMember = async () => {
    session.isPlatformSignedIn = true;
    root.update(tree());
  };
  await render();
  if (screen === 'login') {
    // The network fixture updates the verified common session, just as the shared store does.
    login.mockImplementation(async () => { session.isPlatformSignedIn = true; root.update(tree()); return true; });
    await submit();
  } else {
    await act(async () => {
      for (const [label, value] of [['이름', '합성 회원'], ['휴대폰 번호', '01000000000'], ['인증 코드', '123456'],
        ['비밀번호', 'Synthetic1!'], ['비밀번호 확인', 'Synthetic1!']]) {
        root.root.findAllByType('TextInput').find(node => node.props.accessibilityLabel === label).props.onChangeText(value);
      }
      root.root.findByProps({ accessibilityRole: 'checkbox' }).props.onPress();
    });
    await act(async () => { await root.root.findAllByType('StackButton').find(node => node.props.label === '동의하고 가입하기').props.onPress(); });
    expect(signup).toHaveBeenCalledTimes(1);
  }
  expect(dismissTo).toHaveBeenCalledWith('/services/account');
  expect(replace).not.toHaveBeenCalled();
});

test('common account landing still yields to pending notification navigation', async () => {
  params = {};
  session.isPlatformSignedIn = true;
  notificationDecision.mockResolvedValue(true);
  await render();
  expect(dismissTo).not.toHaveBeenCalled();
  expect(replace).not.toHaveBeenCalled();
});

test('remember-password opt-out clears storage once under StrictMode and does not double-toggle on pressIn/press', async () => {
  strictMode = true;
  await render();
  const checkbox = () => root.root.findByProps({ accessibilityLabel: '비밀번호 저장' });
  expect(checkbox().props.accessibilityState.checked).toBe(true);
  await act(async () => checkbox().props.onPressIn());
  await act(async () => checkbox().props.onPress());
  expect(checkbox().props.accessibilityState.checked).toBe(false);
  expect(clearCredentials).toHaveBeenCalledTimes(1);
  await act(async () => checkbox().props.onPress());
  expect(checkbox().props.accessibilityState.checked).toBe(true);
  expect(clearCredentials).toHaveBeenCalledTimes(1);
});
