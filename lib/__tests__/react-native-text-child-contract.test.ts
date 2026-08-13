import { relative } from 'node:path';

import ts from 'typescript';

const NATIVE_CONTAINER_HOSTS = new Set([
  'Animated.ScrollView',
  'Animated.View',
  'FlatList',
  'GestureHandlerRootView',
  'ImageBackground',
  'KeyboardAvoidingView',
  'LinearGradient',
  'Modal',
  'MotiView',
  'Pressable',
  'SafeAreaView',
  'ScrollView',
  'SectionList',
  'TouchableOpacity',
  'TouchableWithoutFeedback',
  'View',
]);

const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, 'tsconfig.json');

if (!configPath) {
  throw new Error('tsconfig.json not found');
}

const config = ts.readConfigFile(configPath, ts.sys.readFile);
const parsedConfig = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
const program = ts.createProgram(parsedConfig.fileNames, parsedConfig.options);
const checker = program.getTypeChecker();

const mobileSourceFiles = program.getSourceFiles().filter((sourceFile) => {
  if (sourceFile.isDeclarationFile || !sourceFile.fileName.endsWith('.tsx')) return false;
  const repoPath = relative(process.cwd(), sourceFile.fileName).replaceAll('\\', '/');
  return /^(app|components|hooks)\//.test(repoPath);
});

function getParentHost(node: ts.JsxChild): string | null {
  return ts.isJsxElement(node.parent) ? node.parent.openingElement.tagName.getText() : null;
}

function includesTextPrimitive(type: ts.Type): boolean {
  if (type.isUnion()) return type.types.some(includesTextPrimitive);
  return Boolean(type.flags & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike));
}

function includesNumberPrimitive(type: ts.Type): boolean {
  if (type.isUnion()) return type.types.some(includesNumberPrimitive);
  return Boolean(type.flags & ts.TypeFlags.NumberLike);
}

function isOnlyTextPrimitiveOrIgnored(type: ts.Type): boolean {
  const members = type.isUnion() ? type.types : [type];
  let hasTextPrimitive = false;

  for (const member of members) {
    if (member.flags & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike)) {
      hasTextPrimitive = true;
      continue;
    }
    if (member.flags & (
      ts.TypeFlags.BooleanLike
      | ts.TypeFlags.Null
      | ts.TypeFlags.Undefined
      | ts.TypeFlags.Never
      | ts.TypeFlags.Void
    )) {
      continue;
    }
    return false;
  }

  return hasTextPrimitive;
}

function expressionCanEmitTextPrimitive(expression: ts.Expression): boolean {
  if (
    ts.isParenthesizedExpression(expression)
    || ts.isAsExpression(expression)
    || ts.isTypeAssertionExpression(expression)
    || ts.isNonNullExpression(expression)
    || ts.isSatisfiesExpression(expression)
  ) {
    return expressionCanEmitTextPrimitive(expression.expression);
  }

  if (ts.isConditionalExpression(expression)) {
    return expressionCanEmitTextPrimitive(expression.whenTrue)
      || expressionCanEmitTextPrimitive(expression.whenFalse);
  }

  if (ts.isBinaryExpression(expression)) {
    if (expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      return includesNumberPrimitive(checker.getTypeAtLocation(expression.left))
        || expressionCanEmitTextPrimitive(expression.right);
    }
    if (
      expression.operatorToken.kind === ts.SyntaxKind.BarBarToken
      || expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    ) {
      return includesTextPrimitive(checker.getTypeAtLocation(expression.left))
        || expressionCanEmitTextPrimitive(expression.right);
    }
  }

  return isOnlyTextPrimitiveOrIgnored(checker.getTypeAtLocation(expression));
}

function locationLabel(sourceFile: ts.SourceFile, node: ts.Node): string {
  const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${relative(process.cwd(), sourceFile.fileName).replaceAll('\\', '/')}:${location.line + 1}`;
}

describe('React Native text child contract', () => {
  it('does not emit raw JSX text beneath native container hosts', () => {
    const violations: string[] = [];

    for (const sourceFile of mobileSourceFiles) {
      const sameLineTextChild = /(?:<\/[A-Za-z][^>]*>|\/>)[\t ]+<[A-Za-z/]/g;
      let match: RegExpExecArray | null;

      while ((match = sameLineTextChild.exec(sourceFile.text)) !== null) {
        const location = sourceFile.getLineAndCharacterOfPosition(match.index);
        violations.push(
          `${relative(process.cwd(), sourceFile.fileName).replaceAll('\\', '/')}:${location.line + 1} raw=${JSON.stringify(match[0])}`,
        );
      }

      const visit = (node: ts.Node) => {
        if (ts.isJsxText(node)) {
          const parentHost = getParentHost(node);
          const rawText = node.getText(sourceFile);

          if (parentHost && NATIVE_CONTAINER_HOSTS.has(parentHost) && rawText.trim().length > 0) {
            violations.push(
              `${locationLabel(sourceFile, node)} ${parentHost} raw=${JSON.stringify(rawText.trim())}`,
            );
          }
        }
        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    }

    expect(violations).toEqual([]);
  });

  it('does not render inferred string or number expressions beneath native container hosts', () => {
    const violations: string[] = [];

    for (const sourceFile of mobileSourceFiles) {
      const visit = (node: ts.Node) => {
        if (ts.isJsxExpression(node) && node.expression) {
          const parentHost = getParentHost(node);

          if (parentHost && NATIVE_CONTAINER_HOSTS.has(parentHost)) {
            if (expressionCanEmitTextPrimitive(node.expression)) {
              violations.push(
                `${locationLabel(sourceFile, node)} ${parentHost} expression=${node.expression.getText(sourceFile)}`,
              );
            }
          }
        }
        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    }

    expect(violations).toEqual([]);
  });
});
