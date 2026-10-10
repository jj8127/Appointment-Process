import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement, type ReactElement } from 'react';
import * as React from 'react';
import * as ts from 'typescript';
import { resolveBottomNavActiveKey, resolveBottomNavPreset } from '../bottom-navigation';
import { COLORS, TYPOGRAPHY, SPACING, RADIUS } from '../theme';

type Instance = { children: (Instance | string)[]; props: Record<string, unknown>; findAllByType: (type: string) => Instance[] };
type Renderer = { root: Instance; unmount: () => void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { create } = require('react-test-renderer') as { create: (element: ReactElement) => Renderer };
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const root = join(__dirname, '../..');

function executeComponent(path: string, dependencies: Record<string, unknown> = {}) {
  const exported: Record<string, unknown> = {};
  const code = ts.transpileModule(readFileSync(join(root, path), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  new Function('require', 'exports', code)((name: string) => {
    if (name in dependencies) return dependencies[name];
    if (name === 'react') return React;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (name === 'react-native') return { ActivityIndicator: 'ActivityIndicator', Linking: { openURL: jest.fn() }, Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: (styles: unknown) => styles } };
    if (name === 'react-native-webview') return { default: 'WebView' };
    if (name === '@/lib/daum-postcode') return { shouldEnableDaumPostcodeDebugUi: () => false, shouldStayInDaumPostcodeWebView: () => true };
    if (name === '@/lib/logger') return { logger: { debug: jest.fn(), warn: jest.fn() } };
    throw new Error(`Unexpected component dependency ${name}`);
  }, exported);
  return (exported.default ?? exported.DaumPostcode) as (props: Record<string, unknown>) => ReactElement;
}

function texts(instance: Instance) {
  return instance.findAllByType('Text').map((node) => node.children.filter((child) => typeof child === 'string').join(''));
}

it('M10 account delete confirmation explains retained history and cancel performs no write', async () => {
  const file = ts.createSourceFile('settings.tsx', readFileSync(join(root, 'app/settings.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback = ''; let modal = '';
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'handleDelete') callback = node.initializer!.getText(file);
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === 'Modal') modal = node.getText(file);
    ts.forEachChild(node, visit);
  }
  visit(file);
  const setShowDeleteConfirm = jest.fn(); const confirmDelete = jest.fn();
  const execute = (code: string, dependencies: Record<string, unknown>) => new Function('exports', ...Object.keys(dependencies), ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText)({}, ...Object.values(dependencies));
  const open = execute(`return (${callback});`, { canDeleteAccount: true, residentId: 'synthetic-actor', appSessionToken: 'synthetic-session', Alert: { alert: jest.fn() }, setShowDeleteConfirm }) as () => void;
  open(); expect(setShowDeleteConfirm).toHaveBeenCalledWith(true);
  const Modal = execute(`return function Render() { return (${modal}); };`, {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require: (name: string) => { if (name === 'react/jsx-runtime') return require('react/jsx-runtime'); throw new Error(name); },
    Modal: 'Modal', View: 'View', Text: 'Text', Pressable: 'Pressable', styles: {}, showDeleteConfirm: true, deleting: false, setShowDeleteConfirm, confirmDelete,
  }) as () => ReactElement;
  let renderer!: Renderer;
  await act(async () => { renderer = create(createElement(Modal)); });
  expect(texts(renderer.root).some((text) => text.includes('계정 로그인과 연결된 프로필은 삭제됩니다.') && text.includes('일부 기록은 남을 수 있습니다.'))).toBe(true);
  const cancel = renderer.root.findAllByType('Pressable').find((node) => texts(node).includes('취소'))!;
  await act(async () => { (cancel.props.onPress as () => void)(); });
  expect(setShowDeleteConfirm).toHaveBeenLastCalledWith(false);
  expect(confirmDelete).not.toHaveBeenCalled();
  await act(async () => { renderer.unmount(); });
});

it.each([
  ['fc', false, false, 'fc'],
  ['admin', false, false, 'admin-onboarding'],
  ['admin', true, false, 'manager'],
  ['fc', false, true, 'request-board-designer'],
] as const)('public account keeps its navigation surface for %s, readonly %s, designer %s', async (role, readOnly, isRequestBoardDesigner, protectedPreset) => {
  const session = { role, readOnly, isRequestBoardDesigner, hydrated: true, residentId: '', displayName: '합성 계정', staffType: null, appSessionToken: null };
  let surface: string | undefined = 'service-hub';
  const router = { push: jest.fn() };
  const Settings = executeComponent('app/settings.tsx', {
    '@expo/vector-icons': { Feather: 'Feather' },
    'expo-router': { router, useLocalSearchParams: () => ({ surface }) },
    'react-native': { Alert: { alert: jest.fn() }, Modal: 'Modal', Pressable: 'Pressable', Text: 'Text', View: 'View', Share: { share: jest.fn() }, StyleSheet: { create: (styles: unknown) => styles } },
    'expo-clipboard': { setStringAsync: jest.fn() },
    'react-native-reanimated': { default: { ScrollView: 'ScrollView' } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ bottom: 0 }) },
    '@/components/BottomNavigation': { BottomNavigation: 'BottomNavigation' },
    '@/hooks/use-app-logout': { useAppLogout: () => jest.fn() },
    '@/hooks/use-bottom-nav-animation': { useBottomNavAnimation: () => ({ scrollHandler: jest.fn(), animatedStyle: {} }) },
    '@/hooks/use-my-referral-code': { useMyReferralCode: () => ({ data: null, isLoading: false, error: null }) },
    '@/hooks/use-session': { useSession: () => session },
    '@/lib/bottom-navigation': { resolveBottomNavActiveKey, resolveBottomNavPreset },
    '@/lib/referral-share': { buildReferralShareText: jest.fn() },
    '@/lib/staff-identity': { getAccountRoleLabel: () => '합성 역할' },
    '@/lib/supabase': { supabase: {} },
    '@/lib/theme': { COLORS, TYPOGRAPHY, SPACING, RADIUS },
  });
  let renderer!: Renderer;
  await act(async () => { renderer = create(createElement(Settings)); });
  const navigation = () => renderer.root.findAllByType('BottomNavigation')[0];
  expect(navigation().props.preset).toBe('service-hub');
  expect(navigation().props.activeKey).toBe('settings');
  surface = undefined;
  await act(async () => { renderer.unmount(); renderer = create(createElement(Settings)); });
  expect(navigation().props.preset).toBe(protectedPreset);
  await act(async () => { renderer.unmount(); });
});

