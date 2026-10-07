import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { act, createElement, type ReactElement } from 'react';
import * as Query from '@tanstack/react-query';
import * as ts from 'typescript';

import * as cancellationPolicy from '@/lib/exam-cancellation-policy';
import * as applicationValidation from '@/lib/exam-application-validation';
import * as historyGuard from '@/lib/exam-apply-history-guard';
import * as examFees from '@/lib/exam-fees';
import * as examFlow from '@/lib/exam-flow-contract';
import * as paymentProof from '@/lib/exam-payment-proof';
import * as examRole from '@/lib/exam-role';
import * as notificationTarget from '@/lib/notification-target';
import * as strictRouteParams from '@/lib/strict-route-params';
import * as examTypes from '@/types/exam';

type Instance = {
  children: (Instance | string)[];
  props: Record<string, unknown>;
  findAllByType: (type: string) => Instance[];
};
type Renderer = { root: Instance; update: (element: ReactElement) => void; unmount: () => void };
// Only the used renderer surface is declared; the installed package has no separate types.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { create } = require('react-test-renderer') as { create: (element: ReactElement) => Renderer };
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type Flow = 'life' | 'nonlife';
type AlertButton = { text: string; onPress?: () => void };
type AlertRecord = { title: string; message: string; buttons?: AlertButton[] };
type RoundFixture = {
  id: string;
  exam_type: Flow;
  exam_month: string;
  exam_date: string;
  round_label: string;
  registration_deadline: string | null;
  created_at: string;
  updated_at: string;
  exam_locations: { id: string; round_id: string; location_name: string; sort_order: number }[];
};
type RegistrationFixture = {
  id: string;
  round_id: string;
  location_id: string;
  status: string;
  is_confirmed: boolean;
  includes_primary_exam: boolean;
  is_third_exam: boolean;
  fee_paid_date: string;
  payment_proof_attached: boolean;
  created_at: string;
  exam_type: Flow;
  exam_month: string;
  exam_rounds: RoundFixture | null;
  exam_locations: { location_name: string };
};
type FunctionRequest = {
  body: { action: string; registrationId?: string };
  headers: Record<string, string>;
};

