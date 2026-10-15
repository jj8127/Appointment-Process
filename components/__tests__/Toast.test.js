/* global __dirname, jest, beforeEach, afterEach, test, expect */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');

global.IS_REACT_ACT_ENVIRONMENT = true;
const nativeAlert = jest.fn();
const announce = jest.fn();
const setStringAsync = jest.fn();
const platform = { OS: 'ios', Version: '17.0' };
const animation = { duration() { return this; }, springify() { return this; } };
const gesture = new Proxy({}, { get: () => () => gesture });
const reanimated = {
  default: { View: 'AnimatedView' },
  SlideInUp: animation, SlideOutUp: animation,
  useSharedValue: (value) => React.useRef({ value }).current,
  useAnimatedStyle: (getStyle) => getStyle(),
  withSpring: (value) => value,
  withTiming: (value) => value,
  runOnJS: (callback) => callback,
};
const modules = {};
function load(relativePath) {
  if (modules[relativePath]) return modules[relativePath];
  const source = fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  } }).outputText;
  const exports = {};
  modules[relativePath] = exports;
  new Function('require', 'exports', code)((name) => {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (name === 'react-native') return {
      AccessibilityInfo: { announceForAccessibility: announce },
      Alert: { alert: nativeAlert },
      Dimensions: { get: () => ({ width: 360 }) },
      Platform: platform,
      StyleSheet: { create: (styles) => styles },
      Text: 'Text', View: 'View',
    };
    if (name === 'react-native-reanimated') return { __esModule: true, ...reanimated };
    if (name === 'react-native-gesture-handler') return {
      Gesture: { Pan: () => gesture },
      GestureDetector: ({ children }) => children,
    };
    if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 0 }) };
    if (name === '@/components/StatusGlyph') return { default: () => null, __esModule: true };
    if (name === '@/components/Toast') return load('../Toast.tsx');
    if (name === '@/lib/theme') return load('../../lib/theme.ts');
    if (name === '@/lib/logger') return { logger: { warn: jest.fn() } };
    if (name === 'expo-clipboard') return { setStringAsync };
    throw new Error(`Unexpected dependency: ${name}`);
  }, exports);
  return exports;
}
const { ToastProvider, showToast } = load('../Toast.tsx');
const { copyTextWithFeedback } = load('../../lib/messenger-copy-actions.ts');

let root;
function visibleMessages() {
  return root.root.findAllByType('Text')
    .filter((node) => node.props.numberOfLines === 2)
    .map((node) => node.props.children);
}
beforeEach(async () => {
  jest.useFakeTimers();
  nativeAlert.mockClear(); announce.mockClear(); setStringAsync.mockReset();
  Object.assign(platform, { OS: 'ios', Version: '17.0' });
  await act(async () => { root = create(React.createElement(ToastProvider, null, React.createElement('Home'))); });
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  jest.useRealTimers();
});

test('repeating the same toast replaces it instead of stacking, and is announced', async () => {
  await act(async () => {
    showToast({ message: '메시지를 복사했습니다.', variant: 'success' });
    showToast({ message: '메시지를 복사했습니다.', variant: 'success' });
    showToast({ message: '링크를 클립보드에 복사했습니다.', variant: 'success' });
  });
  expect(visibleMessages()).toEqual(['메시지를 복사했습니다.', '링크를 클립보드에 복사했습니다.']);
  expect(announce).toHaveBeenCalledWith('메시지를 복사했습니다.');
  expect(nativeAlert).not.toHaveBeenCalled();
});

test('toast dismisses itself without a blocking alert', async () => {
  await act(async () => showToast({ message: '임시사번을 복사했습니다.', variant: 'success', duration: 2000 }));
  expect(visibleMessages()).toHaveLength(1);
  await act(async () => { jest.advanceTimersByTime(2100); });
  expect(visibleMessages()).toHaveLength(0);
});

test('without a mounted provider the message still reaches the user', async () => {
  await act(async () => root.unmount());
  root = null;
  showToast({ message: '추천 코드를 복사했습니다.' });
  expect(nativeAlert).toHaveBeenCalledWith('추천 코드를 복사했습니다.');
});

test('copy helper reports success, empty and failure as toasts', async () => {
  setStringAsync.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('clipboard unavailable'));
  let results;
  await act(async () => {
    results = [
      await copyTextWithFeedback('안녕하세요'),
      await copyTextWithFeedback('   '),
      await copyTextWithFeedback('다시 시도', { failureMessage: '복사하지 못했습니다.' }),
    ];
  });
  expect(results).toEqual([true, false, false]);
  expect(setStringAsync).toHaveBeenCalledTimes(2);
  expect(visibleMessages()).toEqual(['메시지를 복사했습니다.', '복사할 메시지 내용이 없습니다.', '복사하지 못했습니다.']);
  expect(nativeAlert).not.toHaveBeenCalled();
});

test("feedback 'none' leaves the result to the calling control", async () => {
  setStringAsync.mockResolvedValueOnce(undefined);
  let copied;
  await act(async () => { copied = await copyTextWithFeedback('https://example.test/a.jpg', { feedback: 'none' }); });
  expect(copied).toBe(true);
  expect(visibleMessages()).toHaveLength(0);
});

test('Android 13+ leaves copy success to the system confirmation but still reports empty and failed copies', async () => {
  setStringAsync.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('clipboard unavailable'));
  let results;
  await act(async () => {
    Object.assign(platform, { OS: 'android', Version: 33 });
    results = [
      await copyTextWithFeedback('안녕하세요'),
      await copyTextWithFeedback(''),
      await copyTextWithFeedback('다시 시도', { failureMessage: '복사하지 못했습니다.' }),
    ];
  });
  expect(results).toEqual([true, false, false]);
  expect(visibleMessages()).toEqual(['복사할 메시지 내용이 없습니다.', '복사하지 못했습니다.']);
});

test('Android 12 and lower still show the app success toast', async () => {
  setStringAsync.mockResolvedValueOnce(undefined);
  await act(async () => {
    Object.assign(platform, { OS: 'android', Version: 32 });
    await copyTextWithFeedback('안녕하세요');
  });
  expect(visibleMessages()).toEqual(['메시지를 복사했습니다.']);
});
