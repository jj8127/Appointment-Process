import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import * as display from '../exam-display';

type Element = { type: unknown; props: Record<string, unknown>; key?: string };
type Session = { role: string; readOnly: boolean; staffType?: string };

// Execute the real route, query and mapping with inert native views and hooks.
// All records are fictional; this harness never contacts Supabase.
function loadScreen(file: string, session: Session, attached: boolean | null, hasProfile = true) {
  let queryFn: (() => Promise<unknown[]>) | undefined;
  let applicants: unknown[] = [];
  const select = jest.fn();
  const mutations = jest.fn();
  const registration = {
    id: 'registration-fixture', resident_id: '01000000001', status: 'applied',
    payment_proof_attached: attached, is_confirmed: false,
    exam_rounds: { exam_type: 'life', exam_date: null, round_label: 'fixture' },
    exam_locations: null,
  };
  const profile = { id: 'fc-fixture', phone: '010-0000-0001', name: 'Fixture', affiliation: 'Test' };
  const native = Object.fromEntries([
    'KeyboardAvoidingView', 'Modal', 'Pressable', 'RefreshControl', 'ScrollView',
    'Text', 'TextInput', 'View',
  ].map((name) => [name, name]));
  const element = (type: unknown, props: Record<string, unknown>, key?: string) => ({ type, props, key });
  const modules: Record<string, unknown> = {
    'react/jsx-runtime': { jsx: element, jsxs: element },
    react: {
      useCallback: (fn: unknown) => fn, useEffect: () => undefined,
      useMemo: (fn: () => unknown) => fn(),
      useState: (value: unknown) => [value, jest.fn()],
    },
    'react-native': { ...native, Alert: { alert: jest.fn() }, Platform: { OS: 'android' }, StyleSheet: { create: (styles: unknown) => styles } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@expo/vector-icons': { Feather: 'Feather', Ionicons: 'Ionicons' },
    'expo-router': { router: { back: jest.fn() }, useLocalSearchParams: () => ({}) },
    '@tanstack/react-query': {
      useQueryClient: () => ({ invalidateQueries: jest.fn() }),
      useMutation: () => ({ mutate: mutations, isPending: false }),
      useQuery: (options: { queryFn: () => Promise<unknown[]> }) => {
        queryFn = options.queryFn;
        return { data: applicants, isLoading: false, refetch: jest.fn() };
      },
    },
    '@/hooks/use-session': { useSession: () => ({ ...session, hydrated: true, residentId: 'staff-fixture', appSessionToken: 'fixture-session' }) },
    '@/components/BrandedLoadingState': { default: 'BrandedLoadingState' },
    '@/components/RefreshButton': { RefreshButton: 'RefreshButton' },
    '@/components/ExamPaymentProofHistoryButton': { ExamPaymentProofHistoryButton: 'ProofPreview' },
    '@/lib/exam-admin-api': { deleteExamRegistrationAsAdmin: mutations, transitionExamRegistrationAsAdmin: mutations },
    '@/lib/exam-display': display,
    '@/lib/logger': { logger: { warn: jest.fn() } },
    '@/lib/exam-flow-contract': { formatExamRegistrationStatus: () => '신청' },
    '@/lib/notification-receipt-ui': { NotificationReceiptStatusBanner: 'NotificationBanner' },
    '@/lib/strict-route-params': { hasPresentRouteParam: () => false, parseExactlyOneUuidRouteParam: () => null },
    '@/lib/use-notification-receipt': { useNotificationReceiptCompletion: () => ({ state: 'idle' }) },
    '@/lib/supabase': {
      supabase: {
        from: (table: string) => {
          const response = { data: table === 'exam_registrations' ? [registration] : hasProfile ? [profile] : [], error: null };
          const chain = {
            select: (columns: string) => { select(table, columns); return chain; },
            eq: () => chain, order: async () => response, in: async () => response,
          };
          return chain;
        },
        functions: { invoke: async () => ({ data: { ok: true, residentNumbers: {} }, error: null }) },
      },
    },
  };
  const source = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports: { default?: () => Element } = {};
  new Function('require', 'exports', compiled)((id: string) => {
    if (!(id in modules)) throw new Error(`Unmocked dependency: ${id}`);
    return modules[id];
  }, exports);
  const render = () => exports.default!();
  render();
  return {
    select, mutations,
    load: async () => { applicants = await queryFn!(); return render(); },
  };
}

function allElements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(allElements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  return [element, ...allElements(element.props.children)];
}

describe.each(['app/exam-manage.tsx', 'app/exam-manage2.tsx'])('%s proof preview', (file) => {
  it.each([
    ['총무/관리자', { role: 'admin', readOnly: false, staffType: 'admin' }],
    ['개발자', { role: 'admin', readOnly: false, staffType: 'developer' }],
    ['본부장 조회 전용', { role: 'admin', readOnly: true }],
  ] as const)('passes the selected registration, FC and session for %s', async (_role, session) => {
    const screen = loadScreen(file, session, true);
    const tree = await screen.load();
    expect(screen.select).toHaveBeenCalledWith('exam_registrations', expect.stringContaining('payment_proof_attached'));
    const previews = allElements(tree).filter((node) => node.type === 'ProofPreview');
    expect(previews).toHaveLength(1);
    expect(previews[0].props).toEqual({
      appSessionToken: 'fixture-session', registrationId: 'registration-fixture', targetFcId: 'fc-fixture',
    });
    expect(previews[0].props.targetFcId).not.toBe('staff-fixture');
    expect(screen.mutations).not.toHaveBeenCalled();
  });

  it.each([false, null])('shows no attachment without requesting a photo when attached=%s', async (attached) => {
    const tree = await loadScreen(file, { role: 'admin', readOnly: false }, attached).load();
    const nodes = allElements(tree);
    expect(nodes.some((node) => node.type === 'ProofPreview')).toBe(false);
    expect(nodes.some((node) => node.props.value === '첨부 없음')).toBe(true);
  });

  it('does not substitute the staff identity when the applicant profile cannot be resolved', async () => {
    const tree = await loadScreen(file, { role: 'admin', readOnly: false }, true, false).load();
    const nodes = allElements(tree);
    expect(nodes.some((node) => node.type === 'ProofPreview')).toBe(false);
    expect(nodes.some((node) => node.props.value === '신청자 정보를 확인할 수 없습니다.')).toBe(true);
  });
});
