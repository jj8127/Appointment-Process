import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement, type ReactElement } from 'react';
import * as React from 'react';
import * as ts from 'typescript';
import { resolveBottomNavActiveKey, resolveBottomNavPreset } from '../bottom-navigation';
import { COLORS, TYPOGRAPHY, SPACING, RADIUS, SHADOWS, TOUCH_TARGET } from '../theme';
import { useReadAttempt } from '../use-read-attempt';
import { CARE_STATUS_TONES, CARE_WEEKDAYS, careCalendarMonths } from '../hospital-care';
import { formatExternalUrlDisplayText } from '../external-url';
import { createCreationRequestTracker } from '../board-comment-request';
import { parseCalendarDate } from '../calendar-date';
import { buildReferralInviteUrl, buildReferralShareText } from '../referral-share';
import { normalizeReferralInviteCode } from '../referral-deeplink';
import { FAMILY_CARE_PROMOTION_URL, resolveInsuranceServiceRoute, resolveServiceInformationKey, SERVICE_INFORMATION_KEYS } from '../service-home';
import { resolveLegacyAuthRoute } from '../session-landing';
import { z } from 'zod';

type Instance = { children: (Instance | string)[]; props: Record<string, unknown>; findAllByType: (type: string) => Instance[] };
type Renderer = { root: Instance; unmount: () => void; update: (element: ReactElement) => void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { create } = require('react-test-renderer') as { create: (element: ReactElement) => Renderer };
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const root = join(__dirname, '../..');

function executeComponent(path: string, dependencies: Record<string, unknown> = {}, exportName = 'default') {
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
    if (name === '@/lib/open-external-url') return { openExternalUrl: jest.fn(async () => undefined) };
    if (name === '@/hooks/use-keyboard-padding') return { useKeyboardPadding: () => 0 };
    // Shared pickers render as named host nodes so tests drive them through their props.
    if (name === '@/components/SelectionControls') return { ActionRows: 'ActionRows', ChoiceRows: 'ChoiceRows', SegmentedControl: 'SegmentedControl', IconTile: 'IconTile' };
    if (name === '@/components/OptionSheetField') return { OptionSheetField: 'OptionSheetField' };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    if (name === '@/lib/back-navigation') return require('@/lib/back-navigation');
    throw new Error(`Unexpected component dependency ${name}`);
  }, exported);
  return (exported[exportName] ?? exported.DaumPostcode) as (props: Record<string, unknown>) => ReactElement;
}

it('identity form clears a changed account draft and rejects its late address search while preserving same-account refresh', async () => {
  let identity = { hydrated: true, role: 'fc', residentId: 'fictional-account-a', appSessionToken: 'fictional-a', isPlatformSignedIn: true };
  const form = { control: {}, handleSubmit: jest.fn(), formState: { errors: {} }, setError: jest.fn(), setValue: jest.fn(), reset: jest.fn() };
  const Screen = executeComponent('app/identity.tsx', {
    'react-native': { Alert: { alert: jest.fn() }, InteractionManager: { runAfterInteractions: jest.fn() },
      Modal: 'Modal', Pressable: 'Pressable', Text: 'Text', TextInput: 'TextInput', View: 'View', StyleSheet: { create: (styles: unknown) => styles } },
    '@expo/vector-icons': { Feather: 'Feather' }, '@hookform/resolvers/zod': { zodResolver: jest.fn() },
    '@tanstack/react-query': { useQueryClient: () => ({}) }, 'expo-router': { router: { replace: jest.fn() }, useLocalSearchParams: () => ({}) },
    'react-hook-form': { useForm: () => form, Controller: () => null }, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    zod: { z }, '@/components/Button': { Button: 'Button' }, '@/components/DaumPostcode': { DaumPostcode: 'DaumPostcode' },
    '@/components/KeyboardAwareWrapper': { KeyboardAwareWrapper: 'KeyboardAwareWrapper' },
    '@/hooks/use-session': { useSession: () => identity }, '@/lib/use-read-attempt': { useReadAttempt },
    '@/lib/home-entry-flow': {}, '@/lib/notification-open-authorization': {}, '@/lib/notification-navigation-coordinator': {},
    '@/lib/pending-notification-navigation': {}, '@/lib/theme': { COLORS, RADIUS, SHADOWS, SPACING, TOUCH_TARGET, TYPOGRAPHY },
    '@/lib/store-identity-api': {}, '@/lib/store-identity-error': {}, '@/lib/user-facing-error': {}, '@/lib/validation': {},
  });
  let renderer!: Renderer;
  await act(async () => { renderer = create(createElement(Screen)); });
  const open = () => (renderer.root.findAllByType('Button').find(node => node.children.includes('주소 검색'))!.props.onPress as () => void)();
  await act(async () => { open(); });
  const oldSelection = renderer.root.findAllByType('DaumPostcode')[0].props.onSelected as (value: unknown) => void;
  identity = { ...identity, appSessionToken: 'fictional-a-renewed' };
  await act(async () => { renderer.update(createElement(Screen)); });
  expect(form.reset).not.toHaveBeenCalled();
  identity = { ...identity, residentId: 'fictional-account-b', appSessionToken: 'fictional-b' };
  await act(async () => { renderer.update(createElement(Screen)); });
  expect(form.reset).toHaveBeenCalledTimes(1);
  expect(renderer.root.findAllByType('Modal')[0].props.visible).toBe(false);
  await act(async () => { oldSelection({ address: '합성 이전 주소' }); });
  expect(form.setValue).not.toHaveBeenCalled();
  await act(async () => { open(); });
  await act(async () => { oldSelection({ address: '늦게 도착한 이전 계정 주소' }); });
  expect(form.setValue).not.toHaveBeenCalled();
  const newSelection = renderer.root.findAllByType('DaumPostcode')[0].props.onSelected as (value: unknown) => void;
  await act(async () => { newSelection({ address: '합성 새 주소' }); });
  expect(form.setValue).toHaveBeenCalledWith('address', '합성 새 주소', { shouldValidate: true, shouldDirty: true });
  await act(async () => renderer.unmount());
});

it('hospital specialty art keeps a face outline and plus only, and clips leaf veins to its exact outline', async () => {
  const Icon = executeComponent('components/hospitals/DepartmentIcon.tsx', {
    'react-native-svg': { __esModule: true, default: 'Svg', Circle: 'Circle', ClipPath: 'ClipPath', Defs: 'Defs', G: 'G', Path: 'Path', Rect: 'Rect' },
    '@/lib/theme': { COLORS },
  });
  let renderer!: Renderer;
  await act(async () => { renderer = create(createElement(Icon, { specialty: '성형외과' })); });
  const face = renderer.root.findAllByType('Path');
  expect(face).toHaveLength(2);
  expect(face[0].props.fill).toBe('#9AD6D7');
  expect(face[1].props).toMatchObject({ stroke: COLORS.primaryLight, strokeWidth: 3.6 });
  await act(async () => { renderer.update(createElement(Icon, { specialty: '한방병원' })); });
  const clip = renderer.root.findAllByType('ClipPath')[0];
  const veins = renderer.root.findAllByType('G').find(group => group.props.clipPath);
  expect(veins?.props.clipPath).toBe(`url(#${clip.props.id})`);
  const leaf = renderer.root.findAllByType('Path').find(item => item.props.fill === '#9AD6D7');
  expect(clip.findAllByType('Path')[0].props.d).toBe(leaf?.props.d);
  expect(renderer.root.findAllByType('Circle')[0].props).toMatchObject({ fill: COLORS.primaryLight, r: 9 });
  expect(renderer.root.findAllByType('Path').some(item => item.props.stroke === 'white')).toBe(true);
  await act(async () => { renderer.update(createElement(Icon, { specialty: '건강검진센터' })); });
  expect(renderer.root.findAllByType('Rect').map((item) => item.props.fill)).toEqual(['#9AD6D7', COLORS.primaryLight]);
  expect(renderer.root.findAllByType('Path').some(item => item.props.stroke === 'white' && item.props.strokeWidth === 4)).toBe(true);
  await act(async () => renderer.unmount());
});

function texts(instance: Instance) {
  return instance.findAllByType('Text').map((node) => node.children.filter((child) => typeof child === 'string').join(''));
}

it.each(['signup', 'signup-verify', 'signup-password'])('legacy %s forwards insurance intent without turning its invitation into a common referrer', async route => {
  const savePendingReferralCode = jest.fn(async () => undefined);
  const Alias = executeComponent('components/LegacySignupRedirect.tsx', {
    'expo-router': { Redirect: 'Redirect', useLocalSearchParams: () => ({ code: 'abcdefgh', skipAuto: '1', referralNonce: '2' }) },
    '@/hooks/use-session': { useSession: () => ({ hydrated: true, role: null, isPlatformSignedIn: false }) },
    '@/lib/referral-deeplink': { normalizeReferralInviteCode, savePendingReferralCode },
    '@/lib/request-board-api': { captureAppSessionOwner: () => () => true },
    '@/lib/session-landing': { resolveLegacyAuthRoute },
  });
  const Screen = executeComponent(`app/${route}.tsx`, { '@/components/LegacySignupRedirect': { default: Alias } });
  let renderer!: Renderer;
  await act(async () => { renderer = create(createElement(Screen)); });
  expect(savePendingReferralCode).toHaveBeenCalledWith('ABCDEFGH');
  expect(renderer.root.findAllByType('Redirect')[0].props.href).toEqual({
    pathname: '/services/signup', params: { service: 'insurance', skipAuto: '1', referralNonce: '2' },
  });
  await act(async () => renderer.unmount());
});

it.each(['restoring', 'signed', 'care', 'invalid'])('legacy signup does not save an insurance invitation while %s', async state => {
  const savePendingReferralCode = jest.fn(async () => undefined);
  const Alias = executeComponent('components/LegacySignupRedirect.tsx', {
    'expo-router': { Redirect: 'Redirect', useLocalSearchParams: () => ({ code: state === 'invalid' ? '<invalid>' : 'ABCDEFGH', ...(state === 'care' ? { service: 'care' } : {}) }) },
    '@/hooks/use-session': { useSession: () => ({ hydrated: state !== 'restoring', role: state === 'signed' ? 'fc' : null, isPlatformSignedIn: state === 'signed' }) },
    '@/lib/referral-deeplink': { normalizeReferralInviteCode, savePendingReferralCode },
    '@/lib/request-board-api': { captureAppSessionOwner: () => () => true }, '@/lib/session-landing': { resolveLegacyAuthRoute },
  });
  let renderer!: Renderer;
  await act(async () => { renderer = create(createElement(Alias)); });
  expect(savePendingReferralCode).not.toHaveBeenCalled();
  if (state === 'restoring') expect(renderer.root.findAllByType('Redirect')).toHaveLength(0);
  await act(async () => renderer.unmount());
});

