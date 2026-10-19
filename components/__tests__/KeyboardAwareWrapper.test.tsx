import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement, forwardRef, useImperativeHandle, type ReactElement } from 'react';
import * as ts from 'typescript';

// Drive the real wrapper with a fictional scroll view that records native scroll commands.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { create } = require('react-test-renderer');
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const platform = { OS: 'android' };
const scrollToPosition = jest.fn();
const FakeScrollView = forwardRef(function FakeScrollView(props: Record<string, unknown>, ref) {
  useImperativeHandle(ref, () => ({ scrollToPosition, scrollToFocusedInput: jest.fn() }));
  return createElement('KeyboardAwareScrollView', props);
});
const exported: Record<string, unknown> = {};
const output = ts.transpileModule(readFileSync(join(__dirname, '../KeyboardAwareWrapper.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
new Function('require', 'exports', output)((name: string) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  if (name === 'react' || name === 'react/jsx-runtime') return require(name);
  if (name === 'react-native') return { Platform: platform };
  if (name === 'react-native-keyboard-aware-scroll-view') return { KeyboardAwareScrollView: FakeScrollView };
  throw new Error(`Unexpected dependency: ${name}`);
}, exported);
const Wrapper = exported.KeyboardAwareWrapper as (props: Record<string, unknown>) => ReactElement;

describe('keyboard-aware wrapper scroll state sync', () => {
  let renderer: ReturnType<typeof create>;
  const scrollView = () => renderer.root.findByType('KeyboardAwareScrollView');
  const scroll = (y: number) => act(() => scrollView().props.onScroll({ nativeEvent: { contentOffset: { x: 0, y } } }));
  const elapse = (ms: number) => act(() => { jest.advanceTimersByTime(ms); });
  beforeEach(() => {
    jest.useFakeTimers();
    platform.OS = 'android';
    scrollToPosition.mockReset();
    act(() => { renderer = create(createElement(Wrapper, null, 'form')); });
  });
  afterEach(() => { act(() => renderer.unmount()); jest.useRealTimers(); });

  it('keeps taps working: disables the JS pan responder and resends a settled offset 1px apart', () => {
    expect(scrollView().props.disableScrollViewPanResponder).toBe(true);
    scroll(240);
    elapse(400);
    expect(scrollToPosition.mock.calls).toEqual([[0, 239, false], [0, 240, false]]);
  });

  it('waits while scrolling continues and ignores the events of its own nudge', () => {
    scroll(100);
    elapse(100);
    scroll(180);
    elapse(100);
    expect(scrollToPosition).not.toHaveBeenCalled();
    elapse(300);
    expect(scrollToPosition).toHaveBeenCalledTimes(2);
    scroll(179);
    scroll(180);
    elapse(1000);
    expect(scrollToPosition).toHaveBeenCalledTimes(2);
  });

  it('resyncs after a content size change but leaves an unscrolled view alone', () => {
    scrollView().props.onContentSizeChange(390, 1200);
    elapse(1000);
    expect(scrollToPosition).not.toHaveBeenCalled();
    scroll(60);
    elapse(400);
    scrollToPosition.mockReset();
    act(() => scrollView().props.onContentSizeChange(390, 1500));
    elapse(400);
    expect(scrollToPosition.mock.calls).toEqual([[0, 59, false], [0, 60, false]]);
  });

  it('does nothing on iOS', () => {
    act(() => renderer.unmount());
    platform.OS = 'ios';
    act(() => { renderer = create(createElement(Wrapper, null, 'form')); });
    scroll(240);
    elapse(1000);
    expect(scrollToPosition).not.toHaveBeenCalled();
  });
});

