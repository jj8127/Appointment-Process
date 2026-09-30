import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { act, createElement, type ReactElement, type ReactNode } from 'react';
import * as ts from 'typescript';

import type { ExamApplicationTarget } from '@/lib/exam-payment-proof-api';

type SelectorProps = React.ComponentProps<
  typeof import('../ExamApplicationTargetSelector').ExamApplicationTargetSelector
>;
type Instance = {
  children: (Instance | string)[];
  props: Record<string, unknown>;
  findAllByType: (type: string) => Instance[];
  findByType: (type: string) => Instance;
};
type Renderer = { root: Instance; update: (element: ReactElement) => void; unmount: () => void };
// The installed renderer has no separate types package; declare only the used test surface.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { create } = require('react-test-renderer') as { create: (element: ReactElement) => Renderer };
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type NativeProps = { children?: ReactNode; visible?: boolean } & Record<string, unknown>;
type ListProps = NativeProps & {
  data: ExamApplicationTarget[];
  keyExtractor: (target: ExamApplicationTarget) => string;
  renderItem: (info: { item: ExamApplicationTarget }) => ReactElement;
  ListEmptyComponent?: ReactNode;
};

function FlatList(props: ListProps) {
  return createElement('FlatList', props, props.data.length
    ? props.data.map((item) => createElement(React.Fragment,
      { key: props.keyExtractor(item) }, props.renderItem({ item })))
    : props.ListEmptyComponent);
}
function Modal({ visible, children, ...props }: NativeProps) {
  return visible ? createElement('Modal', { ...props, visible }, children) : null;
}