it('a common-only signed member retains an explicit insurance invitation before first FC enrollment', async () => {
  const savePendingReferralCode = jest.fn(async () => undefined);
  const Alias = executeComponent('components/LegacySignupRedirect.tsx', {
    'expo-router': { Redirect: 'Redirect', useLocalSearchParams: () => ({ code: 'ABCDEFGH' }) },
    '@/hooks/use-session': { useSession: () => ({ hydrated: true, role: null, isPlatformSignedIn: true, platformMember: { id: 'synthetic-member' } }) },
    '@/lib/referral-deeplink': { normalizeReferralInviteCode, savePendingReferralCode },
    '@/lib/request-board-api': { captureAppSessionOwner: () => () => true }, '@/lib/session-landing': { resolveLegacyAuthRoute },
  });
  let renderer!: Renderer;
  await act(async () => { renderer = create(createElement(Alias)); });
  expect(savePendingReferralCode).toHaveBeenCalledWith('ABCDEFGH');
  expect(renderer.root.findAllByType('Redirect')[0].props.href).toEqual({ pathname: '/services/signup', params: { service: 'insurance' } });
  await act(async () => renderer.unmount());
});

it('legacy login retains logout suppression and an explicit common service intention', async () => {
  const Alias = executeComponent('app/login.tsx', {
    'expo-router': { Redirect: 'Redirect', useLocalSearchParams: () => ({ service: 'care', skipAuto: '1' }) },
    '@/lib/session-landing': { resolveLegacyAuthRoute },
  });
  let renderer!: Renderer;
  await act(async () => { renderer = create(createElement(Alias)); });
  expect(renderer.root.findAllByType('Redirect')[0].props.href).toEqual({ pathname: '/services/login', params: { service: 'care', skipAuto: '1' } });
  await act(async () => renderer.unmount());
});

it('filled mobile actions share readable white labels without changing press or inactive states', async () => {
  const flatten = (style: unknown): Record<string, unknown> => Array.isArray(style)
    ? Object.assign({}, ...style.map(flatten)) : style && typeof style === 'object' ? style as Record<string, unknown> : {};
  const native = { Keyboard: { dismiss: jest.fn() }, TouchableOpacity: 'TouchableOpacity', Text: 'Text', View: 'View', StyleSheet: { create: (value: unknown) => value } };
  const Button = executeComponent('components/Button.tsx', {
    'react-native': native, '@/components/BrandedLoadingSpinner': { default: 'Spinner' },
    '@/lib/theme': { COLORS, TYPOGRAPHY, SPACING, RADIUS, SHADOWS, TOUCH_TARGET },
  }, 'Button');
  const press = jest.fn();
  let renderer!: Renderer;
  await act(async () => { renderer = create(createElement(Button, { onPress: press }, '계속하기')); });
  expect(flatten(renderer.root.findAllByType('TouchableOpacity')[0].props.style).backgroundColor).toBe(COLORS.primaryButton);
  expect(flatten(renderer.root.findAllByType('Text')[0].props.style).color).toBe(COLORS.white);
  await act(async () => { (renderer.root.findAllByType('TouchableOpacity')[0].props.onPress as () => void)(); });
  expect(press).toHaveBeenCalledTimes(1);
  await act(async () => { renderer.update(createElement(Button, { textStyle: { color: COLORS.black, fontSize: 17 } }, '계속하기')); });
  expect(flatten(renderer.root.findAllByType('Text')[0].props.style)).toMatchObject({ color: COLORS.white, fontSize: 17 });
  await act(async () => { renderer.update(createElement(Button, { loading: true }, '계속하기')); });
  expect(renderer.root.findAllByType('TouchableOpacity')[0].props.disabled).toBe(true);
  expect(renderer.root.findAllByType('Spinner')[0].props.color).toBe(COLORS.white);
  await act(async () => { renderer.update(createElement(Button, { disabled: true }, '계속하기')); });
  expect(renderer.root.findAllByType('TouchableOpacity')[0].props.accessibilityState).toEqual({ disabled: true });
  await act(async () => { renderer.update(createElement(Button, { variant: 'outline' }, '탈퇴')); });
  expect(flatten(renderer.root.findAllByType('TouchableOpacity')[0].props.style).backgroundColor).toBe(COLORS.white);
  expect(flatten(renderer.root.findAllByType('Text')[0].props.style).color).toBe(COLORS.primary);
  await act(async () => { renderer.update(createElement(Button, { variant: 'outline', style: { backgroundColor: COLORS.primaryPale }, textStyle: { color: COLORS.warning.dark } }, '추천 주소 복사')); });
  expect(flatten(renderer.root.findAllByType('Text')[0].props.style).color).toBe(COLORS.warning.dark);
  await act(async () => renderer.unmount());

  const Action = executeComponent('components/ServiceInformation.tsx', {
    '@expo/vector-icons': { Feather: 'Feather' }, 'expo-router': { Stack: {}, router: {} },
    'react-native-safe-area-context': {}, '@/components/BottomNavigation': {}, '@/components/service-home': {},
    '@/hooks/use-session': {}, '@/lib/bottom-navigation': {}, '@/lib/theme': { COLORS }, '@/lib/back-navigation': {},
  }, 'ServiceAction');
  await act(async () => { renderer = create(createElement(Action, { label: '이용내역', onPress: press, style: { marginTop: 0 } })); });
  const action = renderer.root.findAllByType('Pressable')[0];
  const style = flatten((action.props.style as (state: { pressed: boolean }) => unknown)({ pressed: false }));
  expect(style).toMatchObject({ backgroundColor: COLORS.primaryButton, marginTop: 0, minHeight: 48 });
  expect(flatten(renderer.root.findAllByType('Text')[0].props.style).color).toBe(COLORS.white);
  await act(async () => { (action.props.onPress as () => void)(); });
  expect(press).toHaveBeenCalledTimes(2);
  await act(async () => renderer.unmount());

  const luminance = (hex: string) => hex.slice(1).match(/../g)!.map(value => parseInt(value, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  expect((luminance(COLORS.white) + 0.05) / (luminance(COLORS.primaryButton) + 0.05)).toBeGreaterThanOrEqual(4.5);
});

describe('family-care invitation controls', () => {
  let account: { data: null | { member: { id: string } }; error: string | null; needsConsent: boolean; loading: boolean; token: string | null; session: { isPlatformSignedIn: boolean; logout: jest.Mock } };
  let renderer: Renderer;
  let screen: (props: Record<string, unknown>) => ReactElement;
  let width = 390; let fontScale = 1;
  const copy = jest.fn(); const share = jest.fn(); const showToast = jest.fn(); const push = jest.fn(); const navigate = jest.fn(); const refresh = jest.fn();
  // Each owner receives its own family-care code; the common member code is never shared.
  let careCodes: Record<string, string | null>;
  const platformRequest = jest.fn(async (_action: string, _payload: unknown, token: string) => ({ ok: true, serviceKey: 'care', code: careCodes[token] ?? null, referrer: null }));
  const button = (label: string) => renderer.root.findAllByType('Button').find(node => node.children.includes(label))!;
  const render = async () => { await act(async () => { renderer = create(createElement(screen)); }); };
  beforeEach(() => {
    careCodes = { 'synthetic-owner': 'SABCDEF12345', 'synthetic-other-owner': 'SABCDEF67890' };
    platformRequest.mockClear();
    account = { data: { member: { id: 'synthetic-member' } }, error: null, needsConsent: false, loading: false,
      token: 'synthetic-owner', session: { isPlatformSignedIn: true, logout: jest.fn() } };
    width = 390; fontScale = 1;
    copy.mockReset().mockResolvedValue(undefined); share.mockReset().mockResolvedValue({ action: 'dismissedAction' }); showToast.mockReset(); push.mockReset(); navigate.mockReset(); refresh.mockReset();
    screen = executeComponent('components/FamilyCareInvitation.tsx', {
      '@expo/vector-icons': { Feather: 'Feather' }, 'expo-clipboard': { setStringAsync: copy }, 'expo-router': { router: { push, navigate } },
      'react-native': { Share: { share }, Text: 'Text', View: 'View', StyleSheet: { create: (styles: unknown) => styles }, useWindowDimensions: () => ({ width, fontScale }) },
      '@/components/Button': { Button: 'Button' }, '@/components/Toast': { useToast: () => ({ showToast }) },
      '@/hooks/use-platform-account': { usePlatformAccount: () => ({ ...account, refresh }) }, '@/lib/theme': { COLORS },
      '@/lib/referral-share': { buildReferralInviteUrl, buildReferralShareText }, '@/lib/use-read-attempt': { useReadAttempt },
      '@/lib/referral-deeplink': { normalizeReferralInviteCode }, '@/lib/platform-api': { platformRequest },
    });
  });
  afterEach(async () => { await act(async () => renderer?.unmount()); });
  it('copies the signed member own care-code link, and shares code without claiming delivery or cancellation success', async () => {
    await render();
    expect(platformRequest).toHaveBeenCalledWith('get_service_referral', { serviceKey: 'care', issueCode: true }, 'synthetic-owner');
    expect(texts(renderer.root)).toContain('SABCDEF12345');
    await act(async () => { (button('추천 주소 복사').props.onPress as () => void)(); });
    const link = new URL(copy.mock.calls[0][0]);
    expect(link.searchParams.get('code')).toBe('SABCDEF12345'); expect(link.searchParams.get('service')).toBe('care');
    expect(showToast).toHaveBeenCalledWith({ message: '추천 주소를 복사했어요', variant: 'success' });
    showToast.mockClear();
    await act(async () => { (button('공유하기').props.onPress as () => void)(); });
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('추천 코드: SABCDEF12345') }));
    expect(share.mock.calls[0][0].message).toContain('service=care'); expect(showToast).not.toHaveBeenCalled();
  });
  it('blocks repeat presses and stale-owner completions and handlers', async () => {
    let resolve!: () => void; copy.mockImplementation(() => new Promise<void>(done => { resolve = done; }));
    await render(); const oldPress = button('추천 주소 복사').props.onPress as () => void;
    await act(async () => { oldPress(); oldPress(); }); expect(copy).toHaveBeenCalledTimes(1); expect(button('공유하기').props.disabled).toBe(true);
    account = { ...account, token: 'synthetic-other-owner', data: { member: { id: 'synthetic-other-member' } } };
    await act(async () => renderer.update(createElement(screen)));
    await act(async () => { oldPress(); resolve(); }); expect(copy).toHaveBeenCalledTimes(1); expect(showToast).not.toHaveBeenCalled();
    expect(texts(renderer.root)).toContain('SABCDEF67890'); expect(button('공유하기').props.disabled).toBe(false);
  });
  it.each(['copy', 'share'])('shows an explicit %s failure and permits retry', async (action) => {
    const operation = action === 'copy' ? copy : share; operation.mockRejectedValueOnce(new Error('synthetic error'));
    await render();
    await act(async () => { (button(action === 'copy' ? '추천 주소 복사' : '공유하기').props.onPress as () => void)(); });
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' })); expect(button('공유하기').props.disabled).toBe(false);
  });
  it.each(['signed-out', 'consent', 'error', 'missing-code', 'invalid-code', 'code-error', 'loading'])('provides recovery and does not expose invite actions in %s state', async (state) => {
    if (state === 'signed-out') account.session.isPlatformSignedIn = false;
    if (state === 'consent') account.needsConsent = true;
    if (state === 'error') account.error = 'synthetic error';
    if (state === 'missing-code') account.data = null;
    if (state === 'invalid-code') careCodes['synthetic-owner'] = 'A';
    if (state === 'code-error') platformRequest.mockRejectedValueOnce(new Error('synthetic error'));
    if (state === 'loading') account.loading = true;
    await render(); expect(button('추천 주소 복사')).toBeUndefined(); expect(button('공유하기')).toBeUndefined();
    if (state === 'signed-out') {
      await act(async () => { (button('로그인하고 초대하기').props.onPress as () => void)(); });
      expect(navigate).toHaveBeenCalledWith({ pathname: '/services/login', params: { service: 'care' } }); expect(push).not.toHaveBeenCalled();
    } else if (state === 'consent') {
      await act(async () => { const press = button('동의하고 초대 준비하기').props.onPress as () => void; press(); press(); });
      expect(navigate.mock.calls).toEqual([['/services/account'], ['/services/account']]); expect(push).not.toHaveBeenCalled();
    } else if (state !== 'loading') {
      await act(async () => { (button('다시 확인').props.onPress as () => void)(); });
      if (state === 'error' || state === 'missing-code') expect(refresh).toHaveBeenCalledTimes(1);
      else { expect(refresh).not.toHaveBeenCalled(); expect(platformRequest).toHaveBeenCalledTimes(2); }
      if (state === 'error') { await act(async () => { (button('다시 로그인').props.onPress as () => void)(); }); expect(account.session.logout).toHaveBeenCalledTimes(1); }
    }
    expect(copy).not.toHaveBeenCalled(); expect(share).not.toHaveBeenCalled();
  });
  it.each([[320, 1], [390, 1.5]])('stacks equal touch targets at width %s and font scale %s', async (nextWidth, nextScale) => {
    width = nextWidth; fontScale = nextScale; await render();
    const buttons = renderer.root.findAllByType('Button');
    expect(buttons).toHaveLength(2);
    for (const node of buttons) expect([node.props.style].flat().some(style => (style as { minHeight?: number }).minHeight === 48)).toBe(true);
    expect(renderer.root.findAllByType('View').some(node => Array.isArray(node.props.style) && node.props.style.some(style => style?.flexDirection === 'column'))).toBe(true);
  });
});

