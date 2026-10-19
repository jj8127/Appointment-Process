import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement, type ReactElement } from 'react';
import * as ts from 'typescript';

import { resolveBottomNavActiveKey, resolveBottomNavPreset } from '@/lib/bottom-navigation';
import { FAMILY_CARE_PROMOTION_URL, resolveInsuranceServiceRoute } from '@/lib/service-home';

// Exercise the controller callbacks without opening a browser or reading a live session.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { create } = require('react-test-renderer');
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
type Session = {
  role: 'admin' | 'fc' | null;
  hydrated: boolean;
  isRequestBoardDesigner: boolean;
  isPlatformSignedIn?: boolean;
  platformHydrated?: boolean;
  displayName?: string;
  platformMember?: { name: string };
  logout?: jest.Mock;
};
let session: Session = { role: null, hydrated: true, isRequestBoardDesigner: false };
const push = jest.fn();
const replace = jest.fn();
const navigate = jest.fn();
const canGoBack = jest.fn(() => false);
const router = { push, replace, navigate, canGoBack };
const platform = { OS: 'ios' };
const exitApp = jest.fn();
let focusEffects: (() => unknown)[] = [];
let hardwareBackPress: (() => boolean) | undefined;
const openExternalUrl = jest.fn();
const alert = jest.fn();
const load = (file: string): Record<string, unknown> => {
  const exported: Record<string, unknown> = {};
  const output = ts.transpileModule(readFileSync(join(process.cwd(), file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
  new Function('require', 'exports', output)((name: string) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  if (name === 'react' || name === 'react/jsx-runtime') return require(name);
  if (name === 'expo-router') return { Stack: { Screen: 'StackScreen' }, router, useRouter: () => router, useFocusEffect: (effect: () => unknown) => { focusEffects.push(effect); } };
  if (name === '@react-navigation/native') return { useIsFocused: () => true };
  if (name === 'react-native') return { Alert: { alert }, Platform: platform, BackHandler: { exitApp, addEventListener: (_event: string, handler: () => boolean) => { hardwareBackPress = handler; return { remove: jest.fn() }; } } };
  if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ bottom: 34 }) };
  if (name === '@/components/BottomNavigation') return { BottomNavigation: 'BottomNavigation' };
  if (name === '@/components/service-home') return { default: 'ServiceHomeScreen' };
  if (name === '@/hooks/use-session') return { useSession: () => session };
  if (name === '@/hooks/use-app-logout') return load('hooks/use-app-logout.ts');
  if (name === '@/hooks/use-root-exit-confirm') return load('hooks/use-root-exit-confirm.ts');
  if (name === '@/lib/bottom-navigation') return { resolveBottomNavActiveKey, resolveBottomNavPreset };
  if (name === '@/lib/open-external-url') return { openExternalUrl };
  if (name === '@/lib/service-home') return { FAMILY_CARE_PROMOTION_URL, resolveInsuranceServiceRoute };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  if (name === '@/lib/back-navigation') return require('@/lib/back-navigation');
  throw new Error(`Unexpected dependency: ${name}`);
}, exported);
  return exported;
};
const Hub = load('components/ServiceHub.tsx').default as () => ReactElement;

