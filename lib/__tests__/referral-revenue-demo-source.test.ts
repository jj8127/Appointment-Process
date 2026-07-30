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
  const nativeCanvas = read(
    'components/referral-revenue-graph/ReferralRevenueGraphWebViewCanvas.tsx',
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
    expect(canvas).toContain('styles.nodeCircle');
    expect(canvas).toContain('<AnimatedRevenueEdge');
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
    expect(screen).toContain("goBackOrReplace(router, '/referral')");
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

  it('keeps expensive graph work stable and coalesces drag frames', () => {
    expect(screen).toContain('} = useMemo(() => {');
    expect(screen).toContain('}, [depthFilter]);');
    expect(canvas).toContain('prepareSampleRevenueGraphPhysicsTopology');
    expect(canvas).toContain('topology,');
    expect(canvas).toContain('dragFrameRef');
    expect(canvas).toContain('pendingDragRef');
    expect(canvas).toContain('requestAnimationFrame(() => {');
    expect(canvas).toContain('cancelPendingNodeDrag');
  });

  it('keeps drag and settle frames off the React render path', () => {
    const commitMotion = canvas
      .split('const commitMotion = useCallback')[1]
      .split('const syncRenderPositions = useCallback')[0];
    const updateNodeDrag = canvas
      .split('const updateNodeDrag = useCallback')[1]
      .split('const endNodeDrag = useCallback')[0];

    expect(canvas).not.toContain('setMotion');
    expect(commitMotion).toContain('motionCoordinates.value =');
    expect(commitMotion).not.toContain('setRenderPositions');
    expect(updateNodeDrag).not.toContain('syncRenderPositions');
    expect(canvas).toContain('AnimatedRevenueEdge');
    expect(canvas).toContain('AnimatedRevenueNode');
    expect(canvas).toContain('AnimatedRevenueHitTarget');
    expect(canvas).toContain('x1: coordinates.value[sourceIndex * 2]');
    expect(canvas).toContain('x2: coordinates.value[targetIndex * 2]');
    expect(canvas).toContain('{ translateX: x - radius }');
    expect(canvas).toContain('{ translateY: y - radius }');
    expect(canvas).not.toContain('<SvgText');
    expect(canvas).not.toContain('<AnimatedG');
  });

  it('preserves the exact local node labels through the animated child', () => {
    expect(canvas).toContain("? '기준'");
    expect(canvas).toContain(": '대상 제외'");
    expect(canvas).toContain(": '제외'");
    expect(canvas).toContain('amountLabel={amountLabel}');
    expect(canvas).toContain('nodeAmountLabel={nodeAmountLabel}');
  });

  it('keeps graph labels screen-sized on the UI thread while pinching', () => {
    expect(canvas).toContain('const inverseScaleStyle = useAnimatedStyle');
    expect(canvas).toContain('scale: 1 / Math.max(');
    expect(canvas).toContain('styles.nodeLabelStack');
    expect(canvas).toContain('styles.selectedNodeLabel');
    expect(canvas).not.toContain('SvgText');

    const pinchUpdate = canvas
      .split('const pinchGesture')[1]
      .split('.onUpdate((event) => {')[1]
      .split('.onEnd(() => {')[0];
    expect(pinchUpdate).not.toContain('runOnJS');
    expect(pinchUpdate).not.toContain('setDisplayScale');
  });

  it('uses one native canvas draw loop instead of per-node Android view redraws', () => {
    expect(canvas).toContain("Platform.OS !== 'web'");
    expect(canvas).toContain('ReferralRevenueGraphWebViewCanvas');
    expect(nativeCanvas).toContain("canvas.getContext('2d'");
    expect(nativeCanvas).toContain('requestAnimationFrame(loop)');
    expect(nativeCanvas).toContain('stepPhysics(0.24');
    expect(nativeCanvas).toContain('settleAlpha *= 0.94');
    expect(nativeCanvas).toContain("cacheContext.font = '800 11px");
    expect(nativeCanvas).toContain("cacheContext.font = '800 7px");
    expect(nativeCanvas).toContain('window.ReactNativeWebView?.postMessage');
    expect(nativeCanvas).toContain('androidLayerType="hardware"');
    expect(nativeCanvas).not.toContain('setState(');
    expect(nativeCanvas).toContain('frameRequestId = requestAnimationFrame(loop)');
    expect(nativeCanvas).toContain('if (!runtimeEnabled || frameRequestId != null)');
    expect(nativeCanvas).toContain('setActive: (nextActive) =>');
    expect(nativeCanvas).toContain(
      'window.__revenueGraph?.setActive(${isFocused})',
    );
  });

  it('does not start node physics before drag intent or select a cancelled pointer', () => {
    const pointerDown = nativeCanvas
      .split("canvas.addEventListener('pointerdown'")[1]
      .split("canvas.addEventListener('pointermove'")[0];
    const pointerMove = nativeCanvas
      .split("canvas.addEventListener('pointermove'")[1]
      .split('const finishPointer')[0];
    const finishPointer = nativeCanvas
      .split('const finishPointer')[1]
      .split("canvas.addEventListener('contextmenu'")[0];

    expect(nativeCanvas).toContain('const dragActivationDistance = 6');
    expect(pointerDown).toContain('activePhysics = false');
    expect(pointerDown).not.toContain('activePhysics = true');
    expect(pointerMove).toContain('movedDistance > dragActivationDistance');
    expect(pointerMove).toContain('activePhysics = true');
    expect(finishPointer).toContain('if (!cancelled && !dragMoved)');
    expect(finishPointer).toContain("(event) => finishPointer(event, true)");
    expect(finishPointer).toContain(
      'settleAlpha = !cancelled && dragMoved ? 0.32 : 0',
    );
    expect(finishPointer).toContain('if (!cancelled && dragMoved)');
    expect(finishPointer).toContain(
      'stepPhysics(0.24, releasedDragIndex, pendingDragPosition)',
    );
  });

  it('keeps the local WebView bridge revisioned, selectable, and offline', () => {
    expect(nativeCanvas).toContain('Content-Security-Policy');
    expect(nativeCanvas).toContain("connect-src 'none'");
    expect(nativeCanvas).toContain("navigate-to 'none'");
    expect(nativeCanvas).toContain('bridgeRevision: config.bridgeRevision');
    expect(nativeCanvas).toContain("nativeUrl === 'about:blank'");
    expect(nativeCanvas).toContain("nativeUrl === 'null'");
    expect(nativeCanvas).toContain(
      "message.documentUrl !== 'about:blank'",
    );
    expect(nativeCanvas).toContain('documentUrl: window.location.href');
    expect(nativeCanvas).toContain(
      'message.bridgeRevision !== bridgeRevision',
    );
    expect(nativeCanvas).toContain('&& !node.isViewer');
    expect(nativeCanvas).toContain('focusedNodeIds.has(node.id)');
    expect(nativeCanvas).toContain('setSupportMultipleWindows={false}');
    expect(nativeCanvas).toContain("request.url === 'about:blank'");
    expect(nativeCanvas).toContain("const key = leftId + ':' + rightId");
    expect(nativeCanvas).toContain('(hash >>> 0) / 0xffffffff');
    expect(nativeCanvas).not.toContain('http://');
    expect(nativeCanvas).not.toContain('https://');
  });

  it('passes UI gesture identity into every node-drag callback', () => {
    expect(canvas).toContain('nodeDragGestureSequence.value += 1');
    expect(canvas).toContain('gestureContextToken,');
    expect(canvas).toContain('nodeDragGestureToken.value,');
    expect(canvas).toContain('transitionNodeDragSession');
    expect(canvas).toContain('useIsFocused');
    expect(canvas).toContain('if (!isFocused)');
    expect(canvas).toContain('allocateNodeDragContextToken');
    expect(canvas).not.toContain('gestureContextRef');
    expect(canvas).toContain("type: 'unmount'");
    expect(canvas).toContain("type: 'cancel'");
  });

  it('clears the physics badge on blur without setting state on unmount', () => {
    const lifecycle = canvas
      .split('useLayoutEffect(() => {')[1]
      .split('useEffect(() => {')[0];
    const blurBranch = lifecycle
      .split('if (!isFocused) {')[1]
      .split('return undefined;')[0];
    const unmountCleanup = lifecycle.split('return () => {')[1];

    expect(lifecycle).toContain('topologyRef.current = topology');
    expect(
      canvas.split('useLayoutEffect(() => {')[0],
    ).not.toContain('topologyRef.current = topology');
    expect(blurBranch).toContain('cancelSettle()');
    expect(blurBranch).toContain('cancelPendingNodeDrag()');
    expect(blurBranch).toContain('setPhysicsActive(false)');
    expect(unmountCleanup).not.toContain('setPhysicsActive');
  });

  it('restores portrait whenever the graph route is not focused in graph mode', () => {
    expect(screen).toContain('useFocusEffect');
    expect(screen).toContain('getReferralRevenueDesiredOrientation');
    expect(screen).toContain("orientationCoordinator.request('portrait')");
    expect(screen).toContain('viewMode,');
    expect(screen).toContain('headerBackVisible: false');
    expect(screen).toContain('headerLeft: () =>');
    expect(screen).toContain('onPress={handleBack}');
    expect(screen).not.toContain('let active = true');
  });
});