it('public account redirects to settings with its surface after session hydration', async () => {
  let session = { hydrated: false, role: 'fc' as string | null };
  const Account = executeComponent('app/services/account.tsx', {
    'expo-router': { Redirect: 'Redirect' },
    '@/components/BrandedLoadingState': { default: 'Loading' },
    '@/hooks/use-session': { useSession: () => session },
  });
  let renderer!: Renderer;
  await act(async () => { renderer = create(createElement(Account)); });
  expect(renderer.root.findAllByType('Redirect')).toHaveLength(0);
  session = { hydrated: true, role: 'fc' };
  await act(async () => { renderer.unmount(); renderer = create(createElement(Account)); });
  expect(renderer.root.findAllByType('Redirect')[0].props.href).toBe('/settings?surface=service-hub');
  session = { hydrated: true, role: null };
  await act(async () => { renderer.unmount(); renderer = create(createElement(Account)); });
  expect(renderer.root.findAllByType('Redirect')[0].props.href).toBe('/login');
  await act(async () => { renderer.unmount(); });
});

describe('M06 / D10 actual address-search component controls', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it.each(['script', 'timeout'])('shows retry and close after %s failure, then accepts an address', async (failure) => {
    const Postcode = executeComponent('components/DaumPostcode.tsx');
    const onSelected = jest.fn(); const onError = jest.fn(); const onClose = jest.fn();
    let renderer!: Renderer;
    await act(async () => { renderer = create(createElement(Postcode, { onSelected, onError, onClose })); });
    expect(texts(renderer.root)).toContain('주소 검색을 준비하고 있습니다.');
    const webview = () => renderer.root.findAllByType('WebView')[0];
    await act(async () => {
      if (failure === 'timeout') jest.advanceTimersByTime(20_000);
      else (webview().props.onMessage as (event: unknown) => void)({ nativeEvent: { data: '__postcode_state__:error' } });
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(texts(renderer.root)).toEqual(expect.arrayContaining(['다시 시도', '주소 검색 닫기', '주소 검색을 불러오지 못했습니다. 입력한 주소는 그대로 유지됩니다.']));
    const button = (label: string) => renderer.root.findAllByType('Pressable').find((node) => texts(node).includes(label))!;
    await act(async () => { (button('주소 검색 닫기').props.onPress as () => void)(); });
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => { (button('다시 시도').props.onPress as () => void)(); });
    expect(texts(renderer.root)).toContain('주소 검색을 준비하고 있습니다.');
    await act(async () => { (webview().props.onMessage as (event: unknown) => void)({ nativeEvent: { data: '__postcode_state__:ready' } }); });
    await act(async () => { jest.advanceTimersByTime(20_000); });
    expect(onError).toHaveBeenCalledTimes(1);
    const address = { address: '공개 시험 건물', zonecode: '00000' };
    await act(async () => { (webview().props.onMessage as (event: unknown) => void)({ nativeEvent: { data: JSON.stringify(address) } }); });
    expect(onSelected).toHaveBeenCalledWith(address);
    await act(async () => { renderer.unmount(); });
  });
});