// Compile the entire route/API. Native rendering, signed-session inputs and network
// transports are injected; React hooks, Query observers, helpers and API error parsing run as shipped.
function loadModule<T>(relativePath: string, dependencies: Record<string, unknown>): T {
  const code = ts.transpileModule(readFileSync(join(__dirname, '../..', relativePath), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const exports: Record<string, unknown> = {};
  new Function('require', 'exports', code)((name: string) => {
    if (name === 'react') return React;
    if (name === '@tanstack/react-query') return Query;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (Object.prototype.hasOwnProperty.call(dependencies, name)) return dependencies[name];
    throw new Error(`Unexpected test boundary: ${name}`);
  }, exports);
  return exports as T;
}

describe.each([
  ['life', 'app/exam-apply.tsx'],
  ['nonlife', 'app/exam-apply2.tsx'],
] as const)('%s full route cancellation interactions', (flow, routePath) => {
  let renderer: Renderer | undefined;
  let client: Query.QueryClient;
  let Screen: React.ComponentType;
  let history: RegistrationFixture[];
  let rounds: RoundFixture[];
  let session: { role: 'fc' | 'admin'; staffType: 'admin' | null; readOnly: boolean; appSessionToken: string };
  let alerts: AlertRecord[];
  let appStateListeners: Set<(state: string) => void>;
  let invoke: jest.Mock;
  let read: jest.Mock;
  let router: { push: jest.Mock; replace: jest.Mock };
  let historyReadError: boolean;

  const deadlineMessage = cancellationPolicy.EXAM_CANCELLATION_DEADLINE_MESSAGE;
  const unavailableMessage = cancellationPolicy.EXAM_CANCELLATION_DEADLINE_UNAVAILABLE_MESSAGE;
  const root = () => renderer!.root;
  const texts = (within = root()) => within.findAllByType('Text')
    .map((node) => node.children.filter((child) => typeof child === 'string').join(''));
  const buttons = (label: string) => root().findAllByType('Pressable')
    .filter((node) => texts(node).includes(label));
  const cancelButtons = () => buttons('취소');
  const lastAlert = () => alerts[alerts.length - 1];

  function round(id = 'round-a', deadline: string | null = '2026-09-27'): RoundFixture {
    return {
      id, exam_type: flow, exam_month: '2026-10-01', exam_date: '2026-10-20',
      round_label: `가상 회차 ${id}`, registration_deadline: deadline,
      created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
      exam_locations: [{ id: `location-${id}`, round_id: id, location_name: '가상 응시장', sort_order: 1 }],
    };
  }

  function registration(sourceRound: RoundFixture, id = 'registration-a'): RegistrationFixture {
    return {
      id, round_id: sourceRound.id, location_id: `location-${sourceRound.id}`,
      status: 'applied', is_confirmed: false, includes_primary_exam: true, is_third_exam: false,
      fee_paid_date: '2026-09-20', payment_proof_attached: true,
      created_at: '2026-09-20T01:00:00Z', exam_type: flow, exam_month: '2026-10-01',
      exam_rounds: sourceRound, exam_locations: { location_name: '가상 응시장' },
    };
  }

  function query(table: string) {
    let columns = '';
    const filters: Record<string, unknown> = {};
    const builder = {
      select: (value: string) => { columns = value; return builder; },
      eq: (key: string, value: unknown) => { filters[key] = value; return builder; },
      gte: (key: string, value: unknown) => { filters[key] = value; return builder; },
      order: () => builder,
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
        Promise.resolve().then(() => read(table, columns, filters)).then(resolve, reject),
    };
    return builder;
  }

  const settle = async () => {
    // Query notifications use microtasks below, leaving the real day-boundary timer intact.
    for (let pass = 0; pass < 3; pass += 1) {
      await act(async () => {
        for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
      });
    }
  };

  async function mount() {
    await act(async () => {
      renderer = create(createElement(Query.QueryClientProvider, { client }, createElement(Screen)));
    });
    await settle();
  }

  async function updateSession() {
    await act(async () => {
      renderer!.update(createElement(Query.QueryClientProvider, { client }, createElement(Screen)));
    });
    await settle();
  }

  async function press(node: Instance) {
    expect(node.props.disabled).not.toBe(true);
    await act(async () => { (node.props.onPress as () => void)(); });
    await settle();
  }

  async function cancel() {
    expect(cancelButtons()).toHaveLength(1);
    await press(cancelButtons()[0]);
    expect(lastAlert().title).toBe('신청 취소');
  }

  async function confirm(text: '예' | '아니요') {
    const confirmation = [...alerts].reverse().find((alert) => alert.title === '신청 취소');
    const button = confirmation?.buttons?.find((item) => item.text === text);
    expect(button).toBeDefined();
    await act(async () => { button?.onPress?.(); });
    await settle();
  }

  async function selectHistory(label: string) {
    const dropdown = root().findAllByType('Pressable').find((node) =>
      node.findAllByType('Feather').some((icon) => icon.props.name === 'chevron-down'));
    expect(dropdown).toBeDefined();
    await press(dropdown!);
    const item = root().findAllByType('Pressable').find((node) =>
      texts(node).some((text) => text.startsWith(`${label} / `))
      && !node.findAllByType('Feather').some((icon) => icon.props.name === 'chevron-up'));
    expect(item).toBeDefined();
    await press(item!);
  }

  beforeAll(() => Query.notifyManager.setScheduler((callback) => { void Promise.resolve().then(callback); }));
  afterAll(() => Query.notifyManager.setScheduler((callback) => { setTimeout(callback, 0); }));

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
    jest.setSystemTime(new Date('2026-09-27T04:00:00Z'));
    session = { role: 'fc', staffType: null, readOnly: false, appSessionToken: 'fictional-session' };
    alerts = [];
    appStateListeners = new Set();
    historyReadError = false;
    rounds = [round()];
    history = [registration(rounds[0])];
    router = { push: jest.fn(), replace: jest.fn() };
    client = new Query.QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
    });
    read = jest.fn((table: string, columns: string) => {
      if (table === 'exam_rounds') return { data: rounds, error: null };
      if (table === 'exam_registrations') {
        // The real route must request this field, rather than inheriting it from fixture state.
        expect(columns).toContain('registration_deadline');
        return historyReadError
          ? { data: null, error: { code: 'NETWORK_TEST', message: 'synthetic read unavailable' } }
          : { data: history.map((row) => ({ ...row })), error: null };
      }
      throw new Error(`Unexpected fixture table: ${table}`);
    });
    invoke = jest.fn(async (_name: string, request: FunctionRequest) => {
      expect(request.body.action).toBe('cancel');
      expect(request.headers['x-app-session-token']).toBe(session.appSessionToken);
      history = history.map((row) => row.id === request.body.registrationId
        ? { ...row, status: 'cancelled_by_fc' } : row);
      return { data: { ok: true, data: { cleanupWarning: false } }, error: null };
    });
    const channel = { on: () => channel, subscribe: () => channel };
    const supabase = { from: query, channel: () => channel, removeChannel: jest.fn(), functions: { invoke } };
    const native = {
      Alert: { alert: (title: string, message: string, buttons?: AlertButton[]) => {
        alerts.push({ title, message, buttons });
      } },
      AppState: { addEventListener: (_event: string, callback: (state: string) => void) => {
        appStateListeners.add(callback);
        return { remove: () => appStateListeners.delete(callback) };
      } },
      Platform: { OS: 'ios' },
      Pressable: 'Pressable', RefreshControl: 'RefreshControl', Text: 'Text', View: 'View',
      StyleSheet: { create: (styles: unknown) => styles },
    };
    const api = loadModule<Record<string, unknown>>('lib/exam-payment-proof-api.ts', {
      'expo-file-system/legacy': {}, 'react-native': native, '@/lib/supabase': { supabase },
    });
    const target = {
      fcId: 'fictional-fc', residentId: 'fictional-owner', name: '가상 신청자',
      affiliation: '가상 지점', phoneLast4: '1234',
    };
    const dependencies = {
      'react-native': native,
      '@expo/vector-icons': { Feather: 'Feather' },
      'expo-router': { router, useLocalSearchParams: () => ({}) },
      'expo-clipboard': { setStringAsync: jest.fn() },
      'expo-crypto': { randomUUID: () => 'fictional-request' },
      'expo-haptics': { selectionAsync: jest.fn(), notificationAsync: jest.fn(),
        NotificationFeedbackType: { Warning: 'warning' } },
      'expo-image-picker': { launchImageLibraryAsync: jest.fn() },
      moti: { MotiView: 'MotiView', AnimatePresence: 'AnimatePresence' },
      'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
      '@/components/BrandedLoadingSpinner': { __esModule: true, default: 'BrandedLoadingSpinner' },
      '@/components/BrandedLoadingState': { __esModule: true, default: 'BrandedLoadingState' },
      '@/components/ExamApplicationTargetSelector': { ExamApplicationTargetSelector: 'ExamApplicationTargetSelector' },
      '@/components/ExamPaymentProofField': { ExamPaymentProofField: 'ExamPaymentProofField' },
      '@/components/ExamPaymentProofHistoryButton': { ExamPaymentProofHistoryButton: 'ExamPaymentProofHistoryButton' },
      '@/components/KeyboardAwareWrapper': { KeyboardAwareWrapper: 'KeyboardAwareWrapper' },
      '@/components/RefreshButton': { RefreshButton: 'RefreshButton' },
      '@/hooks/use-session': { useSession: () => ({ ...session, residentId: 'fictional-owner',
        displayName: '가상 신청자', hydrated: true }) },
      '@/hooks/use-identity-gate': { useIdentityGate: () => ({ destinationAccepted: true }) },
      '@/hooks/use-exam-application-targets': { useExamApplicationTargets: () => ({
        targets: [target], selectedTarget: target, selectTarget: jest.fn(), isLoading: false,
        errorMessage: null, needsRelogin: false, refetch: jest.fn(),
      }) },
      '@/lib/exam-role': examRole,
      '@/lib/fc-notify-client': { invokeFcNotifyForDelivery: jest.fn() },
      '@/lib/exam-application-validation': applicationValidation,
      '@/lib/exam-month-conflict-feedback': { showExamMonthConflictFeedback: jest.fn() },
      '@/lib/exam-cancellation-policy': cancellationPolicy,
      '@/lib/exam-flow-contract': examFlow,
      '@/lib/exam-payment-proof-api': api,
      '@/lib/exam-payment-proof': paymentProof,
      '@/lib/exam-fees': examFees,
      '@/lib/logger': { logger: { debug: jest.fn(), warn: jest.fn() } },
      '@/lib/notification-target': notificationTarget,
      '@/lib/strict-route-params': strictRouteParams,
      '@/lib/notification-receipt-ui': { NotificationReceiptStatusBanner: 'NotificationReceiptStatusBanner' },
      '@/lib/supabase': { supabase },
      '@/lib/use-notification-receipt': { useNotificationReceiptCompletion: () => ({
        state: 'idle', retryMarkRead: jest.fn(),
      }) },
      '@/types/exam': examTypes,
      '@/lib/exam-apply-history-guard': historyGuard,
    };
    Screen = loadModule<{ default: React.ComponentType }>(routePath, dependencies).default;
  });

  afterEach(async () => {
    if (renderer) await act(async () => { renderer!.unmount(); });
    renderer = undefined;
    client.clear();
    expect(appStateListeners.size).toBe(0);
    jest.useRealTimers();
  });

  it('keeps the application untouched when the user declines cancellation on the deadline day', async () => {
    await mount();
    expect(texts()).not.toContain(deadlineMessage);
    await cancel();
    await confirm('아니요');
    expect(invoke).not.toHaveBeenCalled();
    expect(history[0].status).toBe('applied');
    expect(cancelButtons()).toHaveLength(1);
  });

  it('cancels only after agreement and refreshes the rendered application history', async () => {
    jest.setSystemTime(new Date('2026-09-27T14:59:59.999Z'));
    await mount();
    const readsBefore = read.mock.calls.filter(([table]) => table === 'exam_registrations').length;
    await cancel();
    await confirm('예');
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][1].body).toEqual({ action: 'cancel', registrationId: 'registration-a' });
    expect(lastAlert()).toMatchObject({ title: '취소 완료', message: '시험 신청이 취소되었습니다.' });
    expect(read.mock.calls.filter(([table]) => table === 'exam_registrations').length).toBeGreaterThan(readsBefore);
    expect(texts()).toContain('아직 신청한 시험이 없습니다.');
    expect(cancelButtons()).toHaveLength(0);
  });

  it.each([
    ['applied', false],
    ['applied', true],
    ['confirmed', true],
  ] as const)('shows the exact closed notice and no cancel for %s / receipt=%s', async (status, receipt) => {
    jest.setSystemTime(new Date('2026-10-07T04:00:00Z'));
    history[0].status = status;
    history[0].is_confirmed = receipt;
    await mount();
    expect(texts()).toContain(deadlineMessage);
    expect(cancelButtons()).toHaveLength(0);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('preserves the administrator-confirmed lock before the deadline without a false closed notice', async () => {
    history[0].is_confirmed = true;
    await mount();
    expect(texts()).not.toContain(deadlineMessage);
    expect(cancelButtons()).toHaveLength(0);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('automatically replaces the mounted cancel button with the notice at KST midnight', async () => {
    jest.setSystemTime(new Date('2026-09-27T14:59:59.999Z'));
    await mount();
    expect(cancelButtons()).toHaveLength(1);
    await act(async () => { jest.advanceTimersByTime(1); });
    await settle();
    expect(texts()).toContain(deadlineMessage);
    expect(cancelButtons()).toHaveLength(0);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('blocks agreement on a native confirmation that remained open past midnight', async () => {
    jest.setSystemTime(new Date('2026-09-27T14:59:59.999Z'));
    await mount();
    await cancel();
    await act(async () => { jest.advanceTimersByTime(1); });
    await confirm('예');
    expect(lastAlert()).toMatchObject({ title: '취소 실패', message: deadlineMessage });
    expect(invoke).not.toHaveBeenCalled();
    expect(history[0].status).toBe('applied');
    expect(texts()).toContain(deadlineMessage);
  });

  it('refreshes the policy after the app resumes even when background timers did not run', async () => {
    await mount();
    expect(cancelButtons()).toHaveLength(1);
    jest.setSystemTime(new Date('2026-09-28T00:01:00+09:00'));
    await act(async () => { appStateListeners.forEach((callback) => callback('active')); });
    expect(texts()).toContain(deadlineMessage);
    expect(cancelButtons()).toHaveLength(0);
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([null, 'not-a-date'])('fails closed with a truthful notice if the history deadline is %s', async (deadline) => {
    rounds[0].registration_deadline = deadline;
    await mount();
    expect(texts()).toContain(unavailableMessage);
    expect(texts()).not.toContain(deadlineMessage);
    expect(cancelButtons()).toHaveLength(0);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('keeps history after a stale-screen server409 and tells the user to contact the administrator', async () => {
    invoke.mockImplementationOnce(async () => ({ data: null, error: {
      context: new Response(JSON.stringify({ ok: false, code: 'exam_cancellation_deadline_passed',
        message: deadlineMessage }), { status: 409 }),
    } }));
    await mount();
    await cancel();
    await confirm('예');
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(lastAlert()).toMatchObject({ title: '취소 실패', message: deadlineMessage });
    expect(alerts.some((alert) => alert.title === '취소 완료')).toBe(false);
    expect(history[0].status).toBe('applied');
    expect(texts()).not.toContain('아직 신청한 시험이 없습니다.');
    alerts = []; // Dismiss the native failure alert: the policy must remain visible on the card.
    expect(texts()).toContain(deadlineMessage);
    expect(cancelButtons()).toHaveLength(0);
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('limits a server deadline verdict to that registration while another selected round stays cancellable', async () => {
    const first = round('server-blocked', '2026-09-27');
    const second = round('still-open', '2026-09-27');
    rounds = [first, second];
    history = [registration(first, 'registration-blocked'), registration(second, 'registration-open')];
    invoke.mockImplementationOnce(async () => ({ data: null, error: {
      context: new Response(JSON.stringify({ ok: false, code: 'exam_cancellation_deadline_passed',
        message: deadlineMessage }), { status: 409 }),
    } }));
    await mount();
    await cancel();
    await confirm('예');
    expect(texts()).toContain(deadlineMessage);
    expect(cancelButtons()).toHaveLength(0);
    await selectHistory(second.round_label);
    expect(texts()).not.toContain(deadlineMessage);
    await cancel();
    await confirm('예');
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1][1].body.registrationId).toBe('registration-open');
    expect(history.find((row) => row.id === 'registration-blocked')?.status).toBe('applied');
    expect(texts()).toContain(deadlineMessage);
    expect(cancelButtons()).toHaveLength(0);
  });

  it('keeps the selected history through signed-session renewal and restores a fresh server deadline verdict', async () => {
    const first = round('first');
    const selected = round('selected');
    rounds = [first, selected];
    history = [registration(first, 'registration-first'), registration(selected, 'registration-selected')];
    invoke.mockImplementation(async () => ({ data: null, error: {
      context: new Response(JSON.stringify({ ok: false, code: 'exam_cancellation_deadline_passed',
        message: deadlineMessage }), { status: 409 }),
    } }));
    await mount();
    await selectHistory(selected.round_label);
    await cancel();
    await confirm('예');
    await updateSession();
    expect(texts()).toContain(deadlineMessage);
    expect(cancelButtons()).toHaveLength(0);
    session = { ...session, appSessionToken: 'fictional-renewed-session' };
    await updateSession();
    expect(texts()).not.toContain(deadlineMessage);
    expect(cancelButtons()).toHaveLength(1);
    expect(texts()).toContain(`${selected.round_label} / 10월 20일`);
    expect(history.map((row) => row.status)).toEqual(['applied', 'applied']);
    await cancel();
    await confirm('예');
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1][1]).toMatchObject({
      body: { action: 'cancel', registrationId: 'registration-selected' },
      headers: { 'x-app-session-token': 'fictional-renewed-session' },
    });
    expect(lastAlert()).toMatchObject({ title: '취소 실패', message: deadlineMessage });
    expect(texts()).toContain(deadlineMessage);
    expect(cancelButtons()).toHaveLength(0);
    expect(history.map((row) => row.status)).toEqual(['applied', 'applied']);
  });

  it('preserves the application on connection failure and allows a safe retry', async () => {
    invoke.mockImplementationOnce(async () => ({ data: null, error: { message: 'synthetic network error' } }));
    await mount();
    await cancel();
    await confirm('예');
    expect(lastAlert()).toMatchObject({ title: '취소 실패', message: '시험 신청 서버에 연결하지 못했습니다.' });
    expect(history[0].status).toBe('applied');
    expect(cancelButtons()).toHaveLength(1);
    await cancel();
    await confirm('예');
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(lastAlert().title).toBe('취소 완료');
    expect(texts()).toContain('아직 신청한 시험이 없습니다.');
  });

  it('offers retry when history loading fails and then shows the correct deadline policy', async () => {
    historyReadError = true;
    await mount();
    expect(texts()).toContain('신청 내역을 불러오지 못했습니다.');
    expect(cancelButtons()).toHaveLength(0);
    historyReadError = false;
    await press(buttons('다시 시도')[0]);
    expect(texts()).not.toContain('신청 내역을 불러오지 못했습니다.');
    expect(cancelButtons()).toHaveLength(1);
  });

  it('chooses the selected history round and cancels only its still-open registration', async () => {
    const closedRound = round('closed', '2026-09-26');
    const openRound = round('open', '2026-09-27');
    rounds = [closedRound, openRound];
    history = [registration(closedRound, 'registration-closed'), registration(openRound, 'registration-open')];
    await mount();
    expect(texts()).toContain(deadlineMessage);
    expect(cancelButtons()).toHaveLength(0);
    await selectHistory(openRound.round_label);
    expect(texts()).not.toContain(deadlineMessage);
    await cancel();
    await confirm('예');
    expect(invoke.mock.calls[0][1].body.registrationId).toBe('registration-open');
    expect(history.find((row) => row.id === 'registration-closed')?.status).toBe('applied');
    expect(texts()).toContain(deadlineMessage);
    expect(cancelButtons()).toHaveLength(0);
  });

  it('shows proxy history without exposing an FC self-cancel action', async () => {
    session = { role: 'admin', staffType: 'admin', readOnly: false, appSessionToken: 'fictional-session' };
    await mount();
    expect(texts()).toContain('선택한 FC 신청 내역');
    expect(root().findAllByType('ExamApplicationTargetSelector')).toHaveLength(1);
    expect(cancelButtons()).toHaveLength(0);
    expect(invoke).not.toHaveBeenCalled();
  });
});
