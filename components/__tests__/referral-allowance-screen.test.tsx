import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { act, createElement, type ReactElement, type ReactNode } from 'react';
import * as ts from 'typescript';

import * as allowanceDisplay from '@/lib/referral-allowance-display';
import * as theme from '@/lib/theme';
import type { ReferralAllowanceNode, ReferralAllowanceStatement } from '@/types/referral-allowance';
import type { ReferralGraphNode } from '@/types/referral-graph';

type Instance = {
  type: unknown;
  parent: Instance | null;
  children: (Instance | string)[];
  props: Record<string, unknown>;
  findAll: (predicate: (node: Instance) => boolean) => Instance[];
  findAllByType: (type: string) => Instance[];
  findByType: (type: string) => Instance;
};
type Renderer = { root: Instance; update: (element: ReactElement) => void; unmount: () => void };
// The installed renderer has no separate types package; only the used test surface is declared.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { create } = require('react-test-renderer') as { create: (element: ReactElement) => Renderer };
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const accessRetry = jest.fn();
const statementRetry = jest.fn();
const push = jest.fn();
let access: { scope: number; enabled: boolean; isLoading: boolean; error: unknown;
  data: { enabled: true; availableMonths: string[] }; retry: () => void };
let query: { enabled: boolean; isLoading: boolean; error: unknown; availableMonths: string[];
  statement: ReferralAllowanceStatement | null; retry: () => void };
let statements: Record<string, ReferralAllowanceStatement>;
const useAllowance = jest.fn((month?: string) => ({ ...query,
  statement: month ? statements[month] ?? null : query.statement }));

type NativeProps = { children?: ReactNode; visible?: boolean } & Record<string, unknown>;
type ListProps = NativeProps & { data: ReferralAllowanceNode[];
  keyExtractor: (node: ReferralAllowanceNode) => string;
  renderItem: (info: { item: ReferralAllowanceNode; index: number }) => ReactElement;
  ListHeaderComponent?: ReactNode; ListEmptyComponent?: ReactNode };

// Mirror rendered list items and modal visibility without loading native gesture or network code.
function FlatList(props: ListProps) {
  return createElement('FlatList', props, props.ListHeaderComponent,
    props.data.length ? props.data.map((item, index) => createElement(React.Fragment,
      { key: props.keyExtractor(item) }, props.renderItem({ item, index }))) : props.ListEmptyComponent);
}
function Modal({ visible, children, ...props }: NativeProps) {
  return visible ? createElement('Modal', { ...props, visible }, children) : null;
}