it('care information preserves conditional registration guidance and separates promotion from member invitation', async () => {
  const openPromotion = jest.fn(async () => undefined);
  const Care = executeComponent('app/services/[service].tsx', {
    '@expo/vector-icons': { Feather: 'Feather' },
    'expo-router': { router: { push: jest.fn(), replace: jest.fn() }, useLocalSearchParams: () => ({ service: 'care' }) },
    '@/components/ServiceInformation': { default: 'ServiceInformation', ServiceAction: 'ServiceAction', informationStyles: {} },
    '@/components/FamilyCareInvitation': { default: 'FamilyCareInvitation' }, '@/components/FamilyCareReferrer': { default: 'FamilyCareReferrer' }, '@/hooks/use-session': { useSession: () => ({}) },
    '@/lib/service-home': { FAMILY_CARE_PROMOTION_URL, resolveInsuranceServiceRoute, resolveServiceInformationKey, SERVICE_INFORMATION_KEYS },
    '@/lib/open-external-url': { openExternalUrl: openPromotion }, '@/lib/theme': { COLORS },
  });
  let renderer!: Renderer;
  await act(async () => { renderer = create(createElement(Care)); });
  expect(texts(renderer.root).some(text => text.includes('소속·등록을 요구하는 보험은 등록이 필요해요.'))).toBe(true);
  expect(texts(renderer.root).some(text => text.includes('앱에서 가족간병을 신청하는 기능은 준비 중이에요.'))).toBe(true);
  expect(renderer.root.findAllByType('FamilyCareInvitation')).toHaveLength(1);
  expect(renderer.root.findAllByType('FamilyCareReferrer')).toHaveLength(0);
  await act(async () => { await (renderer.root.findAllByType('ServiceAction')[0].props.onPress as () => Promise<void>)(); });
  expect(openPromotion).toHaveBeenCalledWith(FAMILY_CARE_PROMOTION_URL, { sameWindowOnWeb: true });
  expect(new URL(FAMILY_CARE_PROMOTION_URL).search).toBe('');
  await act(async () => renderer.unmount());
});

it.each([['SABCDEF12345', true, 1], ['SABCDEF12345', false, 0], [undefined, true, 1]])('care page shows the care referrer next to the invitation for link code %s, signed in %s', async (code, signedIn, shown) => {
  const Care = executeComponent('app/services/[service].tsx', {
    '@expo/vector-icons': { Feather: 'Feather' },
    'expo-router': { router: { push: jest.fn(), replace: jest.fn() }, useLocalSearchParams: () => ({ service: 'care', code }) },
    '@/components/ServiceInformation': { default: 'ServiceInformation', ServiceAction: 'ServiceAction', informationStyles: {} },
    '@/components/FamilyCareInvitation': { default: 'FamilyCareInvitation' }, '@/components/FamilyCareReferrer': { default: 'FamilyCareReferrer' },
    '@/hooks/use-session': { useSession: () => ({ isPlatformSignedIn: signedIn }) },
    '@/lib/service-home': { FAMILY_CARE_PROMOTION_URL, resolveInsuranceServiceRoute, resolveServiceInformationKey, SERVICE_INFORMATION_KEYS },
    '@/lib/open-external-url': { openExternalUrl: jest.fn() }, '@/lib/theme': { COLORS },
  });
  let renderer!: Renderer;
  await act(async () => { renderer = create(createElement(Care)); });
  const referrer = renderer.root.findAllByType('FamilyCareReferrer');
  expect(referrer).toHaveLength(shown);
  if (shown) expect(referrer[0].props.inviteCode).toBe(code);
  expect(renderer.root.findAllByType('FamilyCareInvitation')).toHaveLength(1);
  await act(async () => renderer.unmount());
});

it.each([['help', '내 정보 · 회원가입', '/services/account'], ['hospital', '제휴병원 찾아보기', '/services/hospitals']])(
  '%s information opens its static leaf with NAVIGATE on repeated presses', async (service, label, destination) => {
    const navigate = jest.fn(); const push = jest.fn();
    const Information = executeComponent('app/services/[service].tsx', {
      '@expo/vector-icons': { Feather: 'Feather' },
      'expo-router': { router: { navigate, push, replace: jest.fn() }, useLocalSearchParams: () => ({ service }) },
      'react-native': { Alert: { alert: jest.fn() }, Text: 'Text', View: 'View', StyleSheet: { create: (styles: unknown) => styles } },
      '@/components/ServiceInformation': { default: 'ServiceInformation', ServiceAction: 'ServiceAction', informationStyles: {} },
      '@/components/FamilyCareInvitation': { default: 'FamilyCareInvitation' }, '@/components/FamilyCareReferrer': { default: 'FamilyCareReferrer' }, '@/hooks/use-session': { useSession: () => ({}) },
      '@/lib/service-home': { FAMILY_CARE_PROMOTION_URL, resolveInsuranceServiceRoute, resolveServiceInformationKey, SERVICE_INFORMATION_KEYS },
      '@/lib/open-external-url': { openExternalUrl: jest.fn() }, '@/lib/theme': { COLORS },
    });
    let renderer!: Renderer;
    await act(async () => { renderer = create(createElement(Information)); });
    await act(async () => { const press = renderer.root.findAllByType('ServiceAction').find(node => node.props.label === label)!.props.onPress as () => void; press(); press(); });
    expect(navigate.mock.calls).toEqual([[destination], [destination]]); expect(push).not.toHaveBeenCalled();
    await act(async () => renderer.unmount());
  });

