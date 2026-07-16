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

function collectConsoleSinks(relativePath: string): BaselineSink[] {
  const filePath = path.join(root, relativePath);
  const sourceText = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    relativePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const sinks: BaselineSink[] = [];
  const forbiddenConsoleForms: string[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node)
      && node.initializer
      && ts.isIdentifier(node.initializer)
      && node.initializer.text === 'console'
    ) {
      forbiddenConsoleForms.push(normalize(node.getText(sourceFile)));
    }

    if (ts.isCallExpression(node)) {
      if (
        ts.isElementAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === 'console'
      ) {
        forbiddenConsoleForms.push(normalize(node.getText(sourceFile)));
      }

      if (
        ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === 'console'
        && methods.has(node.expression.name.text)
      ) {
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

  expect(forbiddenConsoleForms).toEqual([]);
  return sinks;
}

describe('reviewed diagnostic console debt governance', () => {
  test('freezes exactly 9 fixed and 27 unproven direct sinks without approving either class', () => {
    expect(baseline.description).toMatch(/not approved safe sinks/i);
    expect(new Set(baseline.auditedFiles).size).toBe(14);
    expect(baseline.sinks).toHaveLength(baseline.expectedCounts.total);
    expect(baseline.sinks.filter((sink) => sink.classification === 'fixed-non-sensitive')).toHaveLength(
      baseline.expectedCounts['fixed-non-sensitive'],
    );
    expect(baseline.sinks.filter((sink) => sink.classification === 'unproven')).toHaveLength(
      baseline.expectedCounts.unproven,
    );
    expect(baseline.expectedCounts).toEqual({
      'fixed-non-sensitive': 9,
      unproven: 27,
      total: 36,
    });

    const actual = baseline.auditedFiles.flatMap(collectConsoleSinks).map(keyFor).sort();
    const expected = baseline.sinks.map(keyFor).sort();
    expect(actual).toEqual(expected);
  });
});
