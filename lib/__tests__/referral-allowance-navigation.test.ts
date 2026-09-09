import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

describe('server-gated allowance navigation boundary', () => {
  const read = (file: string) => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
  it('routes a permitted account to a separate statement and retains the fictional preview', () => {
    const referral = read('app/referral.tsx');
    expect(referral).toContain("allowanceAccess.mode === 'enabled'");
    expect(referral).toContain("router.push('/referral-allowance')");
    expect(referral).toContain("allowanceAccess.mode !== 'sample'");
    expect(referral).toContain("router.push('/referral-revenue-graph')");
    expect(read('app/_layout.tsx').match(/name="referral-allowance"/g)).toHaveLength(2);
  });
  it('does not import fictional calculations and mounts the graph only on demand', () => {
    const screen = read('app/referral-allowance.tsx');
    expect(screen).not.toMatch(/referral-revenue-demo|REFERRAL_REVENUE_DEMO|calculateSample/);
    expect(screen).toContain('key={access.scope}');
    expect(screen).toContain('{graphOpen ? <Modal');
    expect(screen).toContain('<AllowanceGraph statement={statement}');
    expect(screen).toContain('전체 FP 내역');
    expect(screen).toContain('위 금액 합계와 전체 FP 내역에는 모두 포함됩니다');
    expect(screen).toContain('getNodeAccessibilityLabel={describeNode}');
    expect(screen).toContain('계보·자격 기준(시범)');
    expect(screen).toContain('계보·인사 원본 기준일');
    expect(screen).toContain('statement.sourceSnapshotDates');
    expect(screen).toContain('statement.usesLaterSnapshot');
    expect(screen).not.toContain('업적월 말일');
  });

  it('gives native modal content its own gesture boundary and safe-area measurement', () => {
    const source = ts.createSourceFile('screen.tsx', read('app/referral-allowance.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const paths: string[][] = [];
    const visit = (node: ts.Node, ancestors: string[]) => {
      const element = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
      const next = element ? [...ancestors, element.tagName.getText(source)] : ancestors;
      if (element && ancestors.includes('Modal')) paths.push(next.slice(next.lastIndexOf('Modal')));
      ts.forEachChild(node, (child) => visit(child, next));
    };
    visit(source, []);
    const graphPath = paths.find((tags) => tags.at(-1) === 'AllowanceGraph');
    expect(graphPath).toBeDefined();
    expect(graphPath).toEqual(expect.arrayContaining(['GestureHandlerRootView', 'SafeAreaProvider', 'SafeAreaView']));
    const safeAreas = paths.filter((tags) => tags.at(-1) === 'SafeAreaView');
    expect(safeAreas).toHaveLength(2);
    for (const tags of safeAreas) expect(tags).toContain('SafeAreaProvider');
  });
});