// Follow the existing AppAlertProvider renderer pattern: compile the actual route's JSX,
// replacing only environment boundaries. Display/graph mapping functions remain real.
function loadScreen(): React.ComponentType {
  const code = ts.transpileModule(readFileSync(join(__dirname, '../../app/referral-allowance.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const exported: { default?: React.ComponentType } = {};
  new Function('require', 'exports', code)((name: string) => {
    if (name === 'react') return React;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (name === 'react-native') return {
      ActivityIndicator: 'ActivityIndicator', FlatList, Modal,
      Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
      StyleSheet: { create: (styles: unknown) => styles, absoluteFillObject: {} },
    };
    if (name === '@expo/vector-icons') return { Feather: 'Feather' };
    if (name === 'expo-router') return { useRouter: () => ({ push }) };
    if (name === 'react-native-gesture-handler') return { GestureHandlerRootView: 'GestureHandlerRootView' };
    if (name === 'react-native-safe-area-context') return {
      SafeAreaView: 'SafeAreaView', SafeAreaProvider: 'SafeAreaProvider',
    };
    if (name === '@/components/referral-graph/ReferralGraphCanvas') return { ReferralGraphCanvas: 'ReferralGraphCanvas' };
    if (name === '@/hooks/use-referral-allowance') return {
      useReferralAllowanceAccess: () => access, useReferralAllowance: useAllowance,
    };
    if (name === '@/hooks/use-referral-app-session') return {
      isReferralReloginError: (error: unknown) => Boolean(error && typeof error === 'object'
        && 'needsRelogin' in error && error.needsRelogin === true),
    };
    if (name === '@/lib/referral-allowance-display') return allowanceDisplay;
    if (name === '@/lib/theme') return theme;
    throw new Error(`Unexpected screen dependency: ${name}`);
  }, exported);
  return exported.default!;
}
const Screen = loadScreen();

function statement(month: string): ReferralAllowanceStatement {
  const base = { affiliation: '가상 지점', activeAtPerformance: true, eligibleAtBasisDate: true };
  return {
    schemaVersion: 1, policyVersion: 'recruitment-2026-09-07-snapshot-pilot-v1',
    performanceMonth: month, paymentDate: '2026-09-25', genealogyAsOf: '2026-08-31',
    sourceSnapshotDates: ['2026-08-31'], usesLaterSnapshot: false, eligibilityBasis: 'uploaded_snapshot',
    status: 'current_month_estimate', previousCarryIncluded: false,
    beneficiary: { nodeId: 'root', name: '가상 수령인', eligibleAtBasisDate: true },
    nodes: [
      { ...base, id: 'root', parentId: null, depth: 0, name: '가상 수령인', isBeneficiary: true,
        finalTargetPerformanceKrw: 7750000, fpRoundedAmountKrw: 770000, contributionKrw: 0 },
      { ...base, id: 'positive', parentId: 'root', depth: 1, name: '가상 기여자', isBeneficiary: false,
        finalTargetPerformanceKrw: 325000.25, fpRoundedAmountKrw: 30000, contributionKrw: 30000 },
      { ...base, id: 'negative', parentId: 'positive', depth: 2, name: '가상 조정자', isBeneficiary: false,
        finalTargetPerformanceKrw: -205000.75, fpRoundedAmountKrw: -20000, contributionKrw: -20000 },
    ],
    summary: { currentMonthNetKrw: 10000, newPaymentKrw: 10000, carryForwardKrw: 0,
      extinguishedKrw: 0, excludedByEligibilityKrw: 0 },
    validation: { visiblePeopleCount: 3, contributorCount: 2, maximumDepth: 10, conservationDifferenceKrw: 0 },
  };
}

describe('standalone allowance page interactions', () => {
  let renderer: Renderer | undefined;
  const root = () => renderer!.root;
  const texts = (within = root()) => within.findAllByType('Text')
    .map((node) => node.children.filter((child) => typeof child === 'string').join(''));
  const pressable = (label: string) => {
    const matches = root().findAllByType('Pressable').filter((node) =>
      node.props.accessibilityLabel === label || texts(node).includes(label));
    expect(matches.length).toBeGreaterThan(0);
    return matches[0];
  };
  async function press(label: string) {
    await act(async () => { (pressable(label).props.onPress as () => void)(); });
  }
  async function mount() { await act(async () => { renderer = create(createElement(Screen)); }); }
  async function update() { await act(async () => { renderer!.update(createElement(Screen)); }); }
  const canvas = () => root().findByType('ReferralGraphCanvas');
  async function selectNode(id: string) {
    const graph = canvas();
    const node = (graph.props.nodes as ReferralGraphNode[]).find((item) => item.id === id)!;
    expect(node).toBeDefined();
    await act(async () => { (graph.props.onSelectNode as (node: ReferralGraphNode) => void)(node); });
  }
  function expectNoGraphOrSample() {
    expect(root().findAllByType('ReferralGraphCanvas')).toHaveLength(0);
    expect(root().findAllByType('Modal')).toHaveLength(0);
    expect(texts().join(' ')).not.toMatch(/샘플|가상 수령인|가상 기여자|가상 조정자/);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    statements = { '2026-08': statement('2026-08'), '2026-07': statement('2026-07') };
    access = { scope: 1, enabled: true, isLoading: false, error: null,
      data: { enabled: true, availableMonths: ['2026-08', '2026-07'] }, retry: accessRetry };
    query = { enabled: true, isLoading: false, error: null, availableMonths: ['2026-08', '2026-07'],
      statement: statements['2026-08'], retry: statementRetry };
  });
  afterEach(async () => {
    if (renderer) await act(async () => { renderer!.unmount(); });
    renderer = undefined;
  });

  it('opens the published graph on the page, with the actual signed amounts and no graph modal', async () => {
    await mount();
    const graph = canvas();
    expect((graph.props.nodes as ReferralGraphNode[]).map((node) => node.id)).toEqual(['root', 'positive', 'negative']);
    expect(graph.props.nodeAmounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: 'positive', directText: '직접 +30,000원', totalText: '총 +10,000원' }),
      expect.objectContaining({ nodeId: 'negative', directText: '직접 −20,000원', totalText: '총 −20,000원' }),
    ]));
    let ancestor = graph.parent;
    while (ancestor && ancestor.type !== 'GestureHandlerRootView') ancestor = ancestor.parent;
    expect(ancestor).not.toBeNull();
    expect(root().findAllByType('Modal')).toHaveLength(0);
    expect(pressable('수당 그래프').props.accessibilityState).toMatchObject({ selected: true });
    expect(texts().join(' ')).toMatch(/실적월 2026-08.*지급예정일 2026-09-25/);
  });

  it('switches to the virtualized FP details and monthly amounts, then back to the graph', async () => {
    await mount();
    await press('상세 내역');
    expect(root().findAllByType('ReferralGraphCanvas')).toHaveLength(0);
    const list = root().findByType('FlatList');
    expect((list.props.data as ReferralAllowanceNode[]).map((node) => node.id)).toEqual(['positive', 'negative']);
    expect(list.props.initialNumToRender).toBe(12);
    expect(list.props.maxToRenderPerBatch).toBe(12);
    expect(list.props.windowSize).toBe(5);
    expect(texts()).toEqual(expect.arrayContaining(['당월 신규 지급예정액', '10,000원', '다음 달 이월',
      '소액 음수 소멸', '당월 기여액 합계', '+10,000원', '가상 기여자', '+30,000원', '가상 조정자', '−20,000원']));
    await press('가상 조정자');
    expect(texts(root().findByType('Modal'))).toEqual(expect.arrayContaining(['가상 조정자', '매출(산정 기준)', '−205,000.75원', '내 수당', '−20,000원']));
    await press('FP 상세 닫기');
    await press('수당 그래프');
    expect(canvas().props.selectedNodeId).toBeNull();
    expect(root().findAllByType('FlatList')).toHaveLength(0);
  });

  it.each([
    ['positive', '가상 기여자', '325,000.25원', '+30,000원'],
    ['negative', '가상 조정자', '−205,000.75원', '−20,000원'],
    ['root', '가상 수령인', '7,750,000원', '0원'],
  ])('selecting %s shows that person’s own performance and signed allowance', async (id, name, performance, amount) => {
    await mount();
    await selectNode(id);
    expect(canvas().props.selectedNodeId).toBe(id);
    const modal = root().findByType('Modal');
    expect(texts(modal)).toEqual(expect.arrayContaining([name, '매출(산정 기준)', performance, '내 수당', amount]));
    if (id === 'root') expect(texts(modal)).not.toContain('+10,000원');
    await act(async () => { (modal.props.onRequestClose as () => void)(); });
    expect(canvas().props.selectedNodeId).toBeNull();
    expect(root().findAllByType('Modal')).toHaveLength(0);
  });

  it('changing month requests that month and clears an open person selection', async () => {
    await mount();
    await selectNode('negative');
    await press('2026년 7월');
    expect(useAllowance).toHaveBeenLastCalledWith('2026-07');
    expect(canvas().props.selectedNodeId).toBeNull();
    expect(root().findAllByType('Modal')).toHaveLength(0);
    expect(pressable('2026년 7월').props.accessibilityState).toMatchObject({ selected: true });
  });

  it.each(['loading-between-snapshots', 'replacement-in-one-render'])
  ('does not reopen a selected person when a refreshed statement reuses their row ID: %s', async (transition) => {
    await mount();
    await selectNode('positive');
    expect(texts(root().findByType('Modal'))).toContain('가상 기여자');

    if (transition === 'loading-between-snapshots') {
      query.isLoading = true;
      query.enabled = false;
      query.statement = null;
      await update();
      expect(root().findAllByType('Modal')).toHaveLength(0);
      expect(root().findAllByType('ActivityIndicator')).toHaveLength(1);
    }

    const refreshed = statement('2026-08');
    refreshed.nodes[1].name = '새 명세의 가상 기여자';
    refreshed.nodes[1].finalTargetPerformanceKrw = 615000.25;
    refreshed.nodes[1].fpRoundedAmountKrw = 60000;
    refreshed.nodes[1].contributionKrw = 60000;
    refreshed.summary.currentMonthNetKrw = 40000;
    refreshed.summary.newPaymentKrw = 40000;
    query.isLoading = false;
    query.enabled = true;
    query.statement = refreshed;
    await update();

    expect((canvas().props.nodes as ReferralGraphNode[]).find((node) => node.id === 'positive')?.name)
      .toBe('새 명세의 가상 기여자');
    expect(canvas().props.selectedNodeId).toBeNull();
    expect(root().findAllByType('Modal')).toHaveLength(0);
    await selectNode('positive');
    expect(texts(root().findByType('Modal')))
      .toEqual(expect.arrayContaining(['새 명세의 가상 기여자', '615,000.25원', '+60,000원']));
  });

  it('lets the user leave an empty selected month for another available month', async () => {
    await mount();
    await press('2026년 7월');
    expect(useAllowance).toHaveBeenLastCalledWith('2026-07');
    delete statements['2026-07'];
    query.availableMonths = ['2026-08'];
    await update();

    expect(texts()).toContain('아직 등록된 수당 정보가 없습니다');
    expectNoGraphOrSample();
    await press('2026년 8월');
    expect(useAllowance).toHaveBeenLastCalledWith('2026-08');
    expect(canvas().props.selectedNodeId).toBeNull();
    expect(texts()).not.toContain('아직 등록된 수당 정보가 없습니다');
  });

  it('a new signed owner scope resets the selected month, detail view, and person', async () => {
    await mount();
    await press('2026년 7월');
    await press('상세 내역');
    await press('가상 기여자');
    access.scope = 2;
    query.statement = statement('2026-08');
    query.statement.beneficiary.name = '새 가상 수령인';
    query.statement.nodes[0].name = '새 가상 수령인';
    await update();
    expect(useAllowance).toHaveBeenLastCalledWith(undefined);
    expect(canvas().props.selectedNodeId).toBeNull();
    expect(root().findAllByType('Modal')).toHaveLength(0);
    expect(pressable('수당 그래프').props.accessibilityState).toMatchObject({ selected: true });
    expect(pressable('2026년 8월').props.accessibilityState).toMatchObject({ selected: true });
    expect((canvas().props.nodes as ReferralGraphNode[])[0].name).toBe('새 가상 수령인');
  });

  it.each(['access-disabled', 'statement-disabled', 'statement-null', 'no-nodes'])
  ('shows the same no-information guidance and working refresh for %s', async (condition) => {
    if (condition === 'access-disabled') access.enabled = false;
    if (condition === 'statement-disabled') query.enabled = false;
    if (condition === 'statement-null') query.statement = null;
    if (condition === 'no-nodes') query.statement!.nodes = [];
    await mount();
    expect(texts()).toEqual(expect.arrayContaining(['아직 등록된 수당 정보가 없습니다',
      '수당 자료가 등록되면 이곳에서 월별 수당과 그래프를 확인할 수 있습니다.', '새로 확인']));
    expectNoGraphOrSample();
    await press('새로 확인');
    expect(condition === 'access-disabled' ? accessRetry : statementRetry).toHaveBeenCalledTimes(1);
    if (condition === 'access-disabled') expect(useAllowance).not.toHaveBeenCalled();
  });

  it.each(['access', 'statement'])('keeps %s loading separate from missing information', async (layer) => {
    if (layer === 'access') access.isLoading = true;
    else query.isLoading = true;
    await mount();
    expect(root().findAllByType('ActivityIndicator')).toHaveLength(1);
    expect(texts()).toContain('증원수당 내역을 확인하고 있습니다.');
    expect(texts()).not.toContain('아직 등록된 수당 정보가 없습니다');
    expectNoGraphOrSample();
  });

  it.each(['access', 'statement'])('retries a %s failure without rendering stale graph data', async (layer) => {
    const error = new Error('synthetic connection failure');
    if (layer === 'access') access.error = error;
    else query.error = error;
    await mount();
    expect(texts()).toContain('수당 내역을 불러오지 못했습니다');
    expect(texts()).not.toContain('아직 등록된 수당 정보가 없습니다');
    expectNoGraphOrSample();
    await press('다시 시도');
    expect(layer === 'access' ? accessRetry : statementRetry).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it.each(['access', 'statement'])('routes a %s expired session to login', async (layer) => {
    const error = { needsRelogin: true };
    if (layer === 'access') access.error = error;
    else query.error = error;
    await mount();
    expect(texts()).toContain('다시 로그인해주세요');
    expectNoGraphOrSample();
    await press('로그인');
    expect(push).toHaveBeenCalledWith('/login?skipAuto=1');
    expect(accessRetry).not.toHaveBeenCalled();
    expect(statementRetry).not.toHaveBeenCalled();
  });
});