it.each(['web', 'android'])('group chat avoids a refresh wrapper on web and preserves native refresh on %s', (os) => {
  const file = ts.createSourceFile('group-chat.tsx', readFileSync(join(root, 'app/group-chat.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === 'FlatList') {
      const attribute = node.attributes.properties.find((value) => ts.isJsxAttribute(value) && value.name.getText(file) === 'refreshControl');
      if (attribute && ts.isJsxAttribute(attribute) && attribute.initializer && ts.isJsxExpression(attribute.initializer)) expression = attribute.initializer.expression;
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (!expression) throw new Error('Group chat list refresh control is missing');
  const handleRefresh = jest.fn();
  const control = new Function('exports', 'require', 'Platform', 'RefreshControl', 'refreshing', 'handleRefresh', 'HANWHA_ORANGE',
    ts.transpileModule(`return (${expression.getText(file)});`, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText)(
    {},
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (name: string) => { if (name === 'react/jsx-runtime') return require('react/jsx-runtime'); throw new Error(name); },
    { OS: os }, 'RefreshControl', true, handleRefresh, COLORS.primary,
  ) as ReactElement<{ refreshing: boolean; onRefresh: () => void; tintColor: string }> | undefined;
  if (os === 'web') {
    expect(control).toBeUndefined();
    expect(handleRefresh).not.toHaveBeenCalled();
  } else {
    expect(control?.type).toBe('RefreshControl');
    expect(control?.props.refreshing).toBe(true);
    expect(control?.props.tintColor).toBe(COLORS.primary);
    control!.props.onRefresh();
    expect(handleRefresh).toHaveBeenCalledTimes(1);
  }
});

it('M10 account delete confirmation explains retained history and cancel performs no write', async () => {
  const file = ts.createSourceFile('settings.tsx', readFileSync(join(root, 'app/settings.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback = ''; let modal = ''; let title = ''; let message = '';
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'handleDelete') callback = node.initializer!.getText(file);
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'deleteTitle') title = node.initializer!.getText(file);
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'deleteMessage') message = node.initializer!.getText(file);
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === 'Modal') modal = node.getText(file);
    ts.forEachChild(node, visit);
  }
  visit(file);
  const setShowDeleteConfirm = jest.fn(); const confirmDelete = jest.fn();
  const execute = (code: string, dependencies: Record<string, unknown>) => new Function('exports', ...Object.keys(dependencies), ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText)({}, ...Object.values(dependencies));
  const open = execute(`return (${callback});`, { canDeleteAccount: true, residentId: 'synthetic-actor', appSessionToken: 'synthetic-session', Alert: { alert: jest.fn() }, setShowDeleteConfirm }) as () => void;
  open(); expect(setShowDeleteConfirm).toHaveBeenCalledWith(true);
  // An FC linked to a 모두온 member leaves only 가람in; an unlinked FC deletes the whole account.
  const copy = (garaminOnly: boolean) => ({
    garaminOnly,
    deleteTitle: execute(`return (${title});`, { garaminOnly }) as string,
    deleteMessage: execute(`return (${message});`, { garaminOnly }) as string,
  });
  expect(copy(true)).toEqual({ garaminOnly: true, deleteTitle: '가람in 탈퇴',
    deleteMessage: expect.stringContaining('모두온 계정과 다른 서비스는 그대로예요') });
  const Modal = execute(`return function Render() { return (${modal}); };`, {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require: (name: string) => { if (name === 'react/jsx-runtime') return require('react/jsx-runtime'); throw new Error(name); },
    Modal: 'Modal', View: 'View', Text: 'Text', Pressable: 'Pressable', styles: {}, showDeleteConfirm: true, deleting: false, setShowDeleteConfirm, confirmDelete,
    ...copy(false),
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
    'expo-clipboard': { setStringAsync: jest.fn() }, '@/lib/messenger-copy-actions': { copyTextWithFeedback: jest.fn(async () => true) },
    'react-native-reanimated': { default: { ScrollView: 'ScrollView' } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ bottom: 0 }) },
    '@/components/BottomNavigation': { BottomNavigation: 'BottomNavigation' },
    '@/hooks/use-app-logout': { useAppLogout: () => jest.fn() },
    '@/hooks/use-bottom-nav-animation': { useBottomNavAnimation: () => ({ scrollHandler: jest.fn(), animatedStyle: {} }) },
    '@/hooks/use-my-referral-code': { useMyReferralCode: () => ({ data: null, isLoading: false, error: null }) },
    '@/hooks/use-session': { useSession: () => session },
    'expo-crypto': { randomUUID: jest.fn() },
    '@/lib/platform-api': { PLATFORM_WITHDRAWAL_VERSION: '2026-10-14', platformRequest: jest.fn() },
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

it('public account offers common login and keeps insurance settings within the common account', async () => {
  let session = { role: 'fc' as string | null, isPlatformSignedIn: false };
  let data: null | { member: { name: string; referralCode: string }; applications: unknown[]; benefits: unknown[] } = null;
  const push = jest.fn(); const navigate = jest.fn();
  const openPolicy = jest.fn(async () => undefined);
  const Account = executeComponent('app/services/account.tsx', {
    '@expo/vector-icons': { Feather: 'Feather' }, '@/components/Button': { Button: 'Button' },
    'expo-clipboard': { setStringAsync: jest.fn() }, '@/lib/messenger-copy-actions': { copyTextWithFeedback: jest.fn(async () => true) }, 'expo-router': { router: { push, navigate } },
    'react-native': { Alert: { alert: jest.fn() }, Pressable: 'Pressable', Text: 'Text', View: 'View' },
    '@/components/ServiceInformation': { default: 'ServiceInformation', ServiceAction: 'ServiceAction', informationStyles: {} },
    '@/hooks/use-platform-account': { usePlatformAccount: () => ({ data, loading: false, error: null, session, token: null, refresh: jest.fn() }) },
    '@/hooks/use-app-logout': { useAppLogout: () => jest.fn() }, 'expo-crypto': { randomUUID: () => '10000000-0000-4000-8000-000000000001' },
    '@/lib/platform-api': { PLATFORM_PRIVACY_POLICY_URL: 'https://example.test/privacy/', PLATFORM_SERVICES: {}, platformRequest: jest.fn() }, '@/lib/theme': { COLORS, SPACING },
    '@/lib/open-external-url': { openExternalUrl: openPolicy },
    '@/lib/request-board-api': { captureAppSessionOwner: () => () => true }, '@/lib/use-read-attempt': { useReadAttempt },
  });
  let renderer!: Renderer;
  await act(async () => { renderer = create(createElement(Account)); });
  const actions = () => renderer.root.findAllByType('ServiceAction');
  expect(actions().map((node) => node.props.label)).toEqual(expect.arrayContaining(['로그인', '회원가입']));
  for (const [label, destination] of [['로그인', '/services/login'], ['회원가입', '/services/signup']]) {
    await act(async () => { const press = actions().find(node => node.props.label === label)!.props.onPress as () => void; press(); press(); });
    expect(navigate).toHaveBeenLastCalledWith(destination);
  }
  expect(navigate).toHaveBeenCalledTimes(4); expect(push).not.toHaveBeenCalled();
  await act(async () => { (renderer.root.findAllByType('Pressable').find(node => texts(node).includes('개인정보처리방침'))!.props.onPress as () => void)(); });
  expect(openPolicy).toHaveBeenCalledWith('https://example.test/privacy/');
  data = { member: { name: '시험 회원', referralCode: 'synthetic-code' }, applications: [], benefits: [] };
  session = { role: 'fc', isPlatformSignedIn: true };
  await act(async () => { renderer.update(createElement(Account)); });
  // Signed-in destinations are one grouped list of rows, not stacked filled buttons.
  const rows = () => renderer.root.findAllByType('ActionRows').flatMap((node) => node.props.items as { label: string; onPress: () => void }[]);
  const actionGroup = renderer.root.findAllByType('View').find(node => (node.props.style as { gap?: number })?.gap === SPACING.md)!;
  expect(actionGroup).toBeDefined();
  expect(actionGroup.findAllByType('ActionRows')).toHaveLength(1);
  expect(rows().map((row) => row.label)).toEqual(['서비스 이용내역', '보험 계정 설정', '로그아웃']);
  expect(actionGroup.findAllByType('Pressable').some(node => node.props.accessibilityRole === 'link')).toBe(true);
  await act(async () => { const press = rows().find((row) => row.label === '서비스 이용내역')!.onPress; press(); press(); });
  expect(navigate.mock.calls.slice(-2)).toEqual([['/services/activity'], ['/services/activity']]);
  await act(async () => { rows().find((row) => row.label === '보험 계정 설정')!.onPress(); });
  expect(push).toHaveBeenCalledWith('/settings?surface=service-hub');
  session = { role: null, isPlatformSignedIn: true };
  await act(async () => { renderer.update(createElement(Account)); });
  expect(rows().some((row) => row.label === '보험 계정 설정')).toBe(false);
  expect(texts(renderer.root)).toContain('시험 회원님');
  Object.assign(session, { role: 'admin', readOnly: false, staffType: 'admin' });
  await act(async () => renderer.update(createElement(Account)));
  await act(async () => { const press = rows().find((row) => row.label === '제휴·정산 관리')!.onPress; press(); press(); });
  expect(navigate.mock.calls.slice(-2)).toEqual([['/services/manage'], ['/services/manage']]);
  await act(async () => { renderer.unmount(); });
});
it('existing FC account requires explicit consent, blocks repeat saves and preserves refusal navigation', async () => {
  const refresh = jest.fn(async () => undefined); const logout = jest.fn(); const push = jest.fn();
  let reject!: (error: Error) => void;
  const request = jest.fn((..._args: unknown[]) => new Promise((_resolve, rejectRequest) => { reject = rejectRequest; }));
  const Account = executeComponent('app/services/account.tsx', {
    '@expo/vector-icons': { Feather: 'Feather' }, '@/components/Button': { Button: 'Button' },
    'expo-clipboard': { setStringAsync: jest.fn() }, '@/lib/messenger-copy-actions': { copyTextWithFeedback: jest.fn(async () => true) }, 'expo-router': { router: { push } },
    'react-native': { Alert: { alert: jest.fn() }, Pressable: 'Pressable', Text: 'Text', View: 'View' },
    '@/components/ServiceInformation': { default: 'ServiceInformation', ServiceAction: 'ServiceAction', informationStyles: {} },
    '@/hooks/use-platform-account': { usePlatformAccount: () => ({ data: null, loading: false, error: '동의 필요', needsConsent: true, canWithdraw: false, session: { role: 'fc', isPlatformSignedIn: true, logout }, token: 'synthetic-fc-token', refresh }) },
    '@/hooks/use-app-logout': { useAppLogout: () => logout }, 'expo-crypto': { randomUUID: () => '10000000-0000-4000-8000-000000000001' },
    '@/lib/platform-api': { PLATFORM_CONSENT_TEXT: '검토용 동의 내용', PLATFORM_TERMS_VERSION: '2026-10-12', PLATFORM_SERVICES: {}, platformRequest: (action: string, ...args: unknown[]) => action === 'get_withdrawal' ? Promise.resolve({ ok: true, withdrawal: null }) : request(action, ...args) },
    '@/lib/request-board-api': { captureAppSessionOwner: () => () => true }, '@/lib/use-read-attempt': { useReadAttempt }, '@/lib/theme': { COLORS, SPACING },
  });
  let renderer!: Renderer;
  await act(async () => { renderer = create(createElement(Account)); });
  const save = () => renderer.root.findAllByType('Button')[0];
  expect(save().props.disabled).toBe(true);
  expect(renderer.root.findAllByType('Button').some(node => node.children.includes('공통 회원 탈퇴'))).toBe(false);
  expect(request).not.toHaveBeenCalled();
  const rows = () => renderer.root.findAllByType('ActionRows').flatMap((node) => node.props.items as { label: string; onPress: () => void }[]);
  await act(async () => { rows().find((row) => row.label === '보험 계정 설정')!.onPress(); });
  expect(push).toHaveBeenCalledWith('/settings?surface=service-hub');
  await act(async () => { (renderer.root.findAllByType('Pressable')[0].props.onPress as () => void)(); });
  await act(async () => { (save().props.onPress as () => void)(); (save().props.onPress as () => void)(); });
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith('accept_terms', { termsAccepted: true, termsVersion: '2026-10-12' }, 'synthetic-fc-token');
  await act(async () => { reject(new Error('합성 연결 실패')); });
  expect(texts(renderer.root)).toContain('합성 연결 실패');
  expect(renderer.root.findAllByType('Pressable')[0].props.accessibilityState).toEqual(expect.objectContaining({ checked: true }));
  request.mockResolvedValueOnce({ ok: true } as never);
  await act(async () => { await (save().props.onPress as () => Promise<void>)(); });
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => { rows().find((row) => row.label === '로그아웃')!.onPress(); });
  expect(logout).toHaveBeenCalledTimes(1);
  await act(async () => { renderer.unmount(); });
});
it.each(['fc', 'member'])('common withdrawal remains available with expired consent and closes linked %s accounts only on a completed receipt', async kind => {
  let buttons!: { text: string; style?: string; onPress?: () => void }[];
  let resolve!: (value: unknown) => void;
  let reject!: (cause: Error) => void;
  const request = jest.fn((..._args: unknown[]) => new Promise((done, failed) => { resolve = done; reject = failed; }));
  const refresh = jest.fn(async () => undefined); const logout = jest.fn(); const replace = jest.fn();
  const logoutAll = jest.fn(); const useLogout = jest.fn(() => () => logoutAll());
  const operationId = '10000000-0000-4000-8000-000000000001';
  const nextOperationId = '10000000-0000-4000-8000-000000000002';
  const createId = jest.fn().mockReturnValueOnce(operationId).mockReturnValue(nextOperationId);
  let token = 'synthetic-session'; let ownerRevision = 0;
  let canWithdraw = true; let lookupFailed = false;
  let savedWithdrawal: null | Record<string, unknown> = null;
  const readWithdrawal = jest.fn(async () => {
    if (lookupFailed) throw new Error('synthetic lookup unavailable');
    return { ok: true, withdrawal: savedWithdrawal };
  });
  const alert = jest.fn((_title, _body, actions) => { buttons = actions; });
  const Account = executeComponent('app/services/account.tsx', {
    '@expo/vector-icons': { Feather: 'Feather' }, '@/components/Button': { Button: 'Button' },
    'expo-clipboard': { setStringAsync: jest.fn() }, '@/lib/messenger-copy-actions': { copyTextWithFeedback: jest.fn(async () => true) }, 'expo-router': { router: { replace } },
    'react-native': { Alert: { alert }, Pressable: 'Pressable', Text: 'Text', View: 'View' },
    '@/components/ServiceInformation': { default: 'ServiceInformation', ServiceAction: 'ServiceAction', informationStyles: {} },
    '@/hooks/use-platform-account': { usePlatformAccount: () => ({ data: null, loading: false, error: '동의 필요', needsConsent: true, canWithdraw, session: { role: kind === 'fc' ? 'fc' : null, isPlatformSignedIn: true, logout }, token, refresh }) },
    '@/hooks/use-app-logout': { useAppLogout: useLogout }, 'expo-crypto': { randomUUID: createId },
    '@/lib/platform-api': { PLATFORM_CONSENT_TEXT: '검토용 동의 내용', PLATFORM_TERMS_VERSION: '2026-10-12', PLATFORM_WITHDRAWAL_VERSION: '2026-10-14', PLATFORM_SERVICES: {}, platformRequest: (action: string, ...args: unknown[]) => action === 'get_withdrawal' ? readWithdrawal() : request(action, ...args) },
    '@/lib/request-board-api': { captureAppSessionOwner: () => { const captured = ownerRevision; return () => captured === ownerRevision; } }, '@/lib/use-read-attempt': { useReadAttempt }, '@/lib/theme': { COLORS, SPACING },
  });
  let renderer!: Renderer;
  await act(async () => { renderer = create(createElement(Account)); });
  const remove = () => renderer.root.findAllByType('Button').find(node => node.children.includes('공통 회원 탈퇴') || node.children.includes('탈퇴 처리 재시도') || node.children.includes('탈퇴 요청 다시 확인'))!;
  const actionGroup = renderer.root.findAllByType('View').find(node => (node.props.style as { gap?: number })?.gap === SPACING.md)!;
  expect(actionGroup.findAllByType('Button')).toContain(remove());
  // Withdrawal is a quiet text action under the list, never a filled or outlined block.
  expect(remove().props.variant).toBe('ghost');
  await act(async () => { (remove().props.onPress as () => void)(); });
  expect(buttons[0]).toMatchObject({ text: '취소', style: 'cancel' });
  expect(request).not.toHaveBeenCalled();
  expect(alert.mock.calls[0][1]).toContain('추천 관계를 연결하는 식별자는 남습니다');
  expect(alert.mock.calls[0][1]).toContain('가족간병·보험(가람in)·통신·렌탈·자동차·제휴병원');
  expect(alert.mock.calls[0][1]).toContain('가람링크 계정');
  expect(alert.mock.calls[0][1]).toContain('관리자·본부장 등 회사 업무 계정은 유지됩니다');
  await act(async () => { buttons[1].onPress!(); buttons[1].onPress!(); });
  expect(request).toHaveBeenCalledTimes(1);
  const payload = { confirmed: true, scope: 'all_affiliates', policyVersion: '2026-10-14', idempotencyKey: operationId };
  expect(request).toHaveBeenCalledWith('withdraw_member', payload, 'synthetic-session');
  expect(remove().props.loading).toBe(true);
  savedWithdrawal = { ok: true, operationId, status: 'pending', deleted: false, cleanupPending: true, reason: 'affiliate_identity_unbound' };
  await act(async () => { reject(new Error('synthetic lost withdrawal response')); });
  canWithdraw = false;
  await act(async () => { renderer.update(createElement(Account)); });
  expect(remove().children).toContain('탈퇴 처리 재시도');
  expect(logoutAll).not.toHaveBeenCalled();
  await act(async () => { (remove().props.onPress as () => void)(); buttons[1].onPress!(); });
  expect(request).toHaveBeenNthCalledWith(2, 'withdraw_member', payload, 'synthetic-session');
  await act(async () => { resolve(savedWithdrawal); });
  expect(logoutAll).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled();
  expect(texts(renderer.root).some((text) => text.includes('탈퇴가 아직 완료되지 않았습니다'))).toBe(true);
  expect(remove().props.loading).toBe(false);
  await act(async () => { (remove().props.onPress as () => void)(); });
  const abandonedConfirmation = buttons[1].onPress!;
  await act(async () => { renderer.unmount(); });
  abandonedConfirmation();
  expect(request).toHaveBeenCalledTimes(2);
  canWithdraw = false; lookupFailed = true;
  await act(async () => { renderer = create(createElement(Account)); });
  expect(remove().children).toContain('탈퇴 요청 다시 확인');
  lookupFailed = false;
  await act(async () => { (remove().props.onPress as () => void)(); });
  expect(request).toHaveBeenCalledTimes(2);
  expect(remove().children).toContain('탈퇴 처리 재시도');
  await act(async () => { (remove().props.onPress as () => void)(); buttons[1].onPress!(); });
  expect(request).toHaveBeenNthCalledWith(3, 'withdraw_member', payload, 'synthetic-session');
  await act(async () => { resolve({ ok: true, operationId, status: 'completed', deleted: true, cleanupPending: false }); });
  expect(useLogout).toHaveBeenCalledWith('/', 'service-hub'); expect(logoutAll).toHaveBeenCalledTimes(1);
  expect(refresh).not.toHaveBeenCalled(); expect(logout).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled();
  expect(createId).toHaveBeenCalledTimes(1);
  savedWithdrawal = null; canWithdraw = true;
  token = 'synthetic-next-session'; ownerRevision += 1;
  await act(async () => { renderer.update(createElement(Account)); });
  await act(async () => { (remove().props.onPress as () => void)(); buttons[1].onPress!(); });
  expect(request).toHaveBeenNthCalledWith(4, 'withdraw_member', { ...payload, idempotencyKey: nextOperationId }, token);
  token = 'synthetic-third-session'; ownerRevision += 1;
  await act(async () => { renderer.update(createElement(Account)); });
  await act(async () => { resolve({ ok: true, operationId: nextOperationId, status: 'completed', deleted: true, cleanupPending: false }); });
  expect(logoutAll).toHaveBeenCalledTimes(1); expect(remove().props.loading).toBe(false);
  await act(async () => { renderer.unmount(); });
});
it('common account preserves a connection failure and clears withdrawn data while separating enrollment from renewed consent', async () => {
  class ApiError extends Error { constructor(public code: string, public status: number) { super(code); } }
  const response = { member: { name: '합성 회원', termsAccepted: true } };
  const request = jest.fn().mockResolvedValue(response);
  let state!: { data: typeof response | null; needsConsent: boolean; canWithdraw: boolean; refresh: () => Promise<void> };
  const useAccount = executeComponent('hooks/use-platform-account.ts', {
    '@/hooks/use-session': { useSession: () => ({ hydrated: true, role: 'fc', appSessionToken: 'synthetic-fc-token', platformMember: null }) },
    '@/lib/platform-api': { PlatformApiError: ApiError, platformRequest: request }, '@/lib/use-read-attempt': { useReadAttempt },
  }, 'usePlatformAccount') as unknown as () => typeof state;
  const Probe = () => { state = useAccount(); return null; };
  let renderer!: Renderer;
  await act(async () => { renderer = create(createElement(Probe)); });
  expect(state.data).toEqual(response);
  request.mockRejectedValue(new Error('시험 연결 실패'));
  await act(async () => { await state.refresh(); });
  expect(state.data).toEqual(response); expect(state.canWithdraw).toBe(true);
  request.mockRejectedValue(new ApiError('consent_required', 409));
  await act(async () => { await state.refresh(); });
  expect(state.data).toBeNull(); expect(state.needsConsent).toBe(true); expect(state.canWithdraw).toBe(true);
  request.mockRejectedValue(new ApiError('enrollment_required', 409));
  await act(async () => { await state.refresh(); });
  expect(state.data).toBeNull(); expect(state.needsConsent).toBe(true); expect(state.canWithdraw).toBe(false);
  expect(request.mock.calls.every(([action]) => action === 'get_account')).toBe(true);
  request.mockResolvedValue(response);
  await act(async () => { await state.refresh(); });
  expect(state.data).toEqual(response); expect(state.needsConsent).toBe(false); expect(state.canWithdraw).toBe(true);
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

it('hospital discovery filters both placements, measures visible cards and preserves only matching failed reads', async () => {
  const specialties = ['한방병원', '정형외과', '안과', '치과', '성형외과', '건강검진센터'];
  const hospital = { id: 'synthetic-hospital', name: '시험병원', region: '서울 강남구', address: '시험 주소', specialties: ['치과'], description: '시험용 병원 소개입니다.', photoUrl: 'https://synthetic.invalid/clinic.png', adPlacement: 'regional_list' };
  const featured = [{ ...hospital, adPlacement: 'regional_featured' }, { ...hospital, id: 'synthetic-hospital-2', name: '다른 시험병원', adPlacement: 'regional_featured' }];
  const exposure = jest.fn();
  const push = jest.fn();
  const request = jest.fn(async (action: string) => action === 'get_hospital_regions'
    ? { regions: [{ provinceCode: '11', provinceName: '서울', districts: ['강남구'] }], specialties: ['내과', '이비인후과', '피부과'] }
    : { hospitals: [hospital], featured, hasMore: false, nextOffset: null });
  const Hospitals = executeComponent('app/services/hospitals.tsx', {
    '@expo/vector-icons': { MaterialIcons: 'MaterialIcons' }, 'expo-router': { router: { push } },
    'react-native': { ActivityIndicator: 'ActivityIndicator', Image: 'Image', Modal: 'Modal', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View', StyleSheet: { create: (styles: unknown) => styles },
      FlatList: (props: Record<string, unknown>) => createElement('FlatList', props, props.ListHeaderComponent as ReactElement,
        ...(props.data as unknown[]).map((item, index) => createElement(React.Fragment, { key: index }, (props.renderItem as (value: unknown) => ReactElement)({ item }))), props.ListFooterComponent as ReactElement) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
    '@/components/Button': { Button: 'Button' }, '@/components/FormInput': { FormInput: 'FormInput' },
    '@/components/hospitals/HospitalScreen': { default: (props: Record<string, unknown>) => createElement('HospitalScreen', props, props.headerActions as ReactElement, props.children as ReactElement), hospitalStyles: {} },
    '@/components/hospitals/DepartmentIcon': { default: 'DepartmentIcon', DepartmentIcon: 'DepartmentIcon' },
    '@/components/service-home': { ServiceIcon: 'ServiceIcon' },
    '@/hooks/use-hospital-exposure': { useHospitalExposure: exposure },
    '@/lib/platform-api': { HOSPITAL_DIRECTORY_SPECIALTIES: specialties, isSampleHospital: () => false, platformRequest: request }, '@/lib/theme': { COLORS }, '@/lib/use-read-attempt': { useReadAttempt },
  });
  let renderer!: Renderer;
  await act(async () => { renderer = create(createElement(Hospitals)); });
  const flat = () => renderer.root.findAllByType('FlatList')[0];
  const rows = () => flat().props.data;
  const press = async (label: string) => { await act(async () => {
    const button = renderer.root.findAllByType('Pressable').find((node) => node.props.accessibilityLabel === label || texts(node).includes(label))!;
    (button.props.onPress as () => void)();
  }); };
  const carouselFrame = () => renderer.root.findAllByType('View').find((node) => node.props.onLayout)!;
  const carousel = () => renderer.root.findAllByType('ScrollView').find((node) => node.props.onScroll)!;
  expect(request).toHaveBeenCalledWith('list_hospitals', { provinceCode: '', district: '', search: '', specialty: '', offset: 0, limit: 20 });
  expect(texts(renderer.root)).toEqual(expect.arrayContaining(['진료과로 찾기', '제휴병원 소개', '전체 제휴병원']));
  expect(renderer.root.findAllByType('DepartmentIcon').map((node) => node.props.specialty)).toEqual(['한방병원', '정형외과', '안과', '치과', '성형외과', '건강검진센터']);
  expect(texts(renderer.root)).not.toEqual(expect.arrayContaining(['전체 보기']));
  expect(texts(renderer.root)).toContain(hospital.description);
  expect(texts(renderer.root).filter((value) => value === '병원 알아보기 →')).toHaveLength(2);
  expect(renderer.root.findAllByType('Image').map((node) => (node.props.source as { uri: string }).uri)).toEqual([hospital.photoUrl, hospital.photoUrl, hospital.photoUrl]);
  expect(rows()).toEqual([hospital]);
  await act(async () => { (flat().props.onViewableItemsChanged as (event: unknown) => void)({ viewableItems: [{ isViewable: true, item: hospital }] }); });
  expect(exposure).toHaveBeenLastCalledWith([hospital]);
  await act(async () => {
    (flat().props.onLayout as (event: unknown) => void)({ nativeEvent: { layout: { width: 390, height: 600 } } });
    (carouselFrame().props.onLayout as (event: unknown) => void)({ nativeEvent: { layout: { y: 300, height: 240 } } });
  });
  expect(exposure).toHaveBeenLastCalledWith([featured[0], hospital]);
  // Half visibility on both axes can still expose less than half of the actual area.
  await act(async () => {
    (carouselFrame().props.onLayout as (event: unknown) => void)({ nativeEvent: { layout: { y: 420, height: 240 } } });
    (carousel().props.onScroll as (event: unknown) => void)({ nativeEvent: { contentOffset: { x: 170 } } });
  });
  expect(exposure).toHaveBeenLastCalledWith([featured[1], hospital]);
  const detailButtons = renderer.root.findAllByType('Pressable').filter((node) => node.props.accessibilityLabel === `${hospital.name} 병원 상세 보기, 광고`);
  await act(async () => { (detailButtons[0].props.onPress as () => void)(); (detailButtons[1].props.onPress as () => void)(); });
  expect(push.mock.calls).toEqual([
    [{ pathname: '/services/hospital', params: { id: hospital.id, placement: 'regional_featured' } }],
    [{ pathname: '/services/hospital', params: { id: hospital.id, placement: 'regional_list' } }],
  ]);
  await press('시·도 선택, 전국');
  expect(exposure).toHaveBeenLastCalledWith([]);
  await act(async () => { (renderer.root.findAllByType('Modal')[0].props.onRequestClose as () => void)(); });
  expect(exposure).toHaveBeenLastCalledWith([featured[1], hospital]);
  await press('시·도 선택, 전국'); await press('서울');
  expect(request).toHaveBeenLastCalledWith('list_hospitals', expect.objectContaining({ provinceCode: '11', district: '' }));
  await press('시·군·구 선택, 전체'); await press('강남구');
  expect(request).toHaveBeenLastCalledWith('list_hospitals', expect.objectContaining({ provinceCode: '11', district: '강남구' }));
  await press('치과 선택');
  expect(request).toHaveBeenLastCalledWith('list_hospitals', expect.objectContaining({ provinceCode: '11', district: '강남구', specialty: '치과' }));
  const specialtyChips = renderer.root.findAllByType('ScrollView').find((node) => node.props.horizontal && !node.props.onScroll)!.findAllByType('Pressable');
  expect(specialtyChips.map((node) => texts(node).join(''))).toEqual(['전체 진료 분야', '한방병원', '정형외과', '안과', '치과', '성형외과', '건강검진센터']);
  expect(texts(renderer.root)).toContain('검색 결과');
  expect(texts(renderer.root)).not.toContain('제휴병원 소개');
  await press('검색 초기화');
  expect(request).toHaveBeenLastCalledWith('list_hospitals', expect.objectContaining({ provinceCode: '11', district: '강남구', search: '', specialty: '' }));
  await press('시·도 선택, 서울'); await press('전국');
  expect(request).toHaveBeenLastCalledWith('list_hospitals', expect.objectContaining({ provinceCode: '', district: '' }));
  request.mockRejectedValue(new Error('시험 연결 실패'));
  const input = () => renderer.root.findAllByType('FormInput')[0];
  await act(async () => { (input().props.onSubmitEditing as () => void)(); });
  expect(rows()).toEqual([hospital]);
  expect(texts(renderer.root)).toContain('시험 연결 실패');
  expect(texts(renderer.root)).toContain('제휴병원 소개');
  await act(async () => { (input().props.onChangeText as (value: string) => void)('다른 병원'); });
  await act(async () => { (input().props.onSubmitEditing as () => void)(); });
  expect(rows()).toEqual([]);
  expect(texts(renderer.root)).toContain('시험 연결 실패');
  expect(texts(renderer.root)).not.toContain('제휴병원 소개');
  await act(async () => { renderer.unmount(); });
});

it('hospital detail opens contact even when measurement fails and hides stale detail after withdrawal', async () => {
  class ApiError extends Error { constructor(public code: string) { super(code); } }
  const hospital = { id: 'synthetic-hospital', name: '시험병원', region: '서울 강남구', address: '시험 주소', phone: '02-000-0000', specialties: [], photoUrl: null, verifiedAt: '2026-10-11', adPlacement: 'regional_list' };
  const request = jest.fn().mockResolvedValue({ hospital });
  const open = jest.fn().mockResolvedValue(undefined);
  const record = jest.fn();
  const Detail = executeComponent('app/services/hospital.tsx', {
    '@expo/vector-icons': { MaterialIcons: 'MaterialIcons' }, 'expo-application': { applicationId: 'synthetic.app' },
    'expo-router': { router: { push: jest.fn() }, useLocalSearchParams: () => ({ id: hospital.id }) },
    'react-native': { ActivityIndicator: 'ActivityIndicator', Image: 'Image', Platform: { OS: 'android' }, Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View', StyleSheet: { create: (styles: unknown) => styles } },
    '@/components/Button': { Button: 'Button' }, '@/components/hospitals/HospitalScreen': { default: 'HospitalScreen', IconTile: 'IconTile', hospitalStyles: {} },
    '@/lib/external-url': { formatExternalUrlDisplayText },
    '@/components/service-home': { ServiceIcon: 'ServiceIcon' },
    '@/hooks/use-hospital-exposure': { useHospitalExposure: () => 'synthetic-session', recordHospitalEvent: record },
    '@/lib/open-external-url': { openExternalUrl: open }, '@/lib/theme': { COLORS }, '@/lib/use-read-attempt': { useReadAttempt },
    '@/lib/platform-api': { platformRequest: request, PlatformApiError: ApiError, isSampleHospital: () => false, acceptsCareRequests: () => false },
  });
  let renderer!: Renderer;
  await act(async () => { renderer = create(createElement(Detail)); });
  const button = (label: string) => renderer.root.findAllByType('Button').find((node) => node.children.includes(label))!;
  await act(async () => { (button('전화 문의').props.onPress as () => void)(); });
  expect(record).toHaveBeenCalledWith(hospital, 'phone', 'synthetic-session');
  expect(open).toHaveBeenCalledWith('tel:020000000', { preferExternalBrowser: true });
  // Directions open the Naver Map app first and fall back to its web page when the app is missing.
  const place = encodeURIComponent('시험병원 시험 주소');
  await act(async () => { (button('위치·길찾기').props.onPress as () => void)(); });
  expect(record).toHaveBeenLastCalledWith(hospital, 'directions', 'synthetic-session');
  expect(open).toHaveBeenLastCalledWith(`nmap://search?query=${place}&appname=synthetic.app`);
  open.mockRejectedValueOnce(new Error('no app'));
  await act(async () => { (button('위치·길찾기').props.onPress as () => void)(); });
  expect(open).toHaveBeenLastCalledWith(`https://map.naver.com/p/search/${place}`, { preferExternalBrowser: true });
  request.mockRejectedValue(new Error('시험 연결 실패'));
  await act(async () => { (button('정보 다시 확인').props.onPress as () => void)(); });
  expect(texts(renderer.root)).toContain('시험 연결 실패');
  expect(texts(renderer.root)).toContain(hospital.name);
  request.mockResolvedValue({ hospital });
  await act(async () => { (button('다시 확인하기').props.onPress as () => void)(); });
  request.mockRejectedValue(new ApiError('hospital_not_found'));
  // A withdrawn ad removes cached contact actions after the next read.
  await act(async () => { (button('정보 다시 확인').props.onPress as () => void)(); });
  expect(texts(renderer.root)).not.toContain(hospital.name);
  expect(renderer.root.findAllByType('Button').some((node) => node.children.includes('전화 문의'))).toBe(false);
  await act(async () => { renderer.unmount(); });
});

it('hospital exposure waits one visible second, cancels on blur and ignores measurement failure', async () => {
  jest.useFakeTimers();
  let focused = true;
  let appState = 'active';
  let onState!: () => void;
  const request = jest.fn().mockRejectedValue(new Error('measurement unavailable'));
  const useExposure = executeComponent('hooks/use-hospital-exposure.ts', {
    '@react-navigation/native': { useIsFocused: () => focused }, 'expo-crypto': { randomUUID: () => 'synthetic-uuid' },
    'react-native': { AppState: { get currentState() { return appState; }, addEventListener: (_: string, callback: () => void) => { onState = callback; return { remove: jest.fn() }; } }, Platform: { OS: 'android' } },
    '@/lib/platform-api': { platformRequest: request },
  }, 'useHospitalExposure') as unknown as (hospitals: unknown[]) => string;
  let hospitals = [{ id: 'synthetic-hospital', measurementToken: 'synthetic-receipt', adPlacement: 'regional_featured', revision: 1 }];
  const Probe = ({ visible = true }) => { useExposure(visible ? hospitals : []); return null; };
  let renderer!: Renderer;
  try {
    await act(async () => { renderer = create(createElement(Probe)); jest.advanceTimersByTime(900); });
    expect(request).not.toHaveBeenCalled();
    focused = false;
    await act(async () => { renderer.update(createElement(Probe)); jest.advanceTimersByTime(200); });
    expect(request).not.toHaveBeenCalled();
    focused = true;
    await act(async () => { renderer.update(createElement(Probe)); });
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('record_hospital_event', expect.objectContaining({ eventType: 'impression', hospitalId: 'synthetic-hospital', measurementToken: 'synthetic-receipt' }));
    appState = 'background';
    await act(async () => { onState(); });
    appState = 'active';
    await act(async () => { onState(); jest.advanceTimersByTime(2000); });
    expect(request).toHaveBeenCalledTimes(1);
    hospitals = [{ ...hospitals[0], adPlacement: 'regional_list' }];
    await act(async () => { renderer.update(createElement(Probe)); });
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith('record_hospital_event', expect.objectContaining({ placement: 'regional_list' }));
    hospitals = [{ ...hospitals[0], revision: 2 }];
    await act(async () => { renderer.update(createElement(Probe)); });
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(request).toHaveBeenCalledTimes(3);
  } finally { await act(async () => { renderer.unmount(); }); jest.useRealTimers(); }
});

it('hospital admin requires publication approvals, blocks duplicate saves and keeps a failed draft', async () => {
  const emptyHospital = { provinceCode: '', district: '', specialties: '', description: '', photoUrl: '', openingHours: '', verifiedAt: '', materialApproved: false, reviewRequired: null, reviewNumber: '', reviewExpiresAt: '' };
  const guard = jest.fn();
  let rejectSave!: (error: Error) => void;
  const request = jest.fn((action: string) => action === 'get_admin' ? Promise.resolve({ partners: [], applications: [], settlements: [], benefits: [] }) : new Promise((_, reject) => { rejectSave = reject; }));
  const Manage = executeComponent('app/services/manage.tsx', {
    'expo-crypto': { randomUUID: () => 'synthetic-partner' },
    '@/components/Button': { Button: 'Button' }, '@/components/FormInput': { FormInput: 'FormInput' },
    '@/components/hospitals/HospitalContractFields': { default: 'HospitalContractFields', EMPTY_HOSPITAL_DRAFT: emptyHospital },
    '@/components/hospitals/HospitalPerformanceReport': { default: 'HospitalPerformanceReport' },
    '@/components/hospitals/CareRequestAdmin': { default: 'CareRequestAdmin' },
    '@/components/ServiceInformation': { default: 'ServiceInformation', ServiceAction: 'ServiceAction', informationStyles: {} },
    '@/hooks/use-draft-exit-guard': { useDraftExitGuard: guard },
    '@/hooks/use-session': { useSession: () => ({ hydrated: true, role: 'admin', readOnly: false, staffType: 'admin', appSessionToken: 'synthetic-admin' }) },
    '@/lib/board-comment-request': { createCreationRequestTracker },
    '@/lib/admin-assisted-signup-validation': { getSeoulTodayIsoDate: () => '2026-10-11' }, '@/lib/calendar-date': { parseCalendarDate },
    '@/lib/platform-api': { PLATFORM_SERVICES: { care: '가족간병', hospital: '제휴병원' }, HOSPITAL_PROVINCES: [{ code: '11', name: '서울' }], platformRequest: request, PlatformApiError: Error },
    '@/lib/use-read-attempt': { useReadAttempt },
  });
  let renderer!: Renderer;
  await act(async () => { renderer = create(createElement(Manage)); });
  const button = (label: string) => renderer.root.findAllByType('Button').find((node) => node.children.includes(label))!;
  const editor = () => renderer.root.findAllByType('HospitalContractFields')[0];
  const picker = (label: string) => ['OptionSheetField', 'SegmentedControl', 'ChoiceRows'].flatMap((type) => renderer.root.findAllByType(type)).find((node) => node.props.label === label)!;
  expect(picker('제휴 서비스').props.options).toContainEqual({ value: 'hospital', label: '제휴병원' });
  await act(async () => { (picker('제휴 서비스').props.onChange as (value: string) => void)('hospital'); });
  await act(async () => {
    for (const [key, value] of Object.entries({ name: '시험 병원', address: '시험 주소', adPeriodStart: '2026-10-01', adPeriodEnd: '2026-10-31', adFee: '10000' })) {
      const input = renderer.root.findAllByType('FormInput').find((node) => node.props.accessibilityLabel === key)!;
      (input.props.onChangeText as (text: string) => void)(value);
    }
    (editor().props.onChange as (value: unknown) => void)({ ...emptyHospital, provinceCode: '11', district: '강남구', specialties: '내과, 재활의학과', verifiedAt: '2026-10-11' });
    (picker('계약 노출 위치').props.onChange as (value: string) => void)('regional_featured');
    (renderer.root.findAllByType('Pressable').find((node) => node.props.accessibilityLabel === '제휴사 활성화')!.props.onPress as () => void)();
  });
  await act(async () => { (button('합의된 제휴사 등록').props.onPress as () => void)(); });
  expect(texts(renderer.root)).toContain('병원 소재 승인과 의료광고 심의 대상 여부를 먼저 확인해 주세요.');
  expect(request.mock.calls.filter(([action]) => action === 'save_partner')).toHaveLength(0);
  await act(async () => { (editor().props.onChange as (value: unknown) => void)({ ...editor().props.draft as object, materialApproved: true, reviewRequired: false }); });
  expect(guard).toHaveBeenLastCalledWith(true, false);
  await act(async () => { (button('합의된 제휴사 등록').props.onPress as () => void)(); (button('합의된 제휴사 등록').props.onPress as () => void)(); });
  expect(request.mock.calls.filter(([action]) => action === 'save_partner')).toHaveLength(1);
  expect(request).toHaveBeenCalledWith('save_partner', expect.objectContaining({ serviceKey: 'hospital', provinceCode: '11', district: '강남구', specialties: ['내과', '재활의학과'], materialApproved: true, reviewRequired: false, expectedRevision: 0, adPlacement: 'regional_featured', active: true }), 'synthetic-admin');
  await act(async () => { rejectSave(new Error('시험 저장 실패')); });
  expect(editor().props.draft).toEqual(expect.objectContaining({ district: '강남구', reviewRequired: false }));
  expect(texts(renderer.root)).toContain('시험 저장 실패');
  await act(async () => { renderer.unmount(); });
});

it('care reservation reuses one key for a retried submit, shows staff answers and the pre-care checklist only when confirmed', async () => {
  const careTypes = { full_day: '24시간 간병', day_time: '주간 간병' };
  const contactTimes = { morning: '오전', afternoon: '오후', evening: '저녁', anytime: '언제든' };
  const statuses = { requested: '접수됨', reviewing: '확인 중', confirmed: '확정', adjusted: '일정 조정', declined: '진행 어려움', cancelled: '취소함' };
  const confirmed = { id: 'synthetic-request', hospitalId: 'synthetic-care-hospital', hospitalName: '시험병원', desiredStart: '2026-10-21', careType: 'full_day',
    contactTime: 'morning', status: 'confirmed', staffNote: '시험 안내', respondedAt: null, createdAt: '2026-10-20T00:00:00Z' };
  let listed: unknown[] = [];
  let failSubmit = true;
  const request = jest.fn(async (action: string, ..._args: unknown[]) => {
    if (action === 'list_hospital_care') return { requests: listed };
    if (failSubmit) { failSubmit = false; throw new Error('시험 연결 실패'); }
    listed = [confirmed];
    return { requestId: confirmed.id, status: 'requested' };
  });
  let keys = 0;
  const registerPush = jest.fn(async () => ({ ok: true }));
  const Screen = executeComponent('app/services/care-request.tsx', {
    '@/lib/notifications': { registerPlatformMemberPushToken: registerPush },
    '@expo/vector-icons': { MaterialIcons: 'MaterialIcons' }, 'expo-crypto': { randomUUID: () => `synthetic-key-${++keys}` },
    'expo-router': { router: { push: jest.fn() }, useLocalSearchParams: () => ({ hospitalId: 'synthetic-care-hospital' }) },
    'react-native': { ActivityIndicator: 'ActivityIndicator', Alert: { alert: jest.fn() }, Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View', StyleSheet: { create: (styles: unknown) => styles } },
    '@/components/Button': { Button: 'Button' },
    '@/components/hospitals/HospitalScreen': { default: 'HospitalScreen', CareStatusBadge: 'CareStatusBadge', IconTile: 'IconTile', hospitalStyles: {} },
    '@/hooks/use-session': { useSession: () => ({ hydrated: true, platformSessionToken: 'synthetic-member' }) },
    '@/lib/hospital-care': { CARE_PRECAUTIONS: ['시험 주의사항'], CARE_STATUS_TONES, CARE_WEEKDAYS, careCalendarMonths,
      careStartOptions: () => [{ value: '2026-10-21', label: '내일', weekday: '수' }], formatCareDate: (value: string) => value, formatCareTime: (value: string) => value },
    '@/lib/platform-api': { CARE_HOSPITAL_ID: 'synthetic-care-hospital', CARE_REQUEST_STATUSES: statuses, CARE_TYPES: careTypes, CONTACT_TIMES: contactTimes, PlatformApiError: Error, platformRequest: request },
    '@/lib/theme': { COLORS }, '@/lib/use-read-attempt': { useReadAttempt },
  });
  let renderer!: Renderer;
  await act(async () => { renderer = create(createElement(Screen)); });
  expect(texts(renderer.root)).toContain('아직 요청한 내역이 없습니다.');
  expect(registerPush).toHaveBeenCalledWith('synthetic-member');
  const submit = () => renderer.root.findAllByType('Button').find((node) => node.children.includes('예약 요청 보내기'))!;
  expect(submit().props.disabled).toBe(true);
  const choose = (label: string) => (renderer.root.findAllByType('Pressable').find((node) => node.props.accessibilityLabel === label || texts(node).includes(label))!.props.onPress as () => void)();
  await act(async () => { choose('10월 21일 수요일'); choose('24시간 간병'); });
  expect(submit().props.disabled).toBe(false);
  await act(async () => { (submit().props.onPress as () => void)(); });
  expect(texts(renderer.root)).toContain('시험 연결 실패');
  await act(async () => { (submit().props.onPress as () => void)(); });
  const submits = request.mock.calls.filter(([action]) => action === 'request_hospital_care');
  expect(submits.map(([, payload]) => (payload as { idempotencyKey: string }).idempotencyKey)).toEqual(['synthetic-key-1', 'synthetic-key-1']);
  expect(registerPush).toHaveBeenLastCalledWith('synthetic-member', { requestPermission: true });
  expect(registerPush).toHaveBeenCalledTimes(2);
  expect(submits[1]).toEqual(['request_hospital_care', { hospitalId: 'synthetic-care-hospital', desiredStart: '2026-10-21', careType: 'full_day', contactTime: 'anytime', idempotencyKey: 'synthetic-key-1' }, 'synthetic-member']);
  expect(texts(renderer.root)).toEqual(expect.arrayContaining(['확정', '시험 안내']));
  expect(texts(renderer.root)).not.toContain('시험 주의사항');
  expect(renderer.root.findAllByType('Button').some((node) => node.children.includes('요청 취소'))).toBe(false);
  await act(async () => { choose('간병 시작 전 확인할 것'); });
  expect(texts(renderer.root)).toContain('시험 주의사항');
  await act(async () => { renderer.unmount(); });
});

it('care request admin orders waiting requests by first-contact due time, shows the countdown and records milestones', async () => {
  const statuses = { requested: '접수됨', reviewing: '확인 중', confirmed: '확정', adjusted: '일정 조정', declined: '진행 어려움', cancelled: '취소함' };
  const now = Date.now();
  const at = (minutes: number) => new Date(now + minutes * 60000).toISOString();
  const row = (id: string, status: string, dueInMinutes: number, extra: Record<string, unknown> = {}) => ({ id, hospitalId: 'h', hospitalName: '시험병원', desiredStart: '2026-10-21', careType: 'day_time',
    contactTime: 'anytime', status, staffNote: null, respondedAt: null, createdAt: at(dueInMinutes - 30), memberName: `회원${id}`, memberPhone: '01000000000',
    firstContactDueAt: at(dueInMinutes), firstContactAt: null, decidedAt: null, careStartedAt: null, ...extra });
  const onRespond = jest.fn();
  const onMark = jest.fn();
  const Admin = executeComponent('components/hospitals/CareRequestAdmin.tsx', {
    '@expo/vector-icons': { MaterialIcons: 'MaterialIcons' },
    '@/components/Button': { Button: 'Button' }, '@/components/FormInput': { FormInput: 'FormInput' },
    '@/components/hospitals/HospitalScreen': { CareStatusBadge: 'CareStatusBadge' },
    '@/lib/hospital-care': { CARE_STATUS_TONES, formatCareDate: (value: string) => value }, '@/lib/theme': { COLORS },
    '@/lib/platform-api': { CARE_REQUEST_STATUSES: statuses, CARE_TYPES: { full_day: '24시간 간병', day_time: '주간 간병' } },
  });
  const metrics = { requests: 4, firstContactDue: 3, firstContactOnTime: 2, overdueNow: 1, medianFirstContactMinutes: 18.4, medianDecisionMinutes: 95, confirmed: 1, started: 0 };
  const requests = [row('C', 'confirmed', -600, { firstContactAt: at(-620) }), row('B', 'requested', 20), row('A', 'reviewing', -15)];
  let renderer!: Renderer;
  // The list arrives after the first render; waiting requests must still be the default view.
  await act(async () => { renderer = create(createElement(Admin, { requests: [], metrics, busy: false, onRespond, onMark })); });
  expect(texts(renderer.root)).toContain('받은 예약 요청이 없습니다.');
  await act(async () => { renderer.update(createElement(Admin, { requests, metrics, busy: false, onRespond, onMark })); });
  const all = texts(renderer.root);
  expect(all).toEqual(expect.arrayContaining(['간병 예약 요청', '2건', '답변 대기', '4건', '67%', '1건', '답변 대기 2', '확정 1', '전체 3']));
  expect(all).toContain('첫 연락 중앙값 18분 · 결정 중앙값 1시간 · 확정 1건 · 시작 0건');
  const names = () => texts(renderer.root).filter((text) => /^회원[ABC]$/.test(text)).map((text) => text[2]);
  expect(names()).toEqual(['A', 'B']);
  expect(all.some((text) => text.startsWith('첫 연락 기한 1') && text.includes('분 초과'))).toBe(true);
  expect(all.some((text) => text.startsWith('첫 연락 1') && text.includes('분 남음'))).toBe(true);
  const press = async (label: string) => { await act(async () => {
    (renderer.root.findAllByType('Pressable').find((node) => node.props.accessibilityLabel === label || texts(node).includes(label))!.props.onPress as () => void)();
  }); };
  await press('전체 3');
  expect(names()).toEqual(['A', 'B', 'C']);
  const buttons = (label: string) => renderer.root.findAllByType('Button').filter((node) => node.children.includes(label));
  // Actions stay folded until staff open one request.
  expect(buttons('첫 연락 완료')).toHaveLength(0);
  await press('회원A 요청 열기');
  expect(buttons('첫 연락 완료')).toHaveLength(1);
  await act(async () => { (buttons('첫 연락 완료')[0].props.onPress as () => void)(); });
  expect(onMark).toHaveBeenCalledWith('A', 'first_contact');
  await press('회원C 요청 열기');
  await act(async () => { (buttons('간병 시작 확인')[0].props.onPress as () => void)(); });
  expect(onMark).toHaveBeenLastCalledWith('C', 'care_started');
  await press('회원A 요청 열기');
  expect(buttons('처리하기')[0].props.disabled).toBe(true);
  await act(async () => { (renderer.root.findAllByType('ChoiceRows')[0].props.onChange as (value: string) => void)('adjusted'); });
  await act(async () => { (buttons('처리하기')[0].props.onPress as () => void)(); });
  expect(onRespond).not.toHaveBeenCalled();
  expect(texts(renderer.root)).toContain('일정 조정과 진행 어려움은 회원에게 보낼 안내를 입력해 주세요.');
  await act(async () => { (renderer.root.findAllByType('FormInput')[0].props.onChangeText as (value: string) => void)(' 22일 시작 가능 '); });
  await act(async () => { (buttons('처리하기')[0].props.onPress as () => void)(); });
  expect(onRespond).toHaveBeenCalledWith('A', 'adjusted', '22일 시작 가능');
  await act(async () => { renderer.unmount(); });
});

it('hospital report preserves same-period failure, rejects invalid dates and clears denied or late owner results', async () => {
  class ApiError extends Error { constructor(public status: number) { super('시험 권한 거부'); } }
  const report = { ok: true, from: '2026-10-01', to: '2026-10-11', measurement: 'anonymous_client_events', rows: [], totals: { impressions: 12, detailViews: 3, phoneClicks: 2, directionsClicks: 1 } };
  const request = jest.fn().mockResolvedValue(report);
  const Report = executeComponent('components/hospitals/HospitalPerformanceReport.tsx', {
    '@/components/Button': { Button: 'Button' }, '@/components/FormInput': { FormInput: 'FormInput' },
    '@/components/ServiceInformation': { informationStyles: {} },
    '@/lib/admin-assisted-signup-validation': { getSeoulTodayIsoDate: () => '2026-10-11' }, '@/lib/calendar-date': { parseCalendarDate },
    '@/lib/platform-api': { PlatformApiError: ApiError, platformRequest: request }, '@/lib/theme': { COLORS }, '@/lib/use-read-attempt': { useReadAttempt },
  });
  let renderer!: Renderer;
  const props = { allowed: true, token: 'synthetic-admin', partners: [] };
  await act(async () => { renderer = create(createElement(Report, props)); });
  const load = () => (renderer.root.findAllByType('Button').find((node) => node.children.includes('광고 성과 조회'))!.props.onPress as () => void)();
  await act(async () => { load(); });
  expect(texts(renderer.root)).toContain('12');
  request.mockRejectedValue(new Error('시험 연결 실패'));
  await act(async () => { load(); });
  expect(texts(renderer.root)).toEqual(expect.arrayContaining(['12', '시험 연결 실패']));
  const date = () => renderer.root.findAllByType('FormInput').find((node) => node.props.accessibilityLabel === '성과 조회 종료일')!;
  await act(async () => { (date().props.onChangeText as (value: string) => void)('2026-02-30'); });
  await act(async () => { load(); });
  expect(request).toHaveBeenCalledTimes(2);
  expect(texts(renderer.root)).not.toContain('12');
  await act(async () => { (date().props.onChangeText as (value: string) => void)('2026-10-11'); });
  request.mockRejectedValue(new ApiError(403));
  await act(async () => { load(); });
  expect(texts(renderer.root)).not.toContain('12');
  let resolveRead!: (value: unknown) => void;
  request.mockImplementation(() => new Promise((resolve) => { resolveRead = resolve; }));
  await act(async () => { load(); });
  await act(async () => { renderer.update(createElement(Report, { ...props, token: 'synthetic-new-admin' })); });
  await act(async () => { resolveRead(report); });
  expect(texts(renderer.root)).not.toContain('12');
  await act(async () => { renderer.update(createElement(Report, { ...props, allowed: false })); });
  expect(renderer.root.findAllByType('Button')).toHaveLength(0);
  await act(async () => { renderer.unmount(); });
});
