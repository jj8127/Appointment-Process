import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement, type ReactElement } from 'react';
import * as ts from 'typescript';

import { INSURANCE_HOME_ROUTE } from '@/lib/service-home';
import { COLORS, SHADOWS } from '@/lib/theme';

// Exercise the real navigation callbacks with fictional routes and native hosts.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { create } = require('react-test-renderer');
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const router = { push: jest.fn(), replace: jest.fn(), setParams: jest.fn() };
let pathname = '/board';
const exported: Record<string, unknown> = {};
const output = ts.transpileModule(readFileSync(join(__dirname, '../BottomNavigation.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
new Function('require', 'exports', output)((name: string) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  if (name === 'react/jsx-runtime') return require(name);
  if (name === '@expo/vector-icons') return { Feather: 'Feather' };
  if (name === 'expo-router') return { useRouter: () => router, usePathname: () => pathname };
  if (name === 'react-native') return { Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: (styles: unknown) => styles } };
  if (name === 'react-native-reanimated') return { default: { View: 'AnimatedView' } };
  if (name === '@/lib/service-home') return { INSURANCE_HOME_ROUTE };
  if (name === '@/lib/theme') return { COLORS, SHADOWS };
  throw new Error(`Unexpected dependency: ${name}`);
}, exported);
const Navigation = exported.BottomNavigation as (props: Record<string, unknown>) => ReactElement;

describe('bottom navigation service context', () => {
  let renderer: ReturnType<typeof create>;
  const mount = (props: Record<string, unknown>) => act(() => { renderer = create(createElement(Navigation, props)); });
  const press = (label: string) => act(() => renderer.root.findAllByType('Pressable').find((item: { props: Record<string, unknown> }) => item.props.accessibilityLabel === label).props.onPress());
  beforeEach(() => { pathname = '/board'; Object.values(router).forEach((callback) => callback.mockReset()); });
  afterEach(() => { act(() => renderer?.unmount()); });

  it.each(['/board', '/request-board', '/settings'])('returns FC from %s to the insurance home', (current) => {
    pathname = current;
    mount({ preset: 'fc', activeKey: 'board' });
    press('홈');
    expect(router.replace).toHaveBeenCalledWith({ pathname: '/', params: { mode: 'insurance' } });
    expect(router.push).not.toHaveBeenCalled();
  });

  it('changes the FC home mode on the root path without adding a stack entry', () => {
    pathname = '/';
    mount({ preset: 'fc', activeKey: 'home' });
    press('홈');
    expect(router.setParams).toHaveBeenCalledWith({ mode: 'insurance' });
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('keeps the public home inside the public service surface', () => {
    pathname = '/services/activity';
    mount({ preset: 'service-hub', activeKey: 'activity' });
    const buttons = renderer.root.findAllByType('Pressable');
    expect(buttons.find((item: { props: Record<string, unknown> }) => item.props.accessibilityLabel === '이용내역').props['aria-current']).toBe('page');
    expect(buttons.find((item: { props: Record<string, unknown> }) => item.props.accessibilityLabel === '홈').props['aria-current']).toBeUndefined();
    press('홈');
    expect(router.push).toHaveBeenCalledWith('/');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it.each(['admin-onboarding', 'admin-exam', 'manager'])('preserves %s onboarding and exam routing', (preset) => {
    pathname = '/admin-board-manage';
    mount({ preset, activeKey: 'board' });
    press('위촉');
    expect(router.replace).toHaveBeenLastCalledWith({ pathname: '/', params: { mode: 'onboarding' } });
    press('시험');
    expect(router.replace).toHaveBeenLastCalledWith({ pathname: '/', params: { mode: 'exam' } });
  });

  it('uses the existing in-place administrator tab callback', () => {
    const onAdminTabChange = jest.fn();
    mount({ preset: 'admin-onboarding', activeKey: 'onboarding', onAdminTabChange });
    press('시험');
    expect(onAdminTabChange).toHaveBeenCalledWith('exam');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('retains the designer menu and custom callback precedence', () => {
    mount({ preset: 'request-board-designer', activeKey: 'request-board' });
    expect(renderer.root.findAllByType('Pressable').map((item: { props: Record<string, unknown> }) => item.props.accessibilityLabel)).toEqual(['설계요청', '설정']);
    const onPress = jest.fn();
    act(() => renderer.update(createElement(Navigation, { activeKey: 'custom', items: [{ key: 'custom', label: '선택', icon: 'home', route: '/', onPress }] })));
    press('선택');
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();
  });
});
