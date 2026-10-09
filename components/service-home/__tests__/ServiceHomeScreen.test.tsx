import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement, type ReactElement } from 'react';
import * as ts from 'typescript';

import { COLORS } from '@/lib/theme';

// Native hosts are replaced so these tests exercise the real screen's state and callbacks.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { create } = require('react-test-renderer');
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let dimensions = { width: 390, fontScale: 1 };
const exported: Record<string, unknown> = {};
const output = ts.transpileModule(readFileSync(join(__dirname, '../ServiceHomeScreen.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
new Function('require', 'exports', output)((name: string) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
  if (name === '@expo/vector-icons') return { Feather: 'Feather' };
  if (name === 'react-native') return {
    Image: 'Image', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
    StyleSheet: { create: (styles: unknown) => styles }, useWindowDimensions: () => dimensions,
  };
  if (name === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
  if (name === '@/lib/theme') return { COLORS };
  if (name === './ServiceIcon') return { ServiceIcon: 'ServiceIcon' };
  if (name === '@/assets/images/logo.png') return 'logo';
  throw new Error(`Unexpected dependency: ${name}`);
}, exported);
const Screen = exported.default as (props: Record<string, unknown>) => ReactElement;

function props(overrides: Record<string, unknown> = {}) {
  return {
    isSignedIn: false, bottomInset: 34, navigation: createElement('Navigation'),
    onAccountPress: jest.fn(), onCarePress: jest.fn(), onInsurancePress: jest.fn(),
    onTelecomPress: jest.fn(), onCarPress: jest.fn(), onHelpPress: jest.fn(),
    onResumeInsurancePress: jest.fn(), ...overrides,
  };
}

describe('service home', () => {
  let renderer: ReturnType<typeof create>;
  afterEach(() => { act(() => renderer?.unmount()); dimensions = { width: 390, fontScale: 1 }; });

  it('routes every service entry and keeps account action disabled while loading', () => {
    const input = props({ loading: true });
    act(() => { renderer = create(createElement(Screen, input)); });
    const buttons = renderer.root.findAllByType('Pressable');
    const login = buttons.find((button: { props: Record<string, unknown> }) => button.props.accessibilityLabel === '로그인');
    expect(login.props.disabled).toBe(true);
    const entries = [
      ['가족간병 · 출시 준비 중', input.onCarePress],
      ['보험·FC · FC 전용', input.onInsurancePress],
      ['통신 · 제휴 준비 중', input.onTelecomPress],
      ['자동차 · 제휴 준비 중', input.onCarPress],
      ['가족간병 이용 안내 보기', input.onCarePress],
      ['보험·FC 업무 · FC 전용 · 시험, 서류, 설계', input.onInsurancePress],
      ['이용 안내', input.onHelpPress],
    ];
    for (const [label, callback] of entries) {
      const button = buttons.find((entry: { props: Record<string, unknown> }) => entry.props.accessibilityLabel === label);
      expect(button).toBeDefined();
      act(() => button.props.onPress());
      expect(callback).toHaveBeenCalled();
    }
    expect(renderer.root.findAllByType('Navigation')).toHaveLength(1);
  });

  it('shows resume only for a signed-in user with an available insurance task', () => {
    const input = props({ canResumeInsurance: true });
    act(() => { renderer = create(createElement(Screen, input)); });
    const resumeButtons = () => renderer.root.findAllByType('Pressable').filter((button: { props: Record<string, unknown> }) => button.props.accessibilityLabel === '보험·FC 업무 이어가기');
    expect(resumeButtons()).toHaveLength(0);
    act(() => renderer.update(createElement(Screen, { ...input, isSignedIn: true })));
    expect(resumeButtons()).toHaveLength(1);
    act(() => resumeButtons()[0].props.onPress());
    expect(input.onResumeInsurancePress).toHaveBeenCalledTimes(1);
    expect(renderer.root.findAllByType('Pressable').some((button: { props: Record<string, unknown> }) => button.props.accessibilityLabel === '내 정보')).toBe(true);
  });

  it.each([320, 360, 390, 414, 768])('keeps scroll clearance and readable partner layout at width %i with enlarged text', (width) => {
    dimensions = { width, fontScale: 2 };
    act(() => { renderer = create(createElement(Screen, props())); });
    expect(renderer.root.findByType('SafeAreaView').props.edges).toEqual(['top', 'left', 'right']);
    expect(renderer.root.findByType('ScrollView').props.contentContainerStyle.paddingBottom).toBeGreaterThan(144);
    const views = renderer.root.findAllByType('View');
    expect(views.some((view: { props: { style: unknown } }) => Array.isArray(view.props.style) && view.props.style.some((style: { flexDirection?: string } | undefined) => style?.flexDirection === 'column'))).toBe(true);
  });
});
