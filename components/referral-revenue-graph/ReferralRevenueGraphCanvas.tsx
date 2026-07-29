import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, G, Line, Text as SvgText } from 'react-native-svg';

import {
  buildSampleRevenueGraphLayout,
  formatCompactSampleRevenueKrw,
  formatSampleRevenueNodeAmount,
  getSampleRevenueGraphFitViewport,
  getSampleRevenueGraphNodeColor,
  getSampleRevenueGraphNodeRadius,
  getSampleRevenueGraphNodeStatusLabel,
  SAMPLE_REVENUE_GRAPH_MAX_SCALE,
  SAMPLE_REVENUE_GRAPH_MIN_SCALE,
  SAMPLE_REVENUE_GRAPH_SURFACE_SIZE,
  stepSampleRevenueInteractivePhysics,
} from '@/lib/referral-revenue-graph-native';
import type { SampleRevenueGraphMotionPoint } from '@/lib/referral-revenue-graph-native';
import type {
  SampleRevenueGraphEdge,
  SampleRevenueGraphNode,
} from '@/types/referral-revenue-graph';

type Props = {
  nodes: SampleRevenueGraphNode[];
  edges: SampleRevenueGraphEdge[];
  focusedNodeIds?: ReadonlySet<string>;
  selectedNodeId: string | null;
  onSelectNode: (node: SampleRevenueGraphNode) => void;
  fitRequestId: number;
  resetRequestId: number;
  fitInsets?: {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
  overlayBottomInset?: number;
};

const clampScale = (value: number) => {
  'worklet';
  return Math.min(
    Math.max(value, SAMPLE_REVENUE_GRAPH_MIN_SCALE),
    SAMPLE_REVENUE_GRAPH_MAX_SCALE,
  );
};

const getCompactNodeLabel = (node: SampleRevenueGraphNode) => {
  if (node.isViewer) return '나';
  const withoutSamplePrefix = node.name.replace(/^샘플\s+/u, '').trim();
  if (withoutSamplePrefix.length <= 3) return withoutSamplePrefix;
  return `${withoutSamplePrefix.slice(0, 2)}…`;
};

const createMotionLayout = (
  positions: ReadonlyMap<string, { x: number; y: number }>,
) => new Map<string, SampleRevenueGraphMotionPoint>(
  Array.from(positions, ([id, point]) => [
    id,
    { x: point.x, y: point.y, vx: 0, vy: 0 },
  ]),
);

export function ReferralRevenueGraphCanvas({
  nodes,
  edges,
  focusedNodeIds,
  selectedNodeId,
  onSelectNode,
  fitRequestId,
  resetRequestId,
  fitInsets,
  overlayBottomInset = 12,
}: Props) {
  const initialPositions = useMemo(
    () => buildSampleRevenueGraphLayout(nodes, edges),
    [edges, nodes],
  );
  const orderedNodes = useMemo(
    () => [...nodes].sort((left, right) => left.id.localeCompare(right.id)),
    [nodes],
  );
  const [motion, setMotion] = useState<
    Map<string, SampleRevenueGraphMotionPoint>
  >(() => createMotionLayout(initialPositions));
  const motionRef = useRef(motion);
  const settleFrameRef = useRef<number | null>(null);
  const zoomTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [physicsActive, setPhysicsActive] = useState(false);
  const [zoomVisible, setZoomVisible] = useState(false);
  const positions = useMemo(
    () => new Map(
      Array.from(motion, ([id, point]) => [
        id,
        { x: point.x, y: point.y },
      ]),
    ),
    [motion],
  );
  const positionsRef = useRef(positions);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [displayScale, setDisplayScale] = useState(1);
  const scale = useSharedValue(1);
  const baseScale = useSharedValue(1);
  const panX = useSharedValue(0);
  const panY = useSharedValue(0);
  const startPanX = useSharedValue(0);
  const startPanY = useSharedValue(0);
  const pinchStartPanX = useSharedValue(0);
  const pinchStartPanY = useSharedValue(0);
  const draggedNodeIndex = useSharedValue(-1);
  const motionCoordinates = useSharedValue<number[]>([]);

  const revealZoom = useCallback((nextScale: number) => {
    setDisplayScale(nextScale);
    setZoomVisible(true);
    if (zoomTimerRef.current != null) {
      clearTimeout(zoomTimerRef.current);
    }
    zoomTimerRef.current = setTimeout(() => {
      zoomTimerRef.current = null;
      setZoomVisible(false);
    }, 1400);
  }, []);

  const applyFit = useCallback((animated: boolean) => {
    if (canvasSize.width <= 0 || canvasSize.height <= 0) return;
    const viewport = getSampleRevenueGraphFitViewport({
      nodes,
      positions: positionsRef.current,
      width: canvasSize.width,
      height: canvasSize.height,
      insets: fitInsets,
    });

    scale.value = animated
      ? withTiming(viewport.scale, { duration: 220 })
      : viewport.scale;
    panX.value = animated
      ? withTiming(viewport.panX, { duration: 220 })
      : viewport.panX;
    panY.value = animated
      ? withTiming(viewport.panY, { duration: 220 })
      : viewport.panY;
    baseScale.value = viewport.scale;
    revealZoom(viewport.scale);
  }, [
    baseScale,
    canvasSize.height,
    canvasSize.width,
    fitInsets,
    nodes,
    panX,
    panY,
    revealZoom,
    scale,
  ]);

  const cancelSettle = useCallback(() => {
    if (settleFrameRef.current != null) {
      cancelAnimationFrame(settleFrameRef.current);
      settleFrameRef.current = null;
    }
  }, []);

  const commitMotion = useCallback((
    next: Map<string, SampleRevenueGraphMotionPoint>,
  ) => {
    motionRef.current = next;
    positionsRef.current = new Map(
      Array.from(next, ([id, point]) => [
        id,
        { x: point.x, y: point.y },
      ]),
    );
    motionCoordinates.value = orderedNodes.flatMap((node) => {
      const point = next.get(node.id);
      return point ? [point.x, point.y] : [0, 0];
    });
    setMotion(next);
  }, [motionCoordinates, orderedNodes]);

  useEffect(() => {
    cancelSettle();
    const next = createMotionLayout(initialPositions);
    commitMotion(next);
    setPhysicsActive(false);
  }, [
    cancelSettle,
    commitMotion,
    initialPositions,
    resetRequestId,
  ]);

  useEffect(() => {
    applyFit(fitRequestId > 0 || resetRequestId > 0);
  }, [
    applyFit,
    fitRequestId,
    initialPositions,
    resetRequestId,
  ]);

  useEffect(() => () => {
    cancelSettle();
    if (zoomTimerRef.current != null) {
      clearTimeout(zoomTimerRef.current);
    }
  }, [cancelSettle]);

  const beginNodeDrag = useCallback(() => {
    cancelSettle();
    setPhysicsActive(true);
  }, [cancelSettle]);

  const updateNodeDrag = useCallback((
    nodeIndex: number,
    x: number,
    y: number,
  ) => {
    const node = orderedNodes[nodeIndex];
    if (!node) return;
    const next = stepSampleRevenueInteractivePhysics({
      nodes,
      edges,
      motion: motionRef.current,
      alpha: 0.24,
      ticks: 2,
      fixedNodeId: node.id,
      fixedPosition: {
        x: Math.min(Math.max(x, 70), SAMPLE_REVENUE_GRAPH_SURFACE_SIZE - 70),
        y: Math.min(Math.max(y, 70), SAMPLE_REVENUE_GRAPH_SURFACE_SIZE - 70),
      },
    });
    commitMotion(next);
  }, [commitMotion, edges, nodes, orderedNodes]);

  const endNodeDrag = useCallback(() => {
    cancelSettle();
    let alpha = 0.32;
    setPhysicsActive(true);
    const settle = () => {
      alpha *= 0.94;
      const next = stepSampleRevenueInteractivePhysics({
        nodes,
        edges,
        motion: motionRef.current,
        alpha,
        ticks: 1,
      });
      commitMotion(next);
      if (alpha > 0.014) {
        settleFrameRef.current = requestAnimationFrame(settle);
      } else {
        settleFrameRef.current = null;
        setPhysicsActive(false);
      }
    };
    settleFrameRef.current = requestAnimationFrame(settle);
  }, [cancelSettle, commitMotion, edges, nodes]);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setCanvasSize({
      width: Math.max(1, width),
      height: Math.max(1, height),
    });
  }, []);

  const panGesture = useMemo(
    () => Gesture.Pan()
      .maxPointers(1)
      .minDistance(4)
      .onStart((event) => {
        startPanX.value = panX.value;
        startPanY.value = panY.value;
        const currentScale = Math.max(
          scale.value,
          SAMPLE_REVENUE_GRAPH_MIN_SCALE,
        );
        const graphX = SAMPLE_REVENUE_GRAPH_SURFACE_SIZE / 2
          + (
            event.x
            - canvasSize.width / 2
            - panX.value
          ) / currentScale;
        const graphY = SAMPLE_REVENUE_GRAPH_SURFACE_SIZE / 2
          + (
            event.y
            - canvasSize.height / 2
            - panY.value
          ) / currentScale;
        const coordinates = motionCoordinates.value;
        const hitRadius = 30 / currentScale;
        let nearestIndex = -1;
        let nearestDistance = Number.POSITIVE_INFINITY;
        for (
          let index = 0;
          index < coordinates.length / 2;
          index += 1
        ) {
          const dx = coordinates[index * 2] - graphX;
          const dy = coordinates[index * 2 + 1] - graphY;
          const distance = Math.hypot(dx, dy);
          if (distance <= hitRadius && distance < nearestDistance) {
            nearestDistance = distance;
            nearestIndex = index;
          }
        }
        draggedNodeIndex.value = nearestIndex;
        if (nearestIndex >= 0) {
          runOnJS(beginNodeDrag)();
        }
      })
      .onUpdate((event) => {
        if (draggedNodeIndex.value >= 0) {
          const currentScale = Math.max(
            scale.value,
            SAMPLE_REVENUE_GRAPH_MIN_SCALE,
          );
          const graphX = SAMPLE_REVENUE_GRAPH_SURFACE_SIZE / 2
            + (
              event.x
              - canvasSize.width / 2
              - panX.value
            ) / currentScale;
          const graphY = SAMPLE_REVENUE_GRAPH_SURFACE_SIZE / 2
            + (
              event.y
              - canvasSize.height / 2
              - panY.value
            ) / currentScale;
          runOnJS(updateNodeDrag)(
            draggedNodeIndex.value,
            graphX,
            graphY,
          );
          return;
        }
        panX.value = startPanX.value + event.translationX;
        panY.value = startPanY.value + event.translationY;
      })
      .onFinalize(() => {
        if (draggedNodeIndex.value >= 0) {
          runOnJS(endNodeDrag)();
        }
        draggedNodeIndex.value = -1;
      }),
    [
      beginNodeDrag,
      canvasSize.height,
      canvasSize.width,
      draggedNodeIndex,
      endNodeDrag,
      motionCoordinates,
      panX,
      panY,
      scale,
      startPanX,
      startPanY,
      updateNodeDrag,
    ],
  );

  const pinchGesture = useMemo(
    () => Gesture.Pinch()
      .onStart(() => {
        baseScale.value = scale.value;
        pinchStartPanX.value = panX.value;
        pinchStartPanY.value = panY.value;
      })
      .onUpdate((event) => {
        const nextScale = clampScale(baseScale.value * event.scale);
        const ratio = nextScale / Math.max(baseScale.value, 0.001);
        const focalOffsetX = event.focalX - canvasSize.width / 2;
        const focalOffsetY = event.focalY - canvasSize.height / 2;

        scale.value = nextScale;
        panX.value = focalOffsetX
          - ratio * (focalOffsetX - pinchStartPanX.value);
        panY.value = focalOffsetY
          - ratio * (focalOffsetY - pinchStartPanY.value);
      })
      .onEnd(() => {
        baseScale.value = scale.value;
        runOnJS(revealZoom)(scale.value);
      }),
    [
      baseScale,
      canvasSize.height,
      canvasSize.width,
      panX,
      panY,
      pinchStartPanX,
      pinchStartPanY,
      revealZoom,
      scale,
    ],
  );

  const graphGesture = useMemo(
    () => Gesture.Simultaneous(panGesture, pinchGesture),
    [panGesture, pinchGesture],
  );

  const animatedSurfaceStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: panX.value },
      { translateY: panY.value },
      { scale: scale.value },
    ],
  }));

  const visibleNodeIds = useMemo(
    () => new Set(nodes.map((node) => node.id)),
    [nodes],
  );
  const visibleEdges = useMemo(
    () => edges.filter(
      (edge) => (
        visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
      ),
    ),
    [edges, visibleNodeIds],
  );
  const safeScale = Math.max(displayScale, SAMPLE_REVENUE_GRAPH_MIN_SCALE);
  const minimumScreenRadius = 14 / safeScale;
  const hitTargetSize = 48 / safeScale;
  const labelFontSize = Math.min(38, 11 / safeScale);
  const amountFontSize = Math.min(32, 9 / safeScale);
  const centerFontSize = Math.min(38, 11 / safeScale);
  const nodeAmountFontSize = Math.min(26, 7 / safeScale);
  const nodeById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );

  return (
    <GestureDetector gesture={graphGesture}>
      <View
        style={styles.canvas}
        onLayout={handleLayout}
        accessibilityLabel="샘플 매출 기여 노드 엣지 그래프. 빈 공간은 한 손가락으로 이동하고, 노드는 끌어서 움직이며, 두 손가락으로 확대하거나 축소할 수 있습니다."
      >
        <View pointerEvents="none" style={styles.grid} />
        <Animated.View
          style={[
            styles.surface,
            {
              left: (canvasSize.width - SAMPLE_REVENUE_GRAPH_SURFACE_SIZE) / 2,
              top: (canvasSize.height - SAMPLE_REVENUE_GRAPH_SURFACE_SIZE) / 2,
            },
            animatedSurfaceStyle,
          ]}
        >
          <Svg
            width={SAMPLE_REVENUE_GRAPH_SURFACE_SIZE}
            height={SAMPLE_REVENUE_GRAPH_SURFACE_SIZE}
            viewBox={`0 0 ${SAMPLE_REVENUE_GRAPH_SURFACE_SIZE} ${SAMPLE_REVENUE_GRAPH_SURFACE_SIZE}`}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <G>
              {visibleEdges.map((edge) => {
                const source = positions.get(edge.source);
                const target = positions.get(edge.target);
                const targetNode = nodeById.get(edge.target);
                if (!source || !target || !targetNode) return null;
                const excluded = !targetNode.eligible && !targetNode.isViewer;
                const context = Boolean(
                  focusedNodeIds && !focusedNodeIds.has(edge.target),
                );

                return (
                  <Line
                    key={edge.id}
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                    stroke={excluded || context ? '#cbd5e1' : '#fdba74'}
                    strokeWidth={Math.max(1.5, 1.35 / safeScale)}
                    strokeLinecap="round"
                    strokeDasharray={excluded ? '5 5' : undefined}
                  />
                );
              })}
            </G>

            <G>
              {nodes.map((node) => {
                const point = positions.get(node.id);
                if (!point) return null;
                const isContext = Boolean(
                  focusedNodeIds && !focusedNodeIds.has(node.id),
                );
                const radius = Math.max(
                  getSampleRevenueGraphNodeRadius(node),
                  minimumScreenRadius,
                );
                const selected = node.id === selectedNodeId;
                const amountLabel = node.isViewer
                  ? '기준'
                  : node.eligible
                    ? formatCompactSampleRevenueKrw(
                      node.expectedAllocationKrw,
                    )
                    : '대상 제외';
                const nodeAmountLabel = node.isViewer
                  ? '기준'
                  : node.eligible
                    ? formatSampleRevenueNodeAmount(
                      node.expectedAllocationKrw,
                    )
                    : '제외';

                return (
                  <G key={node.id}>
                    {selected ? (
                      <Circle
                        cx={point.x}
                        cy={point.y}
                        r={radius + 7 / safeScale}
                        fill="none"
                        stroke="#2563eb"
                        strokeWidth={3 / safeScale}
                      />
                    ) : null}
                    <Circle
                      cx={point.x}
                      cy={point.y}
                      r={radius}
                      fill={getSampleRevenueGraphNodeColor(node, isContext)}
                      stroke="#ffffff"
                      strokeWidth={2.4 / safeScale}
                      strokeDasharray={
                        !node.eligible && !node.isViewer ? '5 5' : undefined
                      }
                    />
                    <SvgText
                      x={point.x}
                      y={point.y - centerFontSize * 0.08}
                      fill={isContext ? '#475569' : '#ffffff'}
                      fontSize={centerFontSize}
                      fontWeight="800"
                      textAnchor="middle"
                    >
                      {getCompactNodeLabel(node)}
                    </SvgText>
                    <SvgText
                      x={point.x}
                      y={point.y + centerFontSize * 0.82}
                      fill={isContext ? '#475569' : '#ffffff'}
                      fontSize={nodeAmountFontSize}
                      fontWeight="800"
                      textAnchor="middle"
                    >
                      {nodeAmountLabel}
                    </SvgText>
                    {selected ? (
                      <>
                        <SvgText
                          x={point.x}
                          y={point.y + radius + labelFontSize + 5}
                          fill="#334155"
                          fontSize={labelFontSize}
                          fontWeight="800"
                          textAnchor="middle"
                        >
                          {node.name}
                        </SvgText>
                        <SvgText
                          x={point.x}
                          y={
                            point.y
                            + radius
                            + labelFontSize
                            + amountFontSize
                            + 9
                          }
                          fill={
                            node.eligible && !isContext
                              ? '#c2410c'
                              : '#64748b'
                          }
                          fontSize={amountFontSize}
                          fontWeight="700"
                          textAnchor="middle"
                        >
                          {amountLabel}
                        </SvgText>
                      </>
                    ) : null}
                  </G>
                );
              })}
            </G>
          </Svg>

          {nodes.map((node) => {
            const point = positions.get(node.id);
            if (!point) return null;
            const isContext = Boolean(
              focusedNodeIds && !focusedNodeIds.has(node.id),
            );
            const selectable = !node.isViewer && !isContext;
            if (!selectable) return null;

            return (
              <Pressable
                key={`hit-${node.id}`}
                style={({ pressed }) => [
                  styles.nodeHitTarget,
                  {
                    width: hitTargetSize,
                    height: hitTargetSize,
                    borderRadius: hitTargetSize / 2,
                    left: point.x - hitTargetSize / 2,
                    top: point.y - hitTargetSize / 2,
                  },
                  pressed && styles.nodeHitTargetPressed,
                ]}
                onPress={() => onSelectNode(node)}
                accessibilityRole="button"
                accessibilityLabel={`${node.name}, ${node.depth}단계, ${getSampleRevenueGraphNodeStatusLabel(node)}`}
                accessibilityHint="두 번 탭하면 샘플 매출과 예상 배분 상세를 엽니다."
              >
                <Text style={styles.hiddenNodeLabel}>{node.name}</Text>
              </Pressable>
            );
          })}
        </Animated.View>

        {zoomVisible && (
          <View
            pointerEvents="none"
            style={[styles.zoomBadge, { bottom: overlayBottomInset }]}
          >
            <Text style={styles.zoomBadgeText}>
              {Math.round(displayScale * 100)}%
            </Text>
          </View>
        )}
        {physicsActive && (
          <View
            pointerEvents="none"
            style={[
              styles.physicsBadge,
              styles.physicsBadgeActive,
              { bottom: overlayBottomInset },
            ]}
          >
            <View style={[styles.physicsDot, styles.physicsDotActive]} />
            <Text style={[
              styles.physicsBadgeText,
              styles.physicsBadgeTextActive,
            ]}>
              물리 반응 중
            </Text>
          </View>
        )}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  canvas: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: '#fffaf5',
  },
  grid: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.55,
    borderWidth: 1,
    borderColor: '#ffedd5',
    backgroundColor: '#fffaf5',
  },
  surface: {
    position: 'absolute',
    width: SAMPLE_REVENUE_GRAPH_SURFACE_SIZE,
    height: SAMPLE_REVENUE_GRAPH_SURFACE_SIZE,
  },
  nodeHitTarget: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  nodeHitTargetPressed: {
    backgroundColor: 'rgba(249, 115, 22, 0.16)',
  },
  hiddenNodeLabel: {
    width: 1,
    height: 1,
    opacity: 0,
  },
  zoomBadge: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(124, 45, 18, 0.78)',
  },
  zoomBadgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  physicsBadge: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  physicsBadgeActive: {
    backgroundColor: 'rgba(124,45,18,0.88)',
  },
  physicsDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#f97316',
  },
  physicsDotActive: {
    backgroundColor: '#fde68a',
  },
  physicsBadgeText: {
    color: '#9a3412',
    fontSize: 10,
    fontWeight: '800',
  },
  physicsBadgeTextActive: {
    color: '#ffffff',
  },
});
