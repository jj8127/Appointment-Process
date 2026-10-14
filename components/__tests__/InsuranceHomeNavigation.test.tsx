import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { act, createElement, type ReactElement } from 'react';
import * as ts from 'typescript';

import * as bottomNavigation from '@/lib/bottom-navigation';
import * as examRole from '@/lib/exam-role';
import * as fcWorkflow from '@/lib/fc-workflow';
import * as homeGuide from '@/lib/home-guide-ui';
import { formatHomeCount } from '@/lib/home-read-state';
import { formatLicenseStatuses } from '@/lib/license-statuses';
import { buildWelcomeTitle } from '@/lib/welcome-title';

// Render the actual protected home with fictional session/query state. No
// effects or query functions run, so no production API or account is accessed.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { create } = require('react-test-renderer');
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const router = { push: jest.fn(), replace: jest.fn(), setParams: jest.fn(), canGoBack: jest.fn() };
const alert = jest.fn();
let focusEffects: (() => unknown)[] = [];
let hardwareBackPress: (() => boolean) | undefined;
let session = { role: 'fc', residentId: '', hydrated: true, readOnly: false, isRequestBoardDesigner: false, displayName: '합성 FC' };
let queryState: 'loading' | 'success' | 'error' = 'loading';
const refetch = jest.fn();
const nativeHosts = {
  Pressable: 'Pressable', Text: 'Text', View: 'View', RefreshControl: 'RefreshControl',
  Platform: { OS: 'web' }, Dimensions: { get: () => ({ width: 390, height: 844 }) },
  Alert: { alert },
  BackHandler: { exitApp: jest.fn(), addEventListener: (_event: string, handler: () => boolean) => { hardwareBackPress = handler; return { remove: jest.fn() }; } },
  StyleSheet: { create: (styles: unknown) => styles, absoluteFillObject: {} },
};
const dependencies: Record<string, unknown> = {
  react: { ...React, useEffect: () => {} },
  'react-native': nativeHosts,
  'react-native-reanimated': { default: { ScrollView: 'AnimatedScrollView' }, useAnimatedRef: React.useRef },
  '@expo/vector-icons': { Feather: 'Feather' },
  'expo-haptics': { selectionAsync: jest.fn() },
  'expo-router': { router, Stack: { Screen: 'StackScreen' }, useFocusEffect: (effect: () => unknown) => { focusEffects.push(effect); }, useLocalSearchParams: () => ({ mode: 'insurance' }) },
  moti: { MotiView: 'MotiView' },
  'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 0, bottom: 34 }) },
  'rn-tourguide': { TourGuideZone: 'TourGuideZone', useTourGuideController: () => ({ TourGuideZone: 'ShortcutZone' }) },
  '@tanstack/react-query': { useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryState !== 'success' ? undefined : queryKey[0] === 'latest-notice' ? { id: 'fictional-notice', title: '합성 공지' } : queryKey[0].startsWith('unread-') ? 0 : null,
    isLoading: queryState === 'loading', isError: queryState === 'error', isSuccess: queryState === 'success', refetch,
  }) },
  '@/hooks/use-session': { useSession: () => session },
  '@/hooks/use-app-logout': { useAppLogout: () => jest.fn() },
  '@/hooks/use-identity-status': { useIdentityStatus: () => ({ data: { identityCompleted: true } }) },
  '@/hooks/use-read-session-scope': { useReadSessionScope: () => 'fictional-scope' },
  '@/lib/bottom-navigation': bottomNavigation,
  '@/lib/exam-role': examRole,
  '@/lib/fc-workflow': fcWorkflow,
  '@/lib/home-guide-ui': homeGuide,
  '@/lib/home-read-state': { formatHomeCount },
  '@/lib/home-latest-notice': { formatLatestNoticeLabel: () => '합성 공지' },
  '@/lib/license-statuses': { formatLicenseStatuses },
  '@/lib/welcome-title': { buildWelcomeTitle },
  '@/lib/notification-inbox-scope': { resolveNotificationInboxResidentId: () => '' },
  '@/lib/notification-receipt-ui': { NotificationReceiptStatusBanner: 'ReceiptBanner' },
  '@/lib/use-notification-receipt': { useNotificationReceiptCompletion: () => ({ state: 'idle' }) },
};
const hookExports: Record<string, unknown> = {};
new Function('require', 'exports', ts.transpileModule(readFileSync(join(__dirname, '../../hooks/use-root-exit-confirm.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText)((name: string) => dependencies[name], hookExports);
dependencies['@/hooks/use-root-exit-confirm'] = hookExports;
const exported: Record<string, unknown> = {};
const output = ts.transpileModule(`${readFileSync(join(__dirname, '../../app/index.tsx'), 'utf8')}\nexports.InsuranceHome = LegacyInsuranceHome;`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
new Function('require', 'exports', output)((name: string) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  if (name === 'react/jsx-runtime') return require(name);
  if (name in dependencies) return dependencies[name];
  if (name.startsWith('@/components/')) return new Proxy({}, { get: (_, key) => String(key) });
  return {};
}, exported);
const Home = exported.InsuranceHome as () => ReactElement;

describe('insurance home persistent navigation', () => {
  let renderer: ReturnType<typeof create>;
  const mount = () => act(() => { renderer = create(createElement(Home)); });
  const navigation = () => renderer.root.findByType('BottomNavigation');
  const scroll = () => renderer.root.findByType('AnimatedScrollView');
  beforeEach(() => { queryState = 'loading'; session = { ...session, role: 'fc', readOnly: false }; Object.values(router).forEach((callback) => callback.mockReset()); alert.mockReset(); focusEffects = []; hardwareBackPress = undefined; nativeHosts.Platform.OS = 'web'; });
  afterEach(() => { act(() => renderer?.unmount()); });

  it('keeps the bar visible while stationary query states change the content layout', () => {
    mount();
    for (const next of ['success', 'error', 'loading', 'success'] as const) {
      queryState = next;
      act(() => renderer.update(createElement(Home)));
      expect(navigation().props.preset).toBe('fc');
      expect(navigation().props.activeKey).toBe('home');
      expect(navigation().props.animatedStyle).toBeUndefined();
      expect(scroll().props.onScroll).toBeUndefined();
    }
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('bounds the scrolling body and reserves space below its final content', () => {
    mount();
    expect(scroll().props.style.flex).toBe(1);
    const content = scroll().findAllByType('View').find((view: { props: Record<string, unknown> }) => view.props.collapsable === false && Array.isArray(view.props.style));
    expect(content.props.style[1].paddingBottom).toBe(96 + 34);
    expect(navigation().props.bottomInset).toBe(34);
  });

  it('shows the insurance context and offers a separate 44px public home action', () => {
    mount();
    expect(renderer.root.findAllByType('Text').some((text: { children: string[] }) => text.children.includes('보험·FC'))).toBe(true);
    const button = renderer.root.findAllByType('Pressable').find((item: { props: Record<string, unknown> }) => item.props.accessibilityLabel === '전체 서비스');
    expect(button.props.style({ pressed: false })[0].minHeight).toBe(44);
    act(() => button.props.onPress());
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  it.each([true, false])('lets Android return to its previous screen when a back stack exists (%s)', (canGoBack) => {
    nativeHosts.Platform.OS = 'android';
    router.canGoBack.mockReturnValue(canGoBack);
    mount();
    focusEffects.forEach((effect) => effect());
    expect(hardwareBackPress!()).toBe(!canGoBack);
    if (canGoBack) expect(alert).not.toHaveBeenCalled();
    else expect(alert).toHaveBeenCalledWith('앱을 종료할까요?', undefined, expect.any(Array), { cancelable: true });
    expect(router.replace).not.toHaveBeenCalled();
  });

  it.each([false, true])('keeps administrator tab changes in the insurance home (readOnly=%s)', (readOnly) => {
    session = { ...session, role: 'admin', readOnly };
    mount();
    expect(navigation().props.preset).toBe(readOnly ? 'manager' : 'admin-onboarding');
    act(() => navigation().props.onAdminTabChange('exam'));
    expect(navigation().props.activeKey).toBe('exam');
    expect(navigation().props.preset).toBe(readOnly ? 'manager' : 'admin-exam');
    expect(navigation().props.animatedStyle).toBeUndefined();
    expect(router.setParams).toHaveBeenCalledWith({ mode: 'exam' });
  });
});
