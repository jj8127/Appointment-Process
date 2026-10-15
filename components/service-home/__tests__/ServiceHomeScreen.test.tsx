import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement, type ReactElement } from 'react';
import * as ts from 'typescript';

import { COLORS } from '@/lib/theme';

// Exercise actual hooks and callbacks with deterministic native host substitutes.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { create } = require('react-test-renderer');
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let dimensions = { width: 390, fontScale: 1 };
const platform = { OS: 'ios' };
let focused = true;
let reduced = false;
const appState = { currentState: 'active' };
let appListener: (next: string) => void;
let motionListener: (next: boolean) => void;
const removedAppListener = jest.fn();
const removedMotionListener = jest.fn();
const nativeHosts = {
  Image: 'Image', Platform: platform, Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, absoluteFillObject: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 } }, useWindowDimensions: () => dimensions,
  AppState: { ...appState, addEventListener: (_: string, listener: typeof appListener) => { appListener = listener; return { remove: removedAppListener }; } },
  AccessibilityInfo: {
    isReduceMotionEnabled: () => ({ then: (listener: (value: boolean) => void) => { listener(reduced); return { catch: () => {} }; } }),
    addEventListener: (_: string, listener: typeof motionListener) => { motionListener = listener; return { remove: removedMotionListener }; },
  },
};
function loadComponent(filename: string) {
  const exported: Record<string, unknown> = {};
  const output = ts.transpileModule(readFileSync(join(__dirname, `../${filename}`), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function('require', 'exports', output)((name: string) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    if (name === 'expo-linear-gradient') return { LinearGradient: 'LinearGradient' };
    if (name.startsWith('@/assets/images/service-home/banners/')) return name;
    if (name === '@/assets/images/moduon/moduon-symbol.png') return 'moduon-symbol';
    if (name === '@/components/ModuonBrand') return loadComponent('../ModuonBrand.tsx');
    if (name === '@expo/vector-icons') return { Feather: 'Feather' };
    if (name === 'react-native') return nativeHosts;
    if (name === '@react-navigation/native') return { useIsFocused: () => focused };
    if (name === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
    if (name === '@/lib/theme') return { COLORS };
    if (name === './ServiceIcon') return { ServiceIcon: 'ServiceIcon' };
    if (name === './useServicePromotionPager') return loadComponent('useServicePromotionPager.ts');
    if (name === '@/adminWebLogo.png') return 'hanwha-wordmark';
    throw new Error(`Unexpected dependency: ${name}`);
  }, exported);
  return exported;
}
const exported = loadComponent('ServiceHomeScreen.tsx');
const Screen = exported.default as (props: Record<string, unknown>) => ReactElement;
function props(overrides: Record<string, unknown> = {}) {
  return {
    isSignedIn: false, bottomInset: 34, navigation: createElement('Navigation'),
    onAccountPress: jest.fn(), onCarePress: jest.fn(), onInsurancePress: jest.fn(),
    onTelecomPress: jest.fn(), onCarPress: jest.fn(), onRentalPress: jest.fn(), onHospitalPress: jest.fn(), onHelpPress: jest.fn(),
    onResumeInsurancePress: jest.fn(), ...overrides,
  };
}

describe('service selection and promotion carousel', () => {
  let renderer: ReturnType<typeof create>;
  let scrollTo: jest.Mock;
  let surface: EventTarget & { setPointerCapture: jest.Mock; releasePointerCapture: jest.Mock; hasPointerCapture: jest.Mock };
  let browserWindow: EventTarget;
  let browserDocument: EventTarget & { visibilityState: string; hasFocus: jest.Mock };
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  function pointer(target: EventTarget, type: string, data: Record<string, unknown> = {}) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: 220, clientY: 100 }, data);
    act(() => { target.dispatchEvent(event); });
    return event;
  }
  function mount(input = props()) {
    scrollTo = jest.fn();
    surface = Object.assign(new EventTarget(), { setPointerCapture: jest.fn(), releasePointerCapture: jest.fn(), hasPointerCapture: jest.fn(() => true) });
    browserWindow = new EventTarget();
    browserDocument = Object.assign(new EventTarget(), { visibilityState: 'visible', hasFocus: jest.fn(() => true) });
    if (platform.OS === 'web') {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: browserWindow });
      Object.defineProperty(globalThis, 'document', { configurable: true, value: browserDocument });
    }
    act(() => { renderer = create(createElement(Screen, input), { createNodeMock: (node: { type: unknown; props: Record<string, unknown> }) => node.type === 'ScrollView' ? { scrollTo } : node.type === 'View' && node.props.onLayout ? surface : null }); });
  }
  const button = (label: string) => renderer.root.findAllByType('Pressable').find((entry: { props: Record<string, unknown> }) => entry.props.accessibilityLabel === label);
  const pager = () => renderer.root.findAllByType('ScrollView').find((entry: { props: Record<string, unknown> }) => entry.props.horizontal);
  function layout(width: number) {
    const viewport = renderer.root.findAllByType('View').find((entry: { props: Record<string, unknown> }) => entry.props.onLayout);
    act(() => viewport.props.onLayout({ nativeEvent: { layout: { width } } }));
  }
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { act(() => renderer?.unmount()); dimensions = { width: 390, fontScale: 1 }; platform.OS = 'ios'; focused = true; reduced = false; jest.useRealTimers(); jest.clearAllMocks(); if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window'); if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else Reflect.deleteProperty(globalThis, 'document'); });

  it('has six equal entries, no separate FC action and a blocked loading account', () => {
    const input = props({ loading: true }); mount(input);
    expect(button('로그인').props.disabled).toBe(true);
    const entries = [
      ['가족간병 · 준비 중', input.onCarePress], ['보험 · FC 업무', input.onInsurancePress],
      ['통신 · 준비 중', input.onTelecomPress], ['렌탈 · 준비 중', input.onRentalPress],
      ['자동차 · 준비 중', input.onCarPress], ['제휴병원 · 지역별 안내', input.onHospitalPress],
    ];
    const entryStyles = entries.map(([label]) => button(label as string).props.style({ pressed: false })[0]);
    expect(entryStyles.every((style) => style === entryStyles[0])).toBe(true);
    expect(entryStyles[0].width).toBe('33.333%');
    for (const [label, callback] of entries) {
      act(() => button(label as string).props.onPress()); expect(callback).toHaveBeenCalledTimes(1);
    }
    expect(button('FC 업무로 이동')).toBeUndefined();
    expect(renderer.root.findAllByType('Navigation')).toHaveLength(1);
  });

  it('resumes insurance only for a signed-in user while preserving equal menu identity', () => {
    const input = props({ canResumeInsurance: true }); mount(input);
    act(() => button('보험 · FC 업무').props.onPress());
    expect(input.onInsurancePress).toHaveBeenCalledTimes(1);
    act(() => renderer.update(createElement(Screen, { ...input, isSignedIn: true })));
    act(() => button('보험 · FC 업무').props.onPress());
    expect(input.onResumeInsurancePress).toHaveBeenCalledTimes(1);
    expect(button('내 정보')).toBeDefined();
  });

  it('uses measured width and loops forward through a non-interactive clone', () => {
    mount(); layout(350);
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 350, animated: false });
    act(() => pager().props.onScroll({ nativeEvent: { contentOffset: { x: 1400 } } }));
    expect(pager().props.accessibilityValue.now).toBe(4);
    act(() => button('다음 서비스 소개').props.onPress());
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 1750, animated: true });
    expect(pager().props.accessibilityValue.now).toBe(1);
    act(() => pager().props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 1750 } } }));
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 350, animated: false });
    act(() => button('이전 서비스 소개').props.onPress());
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 0, animated: true });
    act(() => pager().props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 0 } } }));
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 1400, animated: false });
    expect(pager().props.accessibilityValue.now).toBe(4);
    const copies = renderer.root.findAllByType('Pressable').filter((entry: { props: Record<string, unknown> }) => entry.props.accessible === false);
    expect(copies).toHaveLength(2);
    copies.forEach((entry: { props: Record<string, unknown> }) => { expect(entry.props.disabled).toBe(true); expect(entry.props.tabIndex).toBe(-1); expect(entry.props['aria-hidden']).toBe(true); });
  });

  it('keeps the selected service after resize and exposes screen-reader paging', () => {
    mount(); layout(350);
    act(() => pager().props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
    expect(pager().props.accessibilityValue.now).toBe(2);
    layout(280);
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 560, animated: false });
    dimensions = { width: 320, fontScale: 2 };
    act(() => renderer.update(createElement(Screen, props())));
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 560, animated: false });
    expect(pager().props.accessibilityValue.now).toBe(2);
    act(() => pager().props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } }));
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 280, animated: true });
  });

  it('routes each active banner CTA and disables offscreen CTAs', () => {
    const input = props(); mount(input); layout(350);
    const actions = [
      ['가족간병 · 가족간병 알아보기', input.onCarePress], ['보험 · 보험 서비스 보기', input.onInsurancePress],
      ['통신 · 준비 상태 보기', input.onTelecomPress], ['자동차 · 준비 상태 보기', input.onCarPress],
    ];
    actions.forEach(([label, callback], index) => {
      act(() => pager().props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: (index + 1) * 350 } } }));
      expect(button(label as string).props.disabled).toBe(false);
      expect(button(label as string).props.tabIndex).toBe(0);
      const slideViews = renderer.root.findAllByType('Pressable').filter((entry: { props: Record<string, unknown> }) => entry.props['aria-hidden'] !== undefined);
      expect(slideViews.map((entry: { props: Record<string, unknown> }) => entry.props['aria-hidden'])).toEqual([true, ...actions.map((_, slideIndex) => slideIndex !== index), true]);
      act(() => button(label as string).props.onPress()); expect(callback).toHaveBeenCalledTimes(1);
      expect(actions.filter(([other]) => other !== label).every(([other]) => button(other as string).props.disabled)).toBe(true);
    });
  });

  it('uses a web region rather than a slider so headings and CTA remain accessible', () => {
    mount();
    expect(pager().props.accessibilityRole).toBe('adjustable');
    platform.OS = 'web';
    act(() => renderer.update(createElement(Screen, props())));
    expect(pager().props.accessibilityRole).toBeUndefined();
    expect(pager().props.role).toBe('region');
    const careAction = button('가족간병 · 가족간병 알아보기');
    expect(careAction.props.disabled).toBe(false);
    expect(careAction.props.tabIndex).toBe(0);
    const titles = renderer.root.findAllByType('Text').filter((entry: { props: Record<string, unknown> }) => entry.props.accessibilityRole === 'header').map((entry: { props: Record<string, unknown> }) => entry.props.children);
    expect(titles).toEqual(['자동차 서비스,\n곧 만나요', '가족간병,\n시작 전 안내', '가람in 보험,\nFC 업무를 편리하게', '통신 서비스,\n곧 만나요', '자동차 서비스,\n곧 만나요', '가족간병,\n시작 전 안내', '좋은 서비스, 함께 누리는 혜택']);
    const descriptions = renderer.root.findAllByType('Text').map((entry: { props: Record<string, unknown> }) => entry.props.children);
    expect(descriptions).toContain('이용 전 절차를 확인하세요');
  });

  it('fills every banner with its own campaign art and keeps controls inside the image viewport', () => {
    const input = props(); mount(input); layout(350);
    const artwork = renderer.root.findAllByType('Image').filter((entry: { props: Record<string, unknown> }) => String(entry.props.source).includes('/banners/'));
    expect(artwork.map((entry: { props: Record<string, unknown> }) => entry.props.source)).toEqual(['car', 'care', 'insurance', 'telecom', 'car', 'care'].map((service) => `@/assets/images/service-home/banners/${service}.png`));
    artwork.forEach((entry: { props: Record<string, unknown> }) => {
      expect(entry.props.resizeMode).toBe('cover');
      expect(entry.props.accessible).toBe(false);
      expect(entry.props.style).toMatchObject({ position: 'absolute', width: '100%', height: '100%' });
    });
    const campaign = button('가족간병 · 가족간병 알아보기');
    expect(campaign.props.style({ pressed: false })[1]).toMatchObject({ width: 350, height: 263 + 28 });
    const next = button('다음 서비스 소개');
    expect(next.parent.props.style).toMatchObject({ position: 'absolute', right: 8, bottom: 10 + 28, height: 44, padding: 6 });
    expect(next.parent.parent.props.onLayout).toBeDefined();
    expect(next.parent.parent).toBe(pager().parent);
    expect(next.props.style({ pressed: false })[0]).toMatchObject({ width: 32, height: 32 });
    expect(next.props.hitSlop).toBe(6);
    expect(button('이전 서비스 소개').props.hitSlop).toBe(6);
    const lowerCopy = campaign.findAllByType('View').find((entry: { props: { style?: ({ bottom?: number } | false)[] } }) => Array.isArray(entry.props.style) && entry.props.style.some((style) => style && style.bottom === 18 + 28));
    expect(lowerCopy.props.style[0]).toMatchObject({ bottom: 18 + 28, left: 20, right: 124 });
    expect(campaign.findAllByType('Pressable')).toHaveLength(1);
    act(() => next.props.onPress());
    expect(input.onCarePress).not.toHaveBeenCalled();
    expect(input.onInsurancePress).not.toHaveBeenCalled();
    expect(renderer.root.findAllByType('Text').some((entry: { props: Record<string, unknown> }) => entry.props.children === '서비스 소개')).toBe(false);
  });

  it('uses the Moduon platform brand without the insurance logo', () => {
    mount();
    expect(renderer.root.findAllByType('Image').some((entry: { props: Record<string, unknown> }) => entry.props.source === 'hanwha-wordmark')).toBe(false);
    const brand = renderer.root.findAllByType('View').find((entry: { props: Record<string, unknown> }) => entry.props.accessibilityLabel === '모두온');
    expect(brand.findAllByType('Text').map((entry: { props: Record<string, unknown> }) => entry.props.children)).toEqual(['모두온']);
    expect(brand.findByType('Image').props.source).toBe('moduon-symbol');
  });

  it('automatically advances after five seconds and wraps forward after the fourth slide', () => {
    mount(); layout(350);
    act(() => jest.advanceTimersByTime(4999));
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 350, animated: false });
    act(() => jest.advanceTimersByTime(1));
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 700, animated: true });
    act(() => pager().props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 700 } } }));
    act(() => jest.advanceTimersByTime(5000));
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 1050, animated: true });
    act(() => pager().props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 1050 } } }));
    act(() => jest.advanceTimersByTime(5000));
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 1400, animated: true });
    act(() => pager().props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 1400 } } }));
    act(() => jest.advanceTimersByTime(5000));
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 1750, animated: true });
    act(() => pager().props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 1750 } } }));
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 350, animated: false });
    expect(pager().props.accessibilityValue.now).toBe(1);
  });

  it('starts a new five-second delay when banner interaction ends, without unrelated resets or hover pauses', () => {
    const input = props(); mount(input); layout(350);
    act(() => jest.advanceTimersByTime(4000));
    act(() => button('이용 안내').props.onPress());
    act(() => jest.advanceTimersByTime(1000));
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 700, animated: true });
    act(() => pager().props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 700 } } }));
    act(() => jest.advanceTimersByTime(4500));
    act(() => pager().props.onScrollBeginDrag());
    act(() => jest.advanceTimersByTime(10000));
    expect(pager().props.accessibilityValue.now).toBe(2);
    act(() => pager().props.onScrollEndDrag({ nativeEvent: { contentOffset: { x: 1050 } } }));
    act(() => pager().props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 1050 } } }));
    act(() => jest.advanceTimersByTime(4999));
    expect(pager().props.accessibilityValue.now).toBe(3);
    act(() => jest.advanceTimersByTime(1));
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 1400, animated: true });
    expect(pager().parent.props.onPointerEnter).toBeUndefined();
    expect(pager().parent.props.onPointerLeave).toBeUndefined();
  });

  it('automatically wraps the last web banner after five seconds while the visible window has lost focus', () => {
    platform.OS = 'web'; mount(); layout(350);
    act(() => pager().props.onScroll({ nativeEvent: { contentOffset: { x: 1400 } } }));
    act(() => jest.advanceTimersByTime(180));
    browserDocument.hasFocus.mockReturnValue(false);
    pointer(browserWindow, 'blur');
    act(() => jest.advanceTimersByTime(4999));
    expect(pager().props.accessibilityValue.now).toBe(4);
    act(() => jest.advanceTimersByTime(1));
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 1750, animated: true });
    act(() => pager().props.onScroll({ nativeEvent: { contentOffset: { x: 1750 } } }));
    act(() => jest.advanceTimersByTime(180));
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 350, animated: false });
    expect(pager().props.accessibilityValue.now).toBe(1);
    act(() => jest.advanceTimersByTime(5000));
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 700, animated: true });
  });

  it.each(['ios', 'android'])('limits a native %s fling to one slide, including late momentum and an already due timer', (os) => {
    platform.OS = os; mount(); layout(350);
    expect(pager().props.disableIntervalMomentum).toBe(true);
    act(() => pager().props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 700 } } }));
    act(() => jest.advanceTimersByTime(4999));
    act(() => {
      pager().props.onScrollBeginDrag();
      jest.advanceTimersByTime(1);
    });
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 700, animated: false });
    act(() => pager().props.onScroll({ nativeEvent: { contentOffset: { x: 1430 } } }));
    act(() => pager().props.onScrollEndDrag({ nativeEvent: { contentOffset: { x: 1400 } } }));
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 1050, animated: false });
    act(() => pager().props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 1400 } } }));
    act(() => pager().props.onScroll({ nativeEvent: { contentOffset: { x: 1400 } } }));
    act(() => jest.advanceTimersByTime(180));
    expect(pager().props.accessibilityValue.now).toBe(3);
    act(() => jest.advanceTimersByTime(4999));
    expect(pager().props.accessibilityValue.now).toBe(3);
    act(() => jest.advanceTimersByTime(1));
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 1400, animated: true });
    act(() => pager().props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 1400 } } }));
    act(() => pager().props.onScrollBeginDrag());
    act(() => pager().props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 1400 } } }));
    act(() => pager().props.onScrollEndDrag({ nativeEvent: { contentOffset: { x: 0 } } }));
    act(() => pager().props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 0 } } }));
    expect(pager().props.accessibilityValue.now).toBe(3);
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 1050, animated: false });
  });

  it('wraps a native drag once in each direction and ignores the old loop offset after normalization', () => {
    platform.OS = 'android'; mount(); layout(350);
    act(() => pager().props.onScrollBeginDrag());
    act(() => pager().props.onScrollEndDrag({ nativeEvent: { contentOffset: { x: 0 } } }));
    act(() => pager().props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 0 } } }));
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 1400, animated: false });
    act(() => pager().props.onScroll({ nativeEvent: { contentOffset: { x: 0 } } }));
    expect(pager().props.accessibilityValue.now).toBe(4);
    act(() => pager().props.onScrollBeginDrag());
    act(() => pager().props.onScrollEndDrag({ nativeEvent: { contentOffset: { x: 3000 } } }));
    act(() => pager().props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 3000 } } }));
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 350, animated: false });
    act(() => pager().props.onScroll({ nativeEvent: { contentOffset: { x: 1750 } } }));
    expect(pager().props.accessibilityValue.now).toBe(1);
  });

  it('pauses hidden web pages and starts a fresh delay when visibility returns without window focus', () => {
    platform.OS = 'web'; mount(); layout(350);
    act(() => jest.advanceTimersByTime(4000));
    browserDocument.visibilityState = 'hidden';
    pointer(browserDocument, 'visibilitychange');
    pointer(browserWindow, 'focus');
    act(() => jest.advanceTimersByTime(10000));
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 350, animated: false });
    browserDocument.visibilityState = 'visible';
    browserDocument.hasFocus.mockReturnValue(false);
    pointer(browserDocument, 'visibilitychange');
    act(() => jest.advanceTimersByTime(4999));
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 350, animated: false });
    act(() => jest.advanceTimersByTime(1));
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 700, animated: true });
  });

  it('supports explicit pause, background and navigation focus, and removes timers and listeners on unmount', () => {
    mount(); layout(350);
    act(() => button('배너 자동 넘김 일시정지').props.onPress());
    act(() => jest.advanceTimersByTime(10000));
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 350, animated: false });
    act(() => button('배너 자동 넘김 재생').props.onPress());
    act(() => appListener('background'));
    act(() => jest.advanceTimersByTime(10000));
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 350, animated: false });
    act(() => appListener('active'));
    focused = false;
    act(() => renderer.update(createElement(Screen, props())));
    act(() => jest.advanceTimersByTime(10000));
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 350, animated: false });
    focused = true;
    act(() => renderer.update(createElement(Screen, props())));
    act(() => jest.advanceTimersByTime(5000));
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 700, animated: true });
    act(() => renderer.unmount());
    expect(jest.getTimerCount()).toBe(0);
    expect(removedAppListener).toHaveBeenCalledTimes(1);
    expect(removedMotionListener).toHaveBeenCalledTimes(1);
  });

  it('disables automatic motion and makes manual moves instantaneous for reduced motion', () => {
    reduced = true; mount(); layout(350);
    act(() => jest.advanceTimersByTime(10000));
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 350, animated: false });
    expect(button('배너 자동 넘김 재생').props.disabled).toBe(true);
    act(() => button('다음 서비스 소개').props.onPress());
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 700, animated: false });
    act(() => motionListener(false));
    act(() => jest.advanceTimersByTime(5000));
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 1050, animated: true });
    act(() => motionListener(true));
    act(() => jest.advanceTimersByTime(10000));
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 1050, animated: true });
  });

  it('drags with actual DOM pointer events and suppresses the release click while preserving plain and vertical gestures', () => {
    platform.OS = 'web'; const input = props(); mount(input); layout(350);
    pointer(surface, 'pointerdown');
    pointer(browserWindow, 'pointermove', { clientX: 212 });
    expect(surface.setPointerCapture).not.toHaveBeenCalled();
    const vertical = pointer(browserWindow, 'pointermove', { clientX: 200, clientY: 150 });
    expect(vertical.defaultPrevented).toBe(false);
    expect(surface.setPointerCapture).not.toHaveBeenCalled();
    const horizontal = pointer(browserWindow, 'pointermove', { clientX: 100, clientY: 103 });
    expect(horizontal.defaultPrevented).toBe(true);
    expect(surface.setPointerCapture).toHaveBeenCalledWith(1);
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 470, animated: false });
    pointer(browserWindow, 'pointerup', { clientX: 100, clientY: 103, buttons: 0 });
    expect(surface.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 700, animated: true });
    const click = pointer(surface, 'click');
    expect(click.defaultPrevented).toBe(true);
    act(() => button('보험 · 보험 서비스 보기').props.onPress());
    expect(input.onInsurancePress).not.toHaveBeenCalled();
    act(() => pager().props.onScroll({ nativeEvent: { contentOffset: { x: 700 } } }));
    act(() => jest.advanceTimersByTime(401));
    pointer(surface, 'pointerdown');
    pointer(browserWindow, 'pointerup', { buttons: 0 });
    const plainClick = pointer(surface, 'click');
    expect(plainClick.defaultPrevented).toBe(false);
    act(() => button('보험 · 보험 서비스 보기').props.onPress());
    expect(input.onInsurancePress).toHaveBeenCalledTimes(1);
  });

  it('preserves the released mouse destination when a quiet intermediate frame arrives', () => {
    platform.OS = 'web'; mount(); layout(440);
    act(() => pager().props.onScroll({ nativeEvent: { contentOffset: { x: 880 } } }));
    act(() => jest.advanceTimersByTime(180));
    pointer(surface, 'pointerdown', { clientX: 749, clientY: 417 });
    pointer(browserWindow, 'pointermove', { clientX: 534, clientY: 417 });
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 1095, animated: false });
    pointer(browserWindow, 'pointerup', { clientX: 534, clientY: 417, buttons: 0 });
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 1320, animated: true });
    act(() => pager().props.onScroll({ nativeEvent: { contentOffset: { x: 1095 } } }));
    act(() => jest.advanceTimersByTime(180));
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 1320, animated: true });
    act(() => pager().props.onScroll({ nativeEvent: { contentOffset: { x: 1320 } } }));
    act(() => jest.advanceTimersByTime(180));
    expect(pager().props.accessibilityValue.now).toBe(3);
    expect(button('통신 · 준비 상태 보기').props.disabled).toBe(false);
  });

  it('limits a long mouse drag to the adjacent banner in either direction', () => {
    platform.OS = 'web'; mount(); layout(350);
    act(() => pager().props.onScroll({ nativeEvent: { contentOffset: { x: 700 } } }));
    act(() => jest.advanceTimersByTime(180));
    pointer(surface, 'pointerdown');
    pointer(browserWindow, 'pointermove', { clientX: -900 });
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 1050, animated: false });
    pointer(browserWindow, 'pointerup', { clientX: -900, buttons: 0 });
    act(() => pager().props.onScroll({ nativeEvent: { contentOffset: { x: 1050 } } }));
    act(() => jest.advanceTimersByTime(180));
    expect(pager().props.accessibilityValue.now).toBe(3);
    pointer(surface, 'pointerdown');
    pointer(browserWindow, 'pointermove', { clientX: 1300 });
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 700, animated: false });
    pointer(browserWindow, 'pointerup', { clientX: 1300, buttons: 0 });
    act(() => pager().props.onScroll({ nativeEvent: { contentOffset: { x: 700 } } }));
    act(() => jest.advanceTimersByTime(180));
    expect(pager().props.accessibilityValue.now).toBe(2);
  });

  it('cleans up pointer cancellation, window blur and unmount without stuck gesture state or timers', () => {
    platform.OS = 'web'; mount(); layout(350);
    pointer(surface, 'pointerdown');
    pointer(browserWindow, 'pointermove', { clientX: 100 });
    pointer(browserWindow, 'pointercancel');
    act(() => pager().props.onScroll({ nativeEvent: { contentOffset: { x: 350 } } }));
    act(() => jest.advanceTimersByTime(180));
    act(() => jest.advanceTimersByTime(5000));
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 700, animated: true });
    act(() => pager().props.onScroll({ nativeEvent: { contentOffset: { x: 700 } } }));
    act(() => jest.advanceTimersByTime(180));
    pointer(surface, 'pointerdown');
    pointer(browserWindow, 'pointermove', { clientX: 100 });
    pointer(browserWindow, 'blur');
    expect(surface.releasePointerCapture).toHaveBeenCalledTimes(2);
    pointer(surface, 'pointerdown');
    pointer(browserWindow, 'pointermove', { clientX: 100 });
    act(() => renderer.unmount());
    expect(jest.getTimerCount()).toBe(0);
    scrollTo.mockClear();
    pointer(browserWindow, 'pointermove', { clientX: 50 });
    pointer(browserWindow, 'pointerup', { clientX: 50 });
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('settles web loop copies from onScroll silence without synthetic momentum events', () => {
    platform.OS = 'web'; mount(); layout(350);
    expect(pager().props.pagingEnabled).toBe(false);
    act(() => pager().props.onScroll({ nativeEvent: { contentOffset: { x: 1400 } } }));
    act(() => jest.advanceTimersByTime(180));
    act(() => button('다음 서비스 소개').props.onPress());
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 1750, animated: true });
    act(() => pager().props.onScroll({ nativeEvent: { contentOffset: { x: 1750 } } }));
    act(() => jest.advanceTimersByTime(179));
    expect(button('가족간병 · 가족간병 알아보기').props.disabled).toBe(true);
    act(() => jest.advanceTimersByTime(1));
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 350, animated: false });
    expect(button('가족간병 · 가족간병 알아보기').props.disabled).toBe(false);
    act(() => button('다음 서비스 소개').props.onPress());
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 700, animated: true });
  });

  it('queues rapid loop controls until clone normalization rather than sweeping backwards', () => {
    platform.OS = 'web'; mount(); layout(350);
    act(() => pager().props.onScroll({ nativeEvent: { contentOffset: { x: 1400 } } }));
    act(() => jest.advanceTimersByTime(180));
    scrollTo.mockClear();
    act(() => button('다음 서비스 소개').props.onPress());
    act(() => button('다음 서비스 소개').props.onPress());
    expect(scrollTo.mock.calls).toEqual([[{ x: 1750, animated: true }]]);
    act(() => pager().props.onScroll({ nativeEvent: { contentOffset: { x: 1750 } } }));
    act(() => jest.advanceTimersByTime(181));
    expect(scrollTo.mock.calls).toEqual([
      [{ x: 1750, animated: true }], [{ x: 350, animated: false }], [{ x: 700, animated: true }],
    ]);
    act(() => pager().props.onScroll({ nativeEvent: { contentOffset: { x: 700 } } }));
    act(() => jest.advanceTimersByTime(180));
    expect(pager().props.accessibilityValue.now).toBe(2);
    expect(button('보험 · 보험 서비스 보기').props.disabled).toBe(false);
  });

  it('snaps a partial web scroll without passing responder handlers into ScrollView', () => {
    platform.OS = 'web'; mount(); layout(350);
    expect(pager().props.onPanResponderTerminate).toBeUndefined();
    expect(pager().parent.props.onPanResponderTerminate).toBeUndefined();
    act(() => pager().props.onScroll({ nativeEvent: { contentOffset: { x: 600 } } }));
    act(() => jest.advanceTimersByTime(180));
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 700, animated: true });
    act(() => pager().props.onScroll({ nativeEvent: { contentOffset: { x: 700 } } }));
    act(() => jest.advanceTimersByTime(180));
    expect(pager().props.accessibilityValue.now).toBe(2);
  });

  it.each([320, 390, 414, 768])('preserves menu and clearance with enlarged text at %i', (width) => {
    dimensions = { width, fontScale: 2 }; mount();
    const outerScroll = renderer.root.findAllByType('ScrollView').find((entry: { props: Record<string, unknown> }) => !entry.props.horizontal);
    expect(outerScroll.props.contentContainerStyle.paddingBottom).toBeGreaterThan(144);
    expect(renderer.root.findAllByType('ServiceIcon').filter((entry: { props: Record<string, unknown> }) => entry.props.service === 'care').map((entry: { props: Record<string, unknown> }) => entry.props.size)).toEqual([46]);
    layout(Math.min(width, 480));
    const campaign = button('가족간병 · 가족간병 알아보기');
    expect(campaign.props.style({ pressed: false })[1].height).toBe(Math.round(Math.min(width, 480) * 0.75 * 2 + 96) + 28);
    const lowerCopy = campaign.findAllByType('View').find((entry: { props: { style?: ({ bottom?: number } | false)[] } }) => Array.isArray(entry.props.style) && entry.props.style.some((style) => style && style.bottom === 62 + 28));
    expect(lowerCopy.props.style[1]).toMatchObject({ bottom: 62 + 28, right: 20 });
    expect(pager().props.pagingEnabled).toBe(true);
  });
});
