import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicFunctions = new Set(['request-password-reset', 'reset-password']);

function memberName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) return node.argumentExpression.text;
  return null;
}

function findProtectedInvocations(source, fileName = 'client.tsx') {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const violations = [];
  function visit(node) {
    if (ts.isCallExpression(node) && memberName(node.expression) === 'invoke'
      && memberName(node.expression.expression) === 'functions') {
      const functionName = node.arguments[0];
      const literalName = functionName && ts.isStringLiteralLike(functionName) ? functionName.text : null;
      if (!literalName || !publicFunctions.has(literalName)) {
        violations.push({
          functionName: literalName ?? '(dynamic)',
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return violations;
}

function isServerSource(relativePath, source) {
  return relativePath.startsWith('app/api/')
    || /(?:^|\/)(?:server-[^/]+|[^/]+-server|[^/]+\.server|route)\.tsx?$/.test(relativePath)
    || /^\s*['"]use server['"];?/m.test(source)
    || /import\s*['"]server-only['"]/.test(source);
}

function* sourceFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(path);
    else if (/\.tsx?$/.test(entry.name) && !/\.test(?:\.|$)|\.d\.ts$/.test(entry.name)) yield path;
  }
}

test('guard detects typed, multiline, computed and dynamic direct Edge invocations', () => {
  const violations = findProtectedInvocations(`
    supabase.functions.invoke<{ ok: boolean }>(
      'delete-account', { body: {} }
    );
    supabase.functions['invoke']('board-list');
    supabase.functions.invoke(functionName);
    supabase.functions.invoke('request-password-reset');
    supabase.functions.invoke('reset-password');
  `);
  assert.deepEqual(violations.map((item) => item.functionName), ['delete-account', 'board-list', '(dynamic)']);
  assert.equal(isServerSource('app/api/auth/login/route.ts', ''), true);
  assert.equal(isServerSource('lib/server-session.ts', ''), true);
  assert.equal(isServerSource('lib/agent-room-server.ts', ''), true);
  assert.equal(isServerSource('lib/actions.ts', "'use server';"), true);
});

test('browser web code invokes protected Edge functions only through authenticated server routes', () => {
  const violations = [];
  for (const path of sourceFiles(srcDir)) {
    const source = readFileSync(path, 'utf8');
    const file = relative(srcDir, path).replaceAll('\\', '/');
    if (isServerSource(file, source)) continue;
    for (const invocation of findProtectedInvocations(source, path)) violations.push({ file, ...invocation });
  }
  assert.deepEqual(violations, [], 'Protected direct Edge calls cannot read the HttpOnly app-session cookie');
});
