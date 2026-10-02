import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import type { ErrorBoundary as ErrorBoundaryType } from '../ErrorBoundary';
import { setSentryCaptureException } from '../../lib/sentry-monitor';

jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles },
}));
jest.mock('@/components/StatusGlyph', () => ({ __esModule: true, default: 'StatusGlyph' }));

const output = ts.transpileModule(readFileSync(join(__dirname, '../ErrorBoundary.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const exported: { ErrorBoundary?: typeof ErrorBoundaryType } = {};
// Use the repository's TSX fixture pattern; the root Jest transform preserves JSX.
new Function('require', 'exports', output)(require, exported);
const ErrorBoundary = exported.ErrorBoundary!;

test('one caught render error emits one exception with its original component stack', () => {
  const capture = jest.fn();
  const warn = jest.spyOn(console, 'warn').mockImplementation();
  const onError = jest.fn();
  setSentryCaptureException(capture);
  try {
    const error = new Error('render failed');
    const info = { componentStack: '\n    at SyntheticScreen' };
    const boundary = new ErrorBoundary({ children: null, onError });
    boundary.componentDidCatch(error, info);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(error, info);
    expect(onError).toHaveBeenCalledWith(error, info);
    expect(warn).toHaveBeenCalledTimes(1);
  } finally {
    setSentryCaptureException(null);
    warn.mockRestore();
  }
});
