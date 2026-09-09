/* global __dirname, jest, beforeEach, afterEach, test, expect */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');

global.IS_REACT_ACT_ENVIRONMENT = true;
let root;
let show;
let finishAnimations;
const nativeAlert = jest.fn();
const Alert = { alert: nativeAlert };
const flatten = (style) => Object.assign({}, ...(Array.isArray(style) ? style.map(flatten) : [style]));
const animation = { duration() { return this; } };
const reanimated = {
  default: { View: 'AnimatedView', createAnimatedComponent: () => 'AnimatedPressable' },
  FadeIn: animation, FadeOut: animation,
  useSharedValue: (value) => React.useRef({ value }).current,
  // Read animated properties when asserted so effects mutate persistent values,
  // as on the UI thread. Do not reset values when alert props change.
  useAnimatedStyle: (getStyle) => new Proxy({}, {
    ownKeys: () => Object.keys(getStyle()),
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
    get: (_, key) => getStyle()[key],
  }),
  withSpring: (value) => value,
  withTiming: (value, _, callback) => {
    if (finishAnimations && callback) callback(true);
    return value;
  },
  runOnJS: (callback) => callback,
};
function load(relativePath) {
  const source = fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  } }).outputText;
  const exports = {};
  new Function('require', 'exports', code)((name) => {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (name === 'react-native') return {
      Alert, Modal: 'Modal', Pressable: 'Pressable', Text: 'Text', View: 'View',
      StyleSheet: { create: (styles) => styles },
    };
    if (name === 'react-native-reanimated') return { __esModule: true, ...reanimated };
    if (name === '@/components/StatusGlyph') return { default: () => null, __esModule: true };
    if (name === '@/components/app-alert-utils') return load('../app-alert-utils.ts');
    if (name === '@/lib/theme') return load('../../lib/theme.ts');
    if (name === '@/lib/user-facing-error') return {
      inferAlertVariantFromTitle: () => 'info', inferUserFacingAlertFallback: () => '',
      toUserFacingAlertMessage: (value) => value,
    };
    throw new Error(`Unexpected dependency: ${name}`);
  }, exports);
  return exports;
}
const { AppAlertProvider, useAppAlert } = load('../AppAlertProvider.tsx');
function Probe() { show = useAppAlert(); return React.createElement('Home'); }
function button(label) {
  return root.root.findAllByType('Pressable').find((node) =>
    node.children.some((child) => child.type === 'Text' && child.props.children === label));
}
function cardStyle() {
  const card = root.root.findAll((node) => {
    if (typeof node.type !== 'string') return false;
    const style = flatten(node.props.style);
    return style.width === '100%' && style.maxWidth === 340;
  })[0];
  return flatten(card.props.style);
}
function isVisible() { return root.root.findAllByType('Modal').some((modal) => modal.props.visible); }
async function press(label) { await act(async () => { button(label).props.onPress(); }); }
beforeEach(async () => {
  finishAnimations = true;
  await act(async () => { root = create(React.createElement(AppAlertProvider, null, React.createElement(Probe))); });
});
afterEach(async () => { await act(async () => root.unmount()); });

test('second queued alert stays visible after opening the store from the first', async () => {
  const openStore = jest.fn();
  await act(async () => {
    show('Update', 'Fictional update', [{ text: 'Open store', onPress: openStore }]);
    show('Update', 'Duplicate pending check', [{ text: 'Later' }]);
  });
  await press('Open store');
  expect(openStore).toHaveBeenCalledTimes(1);
  expect(isVisible()).toBe(true);
  expect(cardStyle().opacity ?? 1).toBe(1);
  await press('Later');
  expect(isVisible()).toBe(false);
});

test('closing and actions do not wait for animation completion or app foreground return', async () => {
  finishAnimations = false;
  const action = jest.fn();
  await act(async () => show('Update', '', [{ text: 'Later', onPress: action }]));
  await press('Later');
  expect(action).toHaveBeenCalledTimes(1);
  expect(isVisible()).toBe(false);
});

test('throwing action cannot strand a transparent blocking modal', async () => {
  await act(async () => show('Action', '', [{ text: 'Continue', onPress: () => { throw new Error('fictional failure'); } }]));
  await act(async () => { expect(() => button('Continue').props.onPress()).toThrow('fictional failure'); });
  expect(isVisible()).toBe(false);
});

test('a rapid repeated press dispatches once and cannot consume the next queued alert', async () => {
  const action = jest.fn();
  await act(async () => {
    show('First', '', [{ text: 'Continue', onPress: action }]);
    show('Second', '', [{ text: 'Next' }]);
  });
  const onPress = button('Continue').props.onPress;
  await act(async () => { onPress(); onPress(); });
  expect(action).toHaveBeenCalledTimes(1);
  expect(button('Next')).toBeDefined();
  expect(cardStyle().opacity ?? 1).toBe(1);
});

test('an action can enqueue a follow-up alert without dropping it', async () => {
  await act(async () => show('First', '', [{ text: 'Continue', onPress: () => show('Follow-up', '', [{ text: 'Done' }]) }]));
  await press('Continue');
  expect(button('Done')).toBeDefined();
  expect(cardStyle().opacity ?? 1).toBe(1);
});

test('hardware back follows cancelability and invokes the cancel action once', async () => {
  const cancel = jest.fn();
  await act(async () => show('Required', '', [{ text: 'OK' }]));
  await act(async () => root.root.findByType('Modal').props.onRequestClose());
  expect(isVisible()).toBe(true);
  await press('OK');
  await act(async () => show('Optional', '', [{ text: 'Cancel', style: 'cancel', onPress: cancel }], { cancelable: true }));
  const onBack = root.root.findByType('Modal').props.onRequestClose;
  await act(async () => { onBack(); onBack(); });
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(isVisible()).toBe(false);
});

test('native Alert override routes through the same queue and is restored on unmount', async () => {
  await act(async () => Alert.alert('Native caller'));
  expect(isVisible()).toBe(true);
  await press('확인');
  expect(isVisible()).toBe(false);
  await act(async () => root.unmount());
  expect(Alert.alert).toBe(nativeAlert);
});
