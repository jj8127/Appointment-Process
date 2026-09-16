import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

describe('server-gated allowance navigation boundary', () => {
  const read = (file: string) => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
  it('offers a data-independent home entry and separates referral relationships from allowance', () => {
    const referral = read('app/referral.tsx');
    expect(referral).not.toMatch(/useReferralAllowanceAccess|referral-allowance|referral-revenue-graph/);
    expect(referral).toContain("router.push('/referral-graph')");
    const home = read('app/index.tsx');
    expect(home).toContain("href: '/referral-allowance'");
    expect(home).toContain("title: '수당 그래프'");
    expect(home).not.toContain('useReferralAllowanceAccess');
    expect(read('app/_layout.tsx').match(/name="referral-allowance"/g)).toHaveLength(2);
  });
  it('shows only a published statement graph with preserved provenance and bounded rendering', () => {
    const screen = read('app/referral-allowance.tsx');
    expect(screen).not.toMatch(/referral-revenue-demo|REFERRAL_REVENUE_DEMO|calculateSample/);
    expect(screen).toContain('key={access.scope}');
    expect(screen).toContain("useState<'graph' | 'details'>('graph')");
    expect(screen).toContain('<AllowanceGraph statement={statement}');
    expect(screen).toContain('전체 FP 내역');
    expect(screen).toContain('금액 합계와 상세 내역의 전체 FP 내역에는 모두 포함됩니다');
    expect(screen).toContain('getNodeAccessibilityLabel={describeNode}');
    expect(screen).toContain('계보·자격 기준(시범)');
    expect(screen).toContain('계보·인사 원본 기준일');
    expect(screen).toContain('statement.sourceSnapshotDates');
    expect(screen).toContain('statement.usesLaterSnapshot');
    expect(screen).not.toContain('업적월 말일');
  });

  it('keeps the inline graph in a gesture boundary and detail modal within its own safe area', () => {
    const source = ts.createSourceFile('screen.tsx', read('app/referral-allowance.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const paths: string[][] = [];
    const visit = (node: ts.Node, ancestors: string[]) => {
      const element = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
      const next = element ? [...ancestors, element.tagName.getText(source)] : ancestors;
      if (element) paths.push(next);
      ts.forEachChild(node, (child) => visit(child, next));
    };
    visit(source, []);
    const graphPath = paths.find((tags) => tags.at(-1) === 'AllowanceGraph');
    expect(graphPath).toBeDefined();
    expect(graphPath).toContain('GestureHandlerRootView');
    expect(graphPath).not.toContain('Modal');
    const safeAreas = paths.filter((tags) => tags.includes('Modal') && tags.at(-1) === 'SafeAreaView');
    expect(safeAreas).toHaveLength(1);
    for (const tags of safeAreas) expect(tags).toContain('SafeAreaProvider');
  });
});
