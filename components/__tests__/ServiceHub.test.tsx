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
};
let session: Session = { role: null, hydrated: true, isRequestBoardDesigner: false };
const push = jest.fn();
const openExternalUrl = jest.fn();
const alert = jest.fn();
const exported: Record<string, unknown> = {};
const output = ts.transpileModule(readFileSync(join(__dirname, '../ServiceHub.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
new Function('require', 'exports', output)((name: string) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
  if (name === 'expo-router') return { Stack: { Screen: 'StackScreen' }, router: { push } };
  if (name === 'react-native') return { Alert: { alert } };
  if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ bottom: 34 }) };
  if (name === '@/components/BottomNavigation') return { BottomNavigation: 'BottomNavigation' };
  if (name === '@/components/service-home') return { default: 'ServiceHomeScreen' };
  if (name === '@/hooks/use-session') return { useSession: () => session };
  if (name === '@/lib/bottom-navigation') return { resolveBottomNavActiveKey, resolveBottomNavPreset };
  if (name === '@/lib/open-external-url') return { openExternalUrl };
  if (name === '@/lib/service-home') return { FAMILY_CARE_PROMOTION_URL, resolveInsuranceServiceRoute };
  throw new Error(`Unexpected dependency: ${name}`);
}, exported);
const Hub = exported.default as () => ReactElement;

describe('service hub controller', () => {
  let renderer: ReturnType<typeof create>;
  const screenProps = () => renderer.root.findByType('ServiceHomeScreen').props;
  beforeEach(() => {
    session = { role: null, hydrated: true, isRequestBoardDesigner: false };
    push.mockReset();
    openExternalUrl.mockReset().mockResolvedValue(FAMILY_CARE_PROMOTION_URL);
    alert.mockReset();
  });
  afterEach(() => { act(() => renderer?.unmount()); });
  const render = () => act(() => { renderer = create(createElement(Hub)); });

  it('opens the existing promotion only after a care press without session or referral parameters', async () => {
    render();
    expect(openExternalUrl).not.toHaveBeenCalled();
    await act(async () => { await screenProps().onCarePress(); });
    expect(openExternalUrl).toHaveBeenCalledTimes(1);
    expect(openExternalUrl).toHaveBeenCalledWith(FAMILY_CARE_PROMOTION_URL, { sameWindowOnWeb: true });
    expect(new URL(FAMILY_CARE_PROMOTION_URL).search).toBe('');
    expect(push).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });

  it('shows a safe recovery message if opening the promotion fails', async () => {
    openExternalUrl.mockRejectedValue(new Error('PRIVATE_LAUNCH_DETAIL'));
    render();
    await act(async () => { await screenProps().onCarePress(); });
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith(
      '가족간병 안내를 열지 못했어요',
      '인터넷 연결을 확인한 뒤 가족간병을 다시 눌러 주세요.',
    );
    expect(push).not.toHaveBeenCalled();
  });

  it('keeps the other information pages as internal routes', () => {
    render();
    for (const [callback, service] of [
      ['onTelecomPress', 'telecom'], ['onCarPress', 'car'], ['onHelpPress', 'help'],
    ]) {
      act(() => screenProps()[callback]());
      expect(push).toHaveBeenLastCalledWith({ pathname: '/services/[service]', params: { service } });
    }
    expect(openExternalUrl).not.toHaveBeenCalled();
  });

  it.each([
    [null, false, '/login?service=insurance'],
    ['fc', false, { pathname: '/apply-gate', params: { next: '/?mode=insurance' } }],
    ['admin', false, '/?mode=insurance'],
    ['fc', true, '/request-board'],
  ] as const)('keeps insurance and resume routing for role %s, designer %s', (role, designer, expected) => {
    session = { role, hydrated: true, isRequestBoardDesigner: designer };
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
    session = { role: 'fc', hydrated: true, isRequestBoardDesigner: false };
    act(() => renderer.update(createElement(Hub)));
    expect(screenProps().loading).toBe(false);
    act(() => screenProps().onAccountPress());
    expect(push).toHaveBeenLastCalledWith('/services/account');
  });
});
