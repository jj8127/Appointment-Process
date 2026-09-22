import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(__dirname, '../..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const screens = ['app/exam-register.tsx', 'app/exam-register2.tsx'];
const renderers = ['ReactFabric-prod.js', 'ReactNativeRenderer-prod.js'];
const compile = (source: string) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

function readFocusHandler(screen: string): string {
  const source = ts.createSourceFile(screen, read(screen), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration: ts.VariableDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'scrollFocusedInputIntoView') {
      declaration = node;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!declaration) throw new Error(`Focus handler missing: ${screen}`);
  return compile(`const ${declaration.getText(source)}; globalThis.focusHandler = scrollFocusedInputIntoView;`);
}

function createHarness(screen: string, renderer: string, platform: string) {
  // Use the installed RN production implementation, including its actual event
  // pooling and ScrollView null handling. Do not emulate cleanup by mutating an
  // invented event object: the regression depends on RN's release lifecycle.
  const rendererSource = read(`node_modules/react-native/Libraries/Renderer/implementations/${renderer}`);
  const eventStart = rendererSource.indexOf('function functionThatReturnsTrue()');
  const eventEnd = rendererSource.indexOf('var ResponderSyntheticEvent =', eventStart);
  if (eventStart < 0 || eventEnd < 0) throw new Error('RN event pooling source boundaries changed');

  const scrollSource = read('node_modules/react-native/Libraries/Components/ScrollView/ScrollView.js');
  const methodStart = scrollSource.indexOf("  scrollResponderScrollNativeHandleToKeyboard: ScrollViewImperativeMethods[");
  const assignment = scrollSource.indexOf(' =\n', methodStart) + 3;
  const methodEnd = scrollSource.indexOf('\n    };', assignment) + 7;
  if (methodStart < 0 || assignment < 3 || methodEnd < 7) throw new Error('RN ScrollView source boundaries changed');

  const frames: (() => void)[] = [];
  const measureLayout = jest.fn();
  const inputTarget = { measureLayout };
  const scrollViewRef: { current: { scrollResponderScrollNativeHandleToKeyboard?: unknown } | null } = { current: {} };
  const focusedInputTargetRef = { current: null };
  const context = vm.createContext({
    assign: Object.assign,
    useCallback: (callback: unknown) => callback,
    Platform: { OS: platform },
    requestAnimationFrame: (callback: () => void) => frames.push(callback),
    focusedInputTargetRef,
    scrollViewRef,
    _innerView: { nativeInstance: {} },
    _textInputFocusError: jest.fn(),
    _inputMeasureAndScrollToKeyboard: jest.fn(),
  });
  vm.runInContext(rendererSource.slice(eventStart, eventEnd), context);
  vm.runInContext(compile(`globalThis.scrollMethod = ${scrollSource.slice(assignment, methodEnd)}`), context);
  if (scrollViewRef.current) scrollViewRef.current.scrollResponderScrollNativeHandleToKeyboard = context.scrollMethod;
  vm.runInContext(readFocusHandler(screen), context);

  return {
    frames,
    inputTarget,
    measureLayout,
    scrollViewRef,
    focusedInputTargetRef,
    dispatchFocus(target: unknown = inputTarget) {
      context.inputTarget = target;
      vm.runInContext(`
        var event = SyntheticEvent.getPooled({}, null, { type: 'focus' }, inputTarget);
        focusHandler(event);
        if (!event.isPersistent()) event.constructor.release(event);
      `, context);
      expect(vm.runInContext('event.target', context)).toBeNull();
    },
    flushFrame() {
      for (const frame of frames.splice(0)) frame();
    },
  };
}

describe.each(screens)('%s deferred input focus', (screen) => {
  describe.each(renderers)('%s event pooling', (renderer) => {
    it.each(['android', 'ios'])('scrolls the captured target after %s has released the focus event', (platform) => {
      const harness = createHarness(screen, renderer, platform);
      harness.dispatchFocus();
      expect(harness.focusedInputTargetRef.current).toBe(harness.inputTarget);
      expect(harness.frames).toHaveLength(1);
      expect(() => harness.flushFrame()).not.toThrow();
      expect(harness.measureLayout).toHaveBeenCalledTimes(1);
    });
  });

  it('ignores a missing focus target without scheduling a measurement', () => {
    const harness = createHarness(screen, renderers[0], 'android');
    harness.dispatchFocus(null);
    expect(harness.frames).toHaveLength(0);
    expect(harness.measureLayout).not.toHaveBeenCalled();
  });

  it('does not measure after the scroll view unmounts before the frame', () => {
    const harness = createHarness(screen, renderers[0], 'ios');
    harness.dispatchFocus();
    harness.scrollViewRef.current = null;
    expect(() => harness.flushFrame()).not.toThrow();
    expect(harness.measureLayout).not.toHaveBeenCalled();
  });
});
