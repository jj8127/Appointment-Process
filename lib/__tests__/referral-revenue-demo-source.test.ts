import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');

function read(relativePath: string) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

describe('referral allowance flow screen source contract', () => {
  const screen = read('app/referral-revenue-graph.tsx');
  const flowCanvas = read(
    'components/referral-revenue-graph/ReferralRevenueFlowCanvas.tsx',
  );
  const flowModel = read('lib/referral-revenue-flow.ts');
  const detail = read(
    'components/referral-revenue-graph/ReferralRevenueDetailSheet.tsx',
  );
  const combined = `${screen}\n${flowCanvas}\n${flowModel}\n${detail}`;

  it('stays fictional and local while reusing only referral graph UI helpers', () => {
    expect(combined).not.toMatch(/\bfetch\s*\(/);
    expect(combined).not.toMatch(/supabase/i);
    expect(combined).not.toMatch(/useQuery|queryClient|refetch/);
    expect(combined).not.toMatch(/useReferralGraph|use-referral-graph/);
    expect(combined).not.toMatch(/components\/referral-graph/);
    expect(flowCanvas).toContain("from '@/lib/referral-graph-native'");
    expect(screen).toContain('REFERRAL_REVENUE_DEMO_RAW_NODES');
  });

  it('states the exact sample boundary without presenting it as a payout rule', () => {
    expect(combined).toContain(
      '샘플 데이터 · 실제 조직, 매출, 정산 내역이 아닙니다.',
    );
    expect(screen).toContain(
      '1~10단계 샘플 매출의 10%를 단순 적용한 화면 예시입니다.',
    );
    expect(screen).toContain('샘플');
    expect(screen).toContain('조회 전용');
  });

  it('gates direct entry with the current local session only', () => {
    expect(screen).toContain('useSession');
    expect(screen).toContain('!isRequestBoardDesigner');
    expect(screen).toContain("role === 'fc'");
    expect(screen).toContain("role === 'admin' && readOnly");
  });

  it('uses one relationship-style flow canvas instead of the retired renderers', () => {
    expect(screen).toContain('<ReferralRevenueFlowCanvas');
    expect(screen).not.toContain('ReferralRevenueGraphCanvas');
    expect(screen).not.toContain('ReferralRevenueGraphWebViewCanvas');
    expect(screen).not.toContain('ReferralRevenueTreeView');
    expect(screen).not.toContain("type ViewMode = 'graph' | 'tree' | 'list'");
    expect(screen).not.toContain('viewMode');
  });

  it('renders the referral relationship graph interaction and radial layout', () => {
    expect(flowCanvas).toContain('GestureDetector');
    expect(flowCanvas).toContain('Gesture.Pan()');
    expect(flowCanvas).toContain('Gesture.Pinch()');
    expect(flowCanvas).toContain('buildReferralGraphLayout');
    expect(flowCanvas).toContain('getReferralGraphFitViewport');
    expect(flowCanvas).toContain('getReferralGraphNodeScreenRadius');
    expect(flowCanvas).toContain('styles.nodeCircle');
    expect(flowCanvas).toContain('styles.zoomBadge');
    expect(screen).toContain('증원수당 흐름 그래프 화면 맞춤');
    expect(screen).toContain('증원수당 흐름 그래프 초기화');
  });

  it('draws aggregated child-to-parent money movement on top of relationships', () => {
    expect(flowCanvas).toContain('buildSampleRevenueEdgeFlows');
    expect(flowCanvas).toContain('flow.amountKrw > 0');
    expect(flowCanvas).toContain('x1={child.x}');
    expect(flowCanvas).toContain('x2={parent.x}');
    expect(flowCanvas).toContain('getArrowPoints(parent, child, displayScale)');
    expect(flowCanvas).toContain('<Polygon');
    expect(flowCanvas).toContain('formatSampleRevenueFlowKrw(flow.amountKrw)');
    expect(flowCanvas).toContain('buildRevenueFlowLabelLayouts');
    expect(screen).toContain('중심의 나에게 합산됩니다');
    expect(screen).toContain('나에게 이동');
  });

  it('keeps excluded relationships visible without drawing a money flow', () => {
    expect(flowCanvas).toContain(
      'strokeDasharray={flow.amountKrw <= 0 ? "5 5" : undefined}',
    );
    expect(flowCanvas).toContain("if (!node.eligible) return '대상 제외'");
    expect(screen).toContain('대상 제외');
    expect(flowModel).toContain('!contributor.eligible');
  });

  it('shrinks nodes and labels as the user zooms out and caps zoom-in growth', () => {
    expect(flowCanvas).toContain('getNodeVisualScale');
    expect(flowCanvas).toContain('getLabelVisualScale');
    expect(flowCanvas).toContain('NODE_VISUAL_MAX_SCALE = 1.4');
    expect(flowCanvas).toContain('LABEL_VISUAL_MIN_SCALE = 0.42');
    expect(flowCanvas).toContain('scale: getNodeVisualScale(graphScale.value)');
    expect(flowCanvas).toContain('scale: getLabelVisualScale(graphScale.value)');
    expect(flowCanvas).toContain(
      'GRAPH_RENDER_COORDINATE_SCALE / Math.max(graphScale.value, 0.001)',
    );
  });

  it('retains explicit ancestor context for filtered money paths', () => {
    expect(screen).toContain('getSampleRevenueGraphContextNodes');
    expect(screen).toContain('focusedNodeIds={focusedGraphNodeIds}');
    expect(flowCanvas).toContain('const contributorNodeIds = useMemo');
    expect(flowCanvas).toContain('{ contributorNodeIds }');
    expect(flowCanvas).toContain('if (!focused) return null');
  });

  it('keeps graph controls outside the drawable viewport', () => {
    expect(screen).toContain('styles.canvasToolbar');
    expect(screen).toContain('styles.canvasViewport');
    expect(screen).not.toContain("canvasActions: {\n    position: 'absolute'");
  });

  it('highlights the selected path and keeps detail as an accessible modal', () => {
    expect(flowCanvas).toContain('selectedPath.edgeIds.has(flow.id)');
    expect(flowCanvas).toContain('selectedPath.nodeIds.has(node.id)');
    expect(flowCanvas).toContain('accessibilityRole="button"');
    expect(flowCanvas).toContain('accessibilityLabel={`${node.name}');
    expect(screen).toContain('금액 이동 경로 강조 해제');
    expect(detail).toContain('accessibilityViewIsModal');
  });

  it('keeps fit motion short and follows the system reduced-motion setting', () => {
    expect(flowCanvas).toContain('ReduceMotion.System');
    expect(flowCanvas).toContain('withTiming(viewport.scale, timing)');
    expect(flowCanvas).not.toContain('withRepeat');
    expect(flowCanvas).not.toContain('setInterval');
  });

  it('does not retain the retired physics, WebView, or orientation UI path', () => {
    expect(screen).not.toContain('expo-screen-orientation');
    expect(screen).not.toContain('OrientationLock');
    expect(screen).not.toContain('controlsOpen');
    expect(flowCanvas).not.toContain('WebView');
    expect(flowCanvas).not.toContain('stepSampleRevenueInteractivePhysics');
    expect(flowCanvas).not.toContain('beginNodeDrag');
    expect(flowCanvas).not.toContain('물리 반응 중');
  });
});
