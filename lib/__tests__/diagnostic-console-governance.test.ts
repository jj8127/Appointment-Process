import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

type Classification = 'fixed-non-sensitive' | 'unproven';
type BaselineSink = {
  path: string;
  method: string;
  call: string;
  classification: Classification;
  anchor: string;
};
type Baseline = {
  description: string;
  auditedFiles: string[];
  expectedCounts: Record<Classification | 'total', number>;
  sinks: BaselineSink[];
};

const root = path.resolve(__dirname, '..', '..');
const baseline = JSON.parse(
  fs.readFileSync(path.join(root, 'scripts/ci/edge-diagnostic-console-baseline.json'), 'utf8'),
) as Baseline;
const methods = new Set(['log', 'warn', 'error', 'info', 'debug']);
const normalize = (value: string): string => value.replace(/\s+/g, ' ').trim();
const keyFor = (sink: Pick<BaselineSink, 'path' | 'method' | 'call'>): string =>
  JSON.stringify([sink.path, sink.method, normalize(sink.call)]);

type ConsoleAnalysis = {
  sinks: BaselineSink[];
  forbiddenConsoleForms: string[];
  nonLiteralConsoleForms: string[];
};

function analyzeConsoleSource(relativePath: string, sourceText: string): ConsoleAnalysis {
  const sourceFile = ts.createSourceFile(
    relativePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const sinks: BaselineSink[] = [];
  const forbiddenConsoleForms: string[] = [];
  const nonLiteralConsoleForms: string[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isIdentifier(node)
      && node.text === 'console'
    ) {
      const propertyAccess = node.parent;
      const directCall = ts.isPropertyAccessExpression(propertyAccess)
        && propertyAccess.expression === node
        && methods.has(propertyAccess.name.text)
        && ts.isCallExpression(propertyAccess.parent)
        && propertyAccess.parent.expression === propertyAccess;
      if (!directCall) {
        forbiddenConsoleForms.push(normalize(node.parent.getText(sourceFile)));
      }
    }

    if (
      ts.isElementAccessExpression(node)
      && node.argumentExpression
      && ts.isStringLiteral(node.argumentExpression)
      && node.argumentExpression.text === 'console'
    ) {
      forbiddenConsoleForms.push(normalize(node.getText(sourceFile)));
    }

    if (ts.isCallExpression(node)) {
      if (
        ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === 'console'
        && methods.has(node.expression.name.text)
      ) {
        if (
          node.arguments.length !== 1
          || !(
            ts.isStringLiteral(node.arguments[0])
            || ts.isNoSubstitutionTemplateLiteral(node.arguments[0])
          )
        ) {
          nonLiteralConsoleForms.push(normalize(node.getText(sourceFile)));
        }
        sinks.push({
          path: relativePath,
          method: node.expression.name.text,
          call: normalize(node.getText(sourceFile)),
          classification: 'unproven',
          anchor: 'runtime-inventory',
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return { sinks, forbiddenConsoleForms, nonLiteralConsoleForms };
}

function collectConsoleSinks(relativePath: string): BaselineSink[] {
  const sourceText = fs.readFileSync(path.join(root, relativePath), 'utf8');
  const analysis = analyzeConsoleSource(relativePath, sourceText);
  expect(analysis.forbiddenConsoleForms).toEqual([]);
  expect(analysis.nonLiteralConsoleForms).toEqual([]);
  return analysis.sinks;
}

describe('reviewed diagnostic console allowlist governance', () => {
  test('rejects aliases, indirect calls, global access, element access, and variable arguments', () => {
    for (const source of [
      "const warn = console.warn; warn('POISON');",
      "console.warn.call(console, 'POISON');",
      "globalThis.console.warn('POISON');",
      "globalThis['console'].warn('POISON');",
      "console['warn']('POISON');",
    ]) {
      expect(analyzeConsoleSource('poison.ts', source).forbiddenConsoleForms).not.toEqual([]);
    }

    for (const source of [
      'console.warn(secret);',
      "console.warn('fixed', secret);",
      'console.warn(`POISON ${secret}`);',
    ]) {
      expect(analyzeConsoleSource('poison.ts', source).nonLiteralConsoleForms).not.toEqual([]);
    }

    expect(analyzeConsoleSource('positive.ts', "console.warn('fixed literal')")).toMatchObject({
      forbiddenConsoleForms: [],
      nonLiteralConsoleForms: [],
      sinks: [{ method: 'warn' }],
    });
  });

  test('allows exactly 9 explicitly reviewed single-literal sinks and no unproven sinks', () => {
    expect(baseline.description).toMatch(/explicitly reviewed single-literal console diagnostics/i);
    expect(new Set(baseline.auditedFiles).size).toBe(14);
    expect(baseline.sinks).toHaveLength(baseline.expectedCounts.total);
    expect(baseline.sinks.filter((sink) => sink.classification === 'fixed-non-sensitive')).toHaveLength(
      baseline.expectedCounts['fixed-non-sensitive'],
    );
    expect(baseline.sinks.filter((sink) => sink.classification === 'unproven')).toHaveLength(
      baseline.expectedCounts.unproven,
    );
    expect(baseline.sinks.every((sink) => sink.classification === 'fixed-non-sensitive')).toBe(true);
    expect(baseline.expectedCounts).toEqual({
      'fixed-non-sensitive': 9,
      unproven: 0,
      total: 9,
    });

    const actual = baseline.auditedFiles.flatMap(collectConsoleSinks).map(keyFor).sort();
    const expected = baseline.sinks.map(keyFor).sort();
    expect(actual).toEqual(expected);
  });
});
