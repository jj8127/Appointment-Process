import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');

function read(relativePath: string) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

describe('referral revenue demo screen source contract', () => {
  const screen = read('app/referral-revenue-graph.tsx');
  const canvas = read(
    'components/referral-revenue-graph/ReferralRevenueGraphCanvas.tsx',
  );
  const detail = read(
    'components/referral-revenue-graph/ReferralRevenueDetailSheet.tsx',
  );
  const combined = `${screen}\n${canvas}\n${detail}`;

  it('stays completely local and independent from the real referral graph', () => {
    expect(combined).not.toMatch(/\bfetch\s*\(/);
    expect(combined).not.toMatch(/supabase/i);
    expect(combined).not.toMatch(/useQuery|queryClient|refetch/);
    expect(combined).not.toMatch(/components\/referral-graph/);
    expect(combined).not.toMatch(/use-referral-graph|referral-graph-native/);
  });

  it('shows the exact simulation scope and disclaimers', () => {
    expect(screen).toContain(
      '샘플 범위: viewer 아래 1~10단계 · 각 구성원 샘플 매출의 10%',
    );
    expect(screen).toContain(
      '11단계부터는 대상에서 제외됩니다. 실제 조직·매출·정산 내역이 아닙니다.',
    );
    expect(combined).toContain(
      '샘플 데이터 · 실제 조직, 매출, 정산 내역이 아닙니다. 표시된 하위 구성원의 샘플 매출에 10%를 단순 적용한 화면 예시입니다.',
    );
    expect(screen).toContain('시뮬레이션');
    expect(screen).toContain('샘플');
  });

  it('gates direct entry with the current local session only', () => {
    expect(screen).toContain('useSession');
    expect(screen).toContain('!isRequestBoardDesigner');
    expect(screen).toContain("role === 'fc'");
    expect(screen).toContain("role === 'admin' && readOnly");
  });

  it('provides selected state and accessible touch controls', () => {
    expect(screen).toContain('accessibilityRole="tab"');
    expect(screen).toContain('accessibilityState={{ selected }}');
    expect(screen).toContain('accessibilityRole="button"');
    expect(screen).toContain('TOUCH_TARGET.min');
    expect(canvas).toContain('accessibilityLabel');
    expect(detail).toContain('accessibilityViewIsModal');
  });

  it('labels depth and excluded nodes without relying on color', () => {
    expect(combined).toContain('{node.depth}단계');
    expect(combined).toContain('대상 제외');
    expect(canvas).toContain("strokeDasharray={excluded ? '5 5' : undefined}");
    expect(screen).toContain('돈의 이동을 의미하지 않습니다');
  });

  it('keeps filtered graph nodes connected through explicit ancestor context', () => {
    expect(screen).toContain('getSampleRevenueGraphContextNodes');
    expect(screen).toContain('focusedNodeIds={focusedGraphNodeIds}');
    expect(combined).toContain('연결 경로');
    expect(canvas).not.toMatch(
      /isContext\s*\?\s*['"](?:연결 경로|경로)['"]/u,
    );
  });

  it('renders a referral-graph-style interactive node-edge network', () => {
    expect(canvas).toContain('GestureDetector');
    expect(canvas).toContain('Gesture.Pan()');
    expect(canvas).toContain('Gesture.Pinch()');
    expect(canvas).toContain('<Circle');
    expect(canvas).toContain('<Line');
    expect(canvas).toContain('buildSampleRevenueGraphLayout');
    expect(canvas).toContain('formatSampleRevenueNodeAmount');
    expect(canvas).toContain('stepSampleRevenueInteractivePhysics');
    expect(canvas).toContain('beginNodeDrag');
    expect(canvas).toContain('updateNodeDrag');
    expect(canvas).toContain('endNodeDrag');
    expect(canvas).toContain('물리 반응 중');
    expect(canvas).toContain('{physicsActive && (');
    expect(canvas).toContain('{zoomVisible && (');
    expect(canvas).toContain('setTimeout(() =>');
    expect(canvas).toContain('getSampleRevenueGraphFitViewport');
    expect(canvas).toContain('zoomBadge');
    expect(canvas).not.toContain('<ScrollView');
    expect(canvas).not.toContain('NODE_WIDTH');
    expect(screen).toContain('매출 기여 그래프 화면 맞춤');
    expect(screen).toContain('매출 기여 그래프 초기화');
    expect(screen).toContain('headerShown: false');
    expect(canvas).toContain('노드는 끌어서 움직이며');
    expect(screen).toContain('useWindowDimensions');
    expect(screen).toContain('OrientationLock.LANDSCAPE');
    expect(screen).toContain('OrientationLock.PORTRAIT_UP');
    expect(screen).toContain('const [controlsOpen, setControlsOpen] = useState(false)');
    expect(screen).toContain("'그래프 설정 열기'");
    expect(screen).toContain('필터 적용 중');
    expect(screen).toContain('accessibilityState={{ expanded: controlsOpen }}');
    expect(screen).toContain('accessibilityViewIsModal');
    expect(screen).toContain('settingsPanelLandscape');
    expect(screen).toContain('대상 샘플 매출');
    expect(screen).toContain('model.summary.eligibleSalesKrw');
    expect(screen).toContain("{'\\n'}{DISCLAIMER}");
    expect(screen).toContain('COMPACT_LANDSCAPE_FIT_INSETS');
    expect(screen).toContain('left: 16');
    expect(screen).not.toContain('immersiveBottomHudLandscape');
    expect(screen).not.toContain('left: 292');
  });
});
