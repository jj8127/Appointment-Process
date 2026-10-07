import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import {
  EXAM_CANCELLATION_DEADLINE_MESSAGE,
  EXAM_CANCELLATION_DEADLINE_UNAVAILABLE_MESSAGE,
  getExamSelfCancellationDeadlineMessage,
} from '../exam-cancellation-policy';

// Exercise the real callbacks without mounting Expo's navigation/native dependencies.
function getInitializer(source: ts.SourceFile, name: string): ts.Expression {
  let initializer: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) {
      initializer = node.initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!initializer) throw new Error(`Missing callback: ${name}`);
  return initializer;
}

function evaluate(expression: ts.Expression, source: ts.SourceFile, context: Record<string, unknown>) {
  const js = ts.transpileModule(`(${expression.getText(source)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  return runInNewContext(js, context);
}

type Registration = {
  id: string;
  status: string;
  is_confirmed: boolean;
  exam_rounds: { registration_deadline: string | null } | null;
};

describe.each(['app/exam-apply.tsx', 'app/exam-apply2.tsx'])('%s cancellation caller', (path) => {
  const contents = readFileSync(join(process.cwd(), path), 'utf8');
  const source = ts.createSourceFile(path, contents, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  function harness(overrides: Partial<Registration> = {}, isProxyApplication = false) {
    const target: Registration = {
      id: 'registration-fixture',
      status: 'applied',
      is_confirmed: false,
      exam_rounds: { registration_deadline: '2026-09-27' },
      ...overrides,
    };
    const sendRequest = jest.fn().mockResolvedValue(undefined);
    const alert = jest.fn();
    const mutate = jest.fn();
    const context = {
      myApplies: [target],
      serverDeadlineBlockedIds: new Set<string>(),
      EXAM_CANCELLATION_DEADLINE_MESSAGE,
      isProxyApplication,
      appSessionToken: 'test-session',
      lockMessage: 'confirmed-fixture-lock',
      getExamSelfCancellationDeadlineMessage,
      cancelExamApplicationWithPaymentProof: sendRequest,
      Alert: { alert },
      Platform: { OS: 'android' },
      Haptics: { notificationAsync: jest.fn(), NotificationFeedbackType: { Warning: 'warning' } },
      cancelMutation: { mutate },
      useMutation: (options: unknown) => options,
      refetchMyApply: jest.fn(),
    };
    const mutation = evaluate(getInitializer(source, 'cancelMutation'), source, context).mutationFn as
      (id: string) => Promise<void>;
    const press = evaluate(getInitializer(source, 'handleCancelPress'), source, context) as
      (id: string) => void;
    return { target, sendRequest, alert, mutate, mutation, press };
  }

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('blocks an unconfirmed applied registration after deadline before confirmation or API request', async () => {
    jest.setSystemTime(new Date('2026-10-07T04:00:00Z'));
    const { press, mutation, alert, mutate, sendRequest, target } = harness();
    press(target.id);
    expect(alert).toHaveBeenCalledWith('알림', EXAM_CANCELLATION_DEADLINE_MESSAGE);
    expect(mutate).not.toHaveBeenCalled();
    await expect(mutation(target.id)).rejects.toThrow(EXAM_CANCELLATION_DEADLINE_MESSAGE);
    expect(sendRequest).not.toHaveBeenCalled();
  });

  it('allows before deadline but rechecks if native confirmation spans KST midnight', async () => {
    jest.setSystemTime(new Date('2026-09-27T14:59:59.999Z'));
    const { press, mutation, alert, mutate, sendRequest, target } = harness();
    press(target.id);
    const confirmation = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    expect(confirmation.find((button) => button.text === '예')?.onPress).toBeDefined();
    await mutation(target.id);
    expect(sendRequest).toHaveBeenCalledTimes(1);
    sendRequest.mockClear();
    jest.setSystemTime(new Date('2026-09-27T15:00:00.000Z'));
    confirmation.find((button) => button.text === '예')?.onPress?.();
    expect(mutate).toHaveBeenCalledWith(target.id);
    await expect(mutation(target.id)).rejects.toThrow(EXAM_CANCELLATION_DEADLINE_MESSAGE);
    expect(sendRequest).not.toHaveBeenCalled();
  });

  it.each([null, { registration_deadline: null }, { registration_deadline: '2026-02-29' }])(
    'fails closed if the embedded deadline is unavailable (%s)',
    async (round) => {
      jest.setSystemTime(new Date('2026-09-27T10:00:00Z'));
      const { press, mutation, alert, sendRequest, target } = harness({ exam_rounds: round });
      press(target.id);
      expect(alert).toHaveBeenCalledWith('알림', EXAM_CANCELLATION_DEADLINE_UNAVAILABLE_MESSAGE);
      await expect(mutation(target.id)).rejects.toThrow(EXAM_CANCELLATION_DEADLINE_UNAVAILABLE_MESSAGE);
      expect(sendRequest).not.toHaveBeenCalled();
    },
  );

  it('preserves confirmed and proxy actor restrictions before deadline', async () => {
    jest.setSystemTime(new Date('2026-09-27T10:00:00Z'));
    const confirmed = harness({ is_confirmed: true });
    confirmed.press(confirmed.target.id);
    expect(confirmed.alert).toHaveBeenCalledWith('알림', 'confirmed-fixture-lock');
    await expect(confirmed.mutation(confirmed.target.id)).rejects.toThrow('confirmed-fixture-lock');
    expect(confirmed.sendRequest).not.toHaveBeenCalled();
    const proxy = harness({}, true);
    proxy.press(proxy.target.id);
    await expect(proxy.mutation(proxy.target.id)).rejects.toThrow('관리자에게 문의해 주세요');
    expect(proxy.mutate).not.toHaveBeenCalled();
    expect(proxy.sendRequest).not.toHaveBeenCalled();
  });

  it.each(['applied', 'confirmed'])(
    'shows the deadline notice for a selected %s history card regardless of administrator confirmation',
    (status) => {
      const message = evaluate(getInitializer(source, 'currentApplyCancellationMessage'), source, {
        currentApply: {
          status,
          is_confirmed: status === 'confirmed',
          exam_rounds: { registration_deadline: '2026-09-27' },
        },
        policyNow: new Date('2026-10-07T04:00:00Z'),
        serverDeadlineBlockedIds: new Set<string>(),
        EXAM_CANCELLATION_DEADLINE_MESSAGE,
        getExamSelfCancellationDeadlineMessage,
      });
      expect(message).toBe(EXAM_CANCELLATION_DEADLINE_MESSAGE);
    },
  );

  it.each(['rejected', 'cancelled_by_fc', 'completed'])(
    'does not attach an active-registration deadline notice to %s history',
    (status) => {
      const message = evaluate(getInitializer(source, 'currentApplyCancellationMessage'), source, {
        currentApply: { status, exam_rounds: { registration_deadline: '2026-09-27' } },
        policyNow: new Date('2026-10-07T04:00:00Z'),
        serverDeadlineBlockedIds: new Set<string>(),
        EXAM_CANCELLATION_DEADLINE_MESSAGE,
        getExamSelfCancellationDeadlineMessage,
      });
      expect(message).toBeNull();
    },
  );

  it('loads deadline in the column list shared by every history fallback and renders an accessible notice', () => {
    const nestedColumns = getInitializer(source, 'nestedColumns').getText(source);
    expect(nestedColumns).toContain("'registration_deadline'");
    expect(contents).toContain('registration_deadline: examRounds.registration_deadline ?? null');
    expect(contents).toContain('&& !currentApplyCancellationMessage');
    expect(contents).toContain('<Text accessibilityRole="alert" style={styles.emptyText}>');
    expect(contents).toContain('{currentApplyCancellationMessage}');
  });
});