// Exercise the actual selector and replace only native rendering boundaries.
function loadSelector(): React.ComponentType<SelectorProps> {
  const code = ts.transpileModule(readFileSync(join(__dirname, '../ExamApplicationTargetSelector.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const exported: { ExamApplicationTargetSelector?: React.ComponentType<SelectorProps> } = {};
  new Function('require', 'exports', code)((name: string) => {
    if (name === 'react') return React;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (name === 'react-native') return {
      FlatList, Modal, KeyboardAvoidingView: 'KeyboardAvoidingView',
      Platform: { OS: 'ios' }, Pressable: 'Pressable', Text: 'Text', TextInput: 'TextInput', View: 'View',
      StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    };
    if (name === '@expo/vector-icons') return { Feather: 'Feather' };
    throw new Error(`Unexpected selector dependency: ${name}`);
  }, exported);
  return exported.ExamApplicationTargetSelector!;
}
const Selector = loadSelector();
const targets: ExamApplicationTarget[] = [
  { fcId: 'fictional-fc-a', residentId: 'fictional-owner-a', name: '가상 하나', affiliation: '가상 Alpha 지점', phoneLast4: '1234' },
  { fcId: 'fictional-fc-b', residentId: 'fictional-owner-b', name: '가상 둘', affiliation: '가상 Beta 지점', phoneLast4: '5678' },
];
const safeError = 'FC 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.';

describe('exam application target selector', () => {
  let renderer: Renderer | undefined;
  let props: SelectorProps;
  const root = () => renderer!.root;
  const texts = (within = root()) => within.findAllByType('Text')
    .map((node) => node.children.filter((child) => typeof child === 'string').join(''));
  const button = (label: string, within = root()) => {
    const match = within.findAllByType('Pressable').find((node) =>
      node.props.accessibilityLabel === label || texts(node).includes(label));
    expect(match).toBeDefined();
    return match!;
  };
  async function press(label: string, within = root()) {
    const target = button(label, within);
    expect(target.props.disabled).not.toBe(true);
    await act(async () => { (target.props.onPress as () => void)(); });
  }
  async function mount() {
    await act(async () => { renderer = create(createElement(Selector, props)); });
  }
  async function update(next: Partial<SelectorProps>) {
    props = { ...props, ...next };
    await act(async () => { renderer!.update(createElement(Selector, props)); });
  }
  async function search(value: string) {
    await act(async () => { (root().findByType('TextInput').props.onChangeText as (value: string) => void)(value); });
  }

  beforeEach(() => {
    props = { targets: [], value: null, onChange: jest.fn(), onRetry: jest.fn() };
  });
  afterEach(async () => {
    if (renderer) await act(async () => { renderer!.unmount(); });
    renderer = undefined;
  });

  it('opens while the initial fetch is pending and shows loading instead of an empty result', async () => {
    props.isLoading = true;
    await mount();
    expect(texts()).toContain('FC 목록을 불러오는 중...');
    await press('시험 신청 대상 FC 선택');
    expect(texts(root().findByType('Modal'))).toContain('FC 목록을 불러오는 중...');
    expect(texts()).not.toContain('검색 결과가 없습니다.');
    expect(texts()).not.toContain('신청 가능한 FC가 없습니다.');
    expect(root().findByType('FlatList').props).toMatchObject({
      data: [], keyboardShouldPersistTaps: 'handled', keyboardDismissMode: 'none',
    });
    expect(root().findByType('KeyboardAvoidingView').props.behavior).toBe('padding');
  });

  it('shows the failure and a working retry before opening and inside the modal', async () => {
    props.errorMessage = safeError;
    props.targets = targets;
    await mount();
    expect(root().findAllByType('Modal')).toHaveLength(0);
    expect(texts()).toContain(safeError);
    await press('FC 목록 다시 불러오기');
    expect(props.onRetry).toHaveBeenCalledTimes(1);
    await press('시험 신청 대상 FC 선택');
    const modal = root().findByType('Modal');
    expect(texts(modal)).toContain(safeError);
    expect(texts(modal)).not.toContain('검색 결과가 없습니다.');
    expect(texts(modal)).not.toContain('신청 가능한 FC가 없습니다.');
    expect(root().findByType('FlatList').props.data).toEqual([]);
    expect(texts(modal)).not.toContain('가상 하나');
    await press('FC 목록 다시 불러오기', modal);
    expect(props.onRetry).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['name', '  하나  '],
    ['affiliation', ' alpha '],
    ['last four digits', '1234'],
  ])('recovers after retry and selects a target found by %s', async (_field, term) => {
    props.errorMessage = safeError;
    await mount();
    await press('시험 신청 대상 FC 선택');
    await press('FC 목록 다시 불러오기', root().findByType('Modal'));
    expect(props.onRetry).toHaveBeenCalledTimes(1);
    await update({ isLoading: true });
    expect(texts()).not.toContain(safeError);
    expect(texts(root().findByType('Modal'))).toContain('FC 목록을 불러오는 중...');
    await update({ isLoading: false, errorMessage: null, targets });
    await search(term);
    expect(root().findByType('FlatList').props.data).toEqual([targets[0]]);
    expect(texts()).toContain(targets[0].name);
    expect(texts()).not.toContain(targets[1].name);
    await press(targets[0].name);
    expect(props.onChange).toHaveBeenCalledWith(targets[0]);
    expect(root().findAllByType('Modal')).toHaveLength(0);
    await update({ value: targets[0] });
    await press('시험 신청 대상 FC 선택');
    expect(root().findByType('TextInput').props.value).toBe('');
    expect(root().findByType('FlatList').props.data).toEqual(targets);
  });

  it('offers login instead of retry for an expired session both before opening and inside the modal', async () => {
    props.errorMessage = '로그인 시간이 만료되었습니다. 다시 로그인해주세요.';
    props.onLogin = jest.fn();
    await mount();
    expect(texts()).toContain(props.errorMessage);
    expect(texts()).not.toContain('다시 시도');
    await press('다시 로그인');
    expect(props.onLogin).toHaveBeenCalledTimes(1);
    expect(props.onRetry).not.toHaveBeenCalled();
    await press('시험 신청 대상 FC 선택');
    await search('이전 검색어');
    const modal = root().findByType('Modal');
    expect(texts(modal)).toContain(props.errorMessage);
    expect(texts(modal)).not.toContain('다시 시도');
    await press('다시 로그인', modal);
    expect(props.onLogin).toHaveBeenCalledTimes(2);
    expect(props.onRetry).not.toHaveBeenCalled();
    expect(root().findAllByType('Modal')).toHaveLength(0);
    await press('시험 신청 대상 FC 선택');
    expect(root().findByType('TextInput').props.value).toBe('');
  });

  it.each(['loading', 'error'])('hides previously loaded rows during %s', async (state) => {
    props.targets = targets;
    await mount();
    await press('시험 신청 대상 FC 선택');
    expect(texts()).toContain(targets[0].name);
    await update(state === 'loading' ? { isLoading: true } : { errorMessage: safeError });
    expect(root().findByType('FlatList').props.data).toEqual([]);
    expect(texts()).not.toContain(targets[0].name);
    expect(texts()).not.toContain(targets[1].name);
    expect(texts()).not.toContain('검색 결과가 없습니다.');
  });

  it('distinguishes no eligible targets from no search matches', async () => {
    await mount();
    await press('시험 신청 대상 FC 선택');
    expect(texts()).toContain('신청 가능한 FC가 없습니다.');
    expect(texts()).not.toContain('검색 결과가 없습니다.');
    await update({ targets });
    await search('없는 이름');
    expect(texts()).toContain('검색 결과가 없습니다.');
    expect(texts()).not.toContain('신청 가능한 FC가 없습니다.');
    await search('   ');
    expect(root().findByType('FlatList').props.data).toEqual(targets);
  });

  it('keeps explicit disabled state and both close actions', async () => {
    props.disabled = true;
    await mount();
    expect(button('시험 신청 대상 FC 선택').props.disabled).toBe(true);
    await update({ disabled: false });
    await press('시험 신청 대상 FC 선택');
    await press('대상 선택 닫기');
    expect(root().findAllByType('Modal')).toHaveLength(0);
    await press('시험 신청 대상 FC 선택');
    await act(async () => { (root().findByType('Modal').props.onRequestClose as () => void)(); });
    expect(root().findAllByType('Modal')).toHaveLength(0);
  });
});