describe('service hub controller', () => {
  let renderer: ReturnType<typeof create>;
  const screenProps = () => renderer.root.findByType('ServiceHomeScreen').props;
  beforeEach(() => {
    session = { role: null, hydrated: true, platformHydrated: true, isRequestBoardDesigner: false };
    push.mockReset();
    replace.mockReset();
    navigate.mockReset();
    openExternalUrl.mockReset().mockResolvedValue(FAMILY_CARE_PROMOTION_URL);
    alert.mockReset();
    canGoBack.mockReset().mockReturnValue(false);
    exitApp.mockReset();
    platform.OS = 'ios';
    focusEffects = [];
    hardwareBackPress = undefined;
  });
  afterEach(() => { act(() => renderer?.unmount()); });
  const render = () => act(() => { renderer = create(createElement(Hub)); });

  it.each([false, true])('asks before Android back closes the app from the root hub (back stack=%s)', (hasBackStack) => {
    platform.OS = 'android';
    canGoBack.mockReturnValue(hasBackStack);
    render();
    focusEffects.forEach((effect) => effect());
    expect(hardwareBackPress!()).toBe(!hasBackStack);
    if (hasBackStack) {
      expect(alert).not.toHaveBeenCalled();
      return;
    }
    expect(alert).toHaveBeenCalledWith('앱을 종료할까요?', undefined, expect.any(Array), { cancelable: true });
    alert.mock.calls[0][2].find((button: { text: string }) => button.text === '종료').onPress();
    expect(exitApp).toHaveBeenCalledTimes(1);
  });

  it('opens care information before promotion or interest registration', () => {
    render();
    act(() => screenProps().onCarePress());
    expect(navigate).toHaveBeenCalledWith({ pathname: '/services/[service]', params: { service: 'care' } });
    expect(openExternalUrl).not.toHaveBeenCalled();
  });

  it('recognizes a common member without granting an FC role', () => {
    session = { role: null, hydrated: true, platformHydrated: true, isRequestBoardDesigner: false, isPlatformSignedIn: true, platformMember: { name: '합성 회원' } };
    render();
    expect(screenProps().isSignedIn).toBe(true);
    expect(screenProps().canResumeInsurance).toBe(false);
    expect(screenProps().accountName).toBe('합성 회원');
    act(() => screenProps().onInsurancePress());
    expect(push).toHaveBeenLastCalledWith({ pathname: '/apply-gate', params: { next: '/?mode=insurance' } });
    act(() => screenProps().onAccountPress());
    expect(navigate).toHaveBeenLastCalledWith('/services/account');
  });

  it('keeps the other information pages as internal routes', () => {
    render();
    for (const [callback, service] of [
      ['onTelecomPress', 'telecom'], ['onRentalPress', 'rental'], ['onCarPress', 'car'], ['onHelpPress', 'help'],
    ]) {
      act(() => screenProps()[callback]());
      expect(navigate).toHaveBeenLastCalledWith({ pathname: '/services/[service]', params: { service } });
    }
    act(() => screenProps().onHospitalPress());
    expect(navigate).toHaveBeenLastCalledWith('/services/hospitals');
    expect(openExternalUrl).not.toHaveBeenCalled();
  });

  it.each([
    [null, false, '/services/login?service=insurance'],
    ['fc', false, { pathname: '/apply-gate', params: { next: '/?mode=insurance' } }],
    ['admin', false, '/?mode=insurance'],
    ['fc', true, '/request-board'],
  ] as const)('keeps insurance and resume routing for role %s, designer %s', (role, designer, expected) => {
    session = { role, hydrated: true, platformHydrated: true, isRequestBoardDesigner: designer };
    render();
    act(() => screenProps().onInsurancePress());
    expect(push).toHaveBeenLastCalledWith(expected);
    act(() => screenProps().onResumeInsurancePress());
    expect(push).toHaveBeenLastCalledWith(expected);
    expect(screenProps().canResumeInsurance).toBe(role === 'fc' && !designer);
  });

  it('waits for hydration before protected insurance navigation and retains account navigation', () => {
    session = { role: null, hydrated: false, isRequestBoardDesigner: false };
    render();
    expect(screenProps().loading).toBe(true);
    act(() => screenProps().onInsurancePress());
    expect(push).not.toHaveBeenCalled();
    session = { role: 'fc', hydrated: true, platformHydrated: true, isPlatformSignedIn: true, isRequestBoardDesigner: false };
    act(() => renderer.update(createElement(Hub)));
    expect(screenProps().loading).toBe(false);
    act(() => screenProps().onAccountPress());
    expect(navigate).toHaveBeenLastCalledWith('/services/account');
  });
  it('opens common login for a verified guest and blocks account navigation while restoration is pending', () => {
    render();
    act(() => screenProps().onAccountPress());
    expect(navigate).toHaveBeenLastCalledWith('/services/login');
    session = { ...session, platformHydrated: false };
    act(() => renderer.update(createElement(Hub)));
    navigate.mockClear();
    expect(screenProps().loading).toBe(true);
    act(() => screenProps().onAccountPress());
    expect(navigate).not.toHaveBeenCalled();
  });
  it.each([null, 'fc'] as const)('header logout clears %s session once and returns to common home after local clearing', role => {
    const logout = jest.fn(() => { session = { ...session, role: null, isPlatformSignedIn: false }; });
    session = { role, hydrated: true, platformHydrated: true, isPlatformSignedIn: true, isRequestBoardDesigner: false, logout };
    render();
    expect(replace).not.toHaveBeenCalled();
    act(() => { screenProps().onLogoutPress(); screenProps().onLogoutPress(); });
    expect(logout).toHaveBeenCalledTimes(1);
    act(() => renderer.update(createElement(Hub)));
    expect(replace).toHaveBeenCalledWith('/');
    expect(screenProps().isSignedIn).toBe(false);
  });
  it.each(['onAccountPress', 'onHospitalPress', 'onCarePress'])('repeat %s uses reusable leaf navigation, never PUSH', callback => {
    render();
    act(() => { screenProps()[callback](); screenProps()[callback](); });
    expect(navigate).toHaveBeenCalledTimes(2);
    expect(navigate.mock.calls[0]).toEqual(navigate.mock.calls[1]);
    expect(push).not.toHaveBeenCalled();
  });
});
