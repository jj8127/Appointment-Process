import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  LayoutChangeEvent,
  PixelRatio,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  ReduceMotion,
  type SharedValue,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { G, Line, Polygon } from 'react-native-svg';

import {
  buildReferralGraphLayout,
  getReferralGraphFitViewport,
  getReferralGraphNodeScreenRadius,
  getReferralGraphRenderSurfaceSize,
  REFERRAL_GRAPH_MAX_SCALE,
  REFERRAL_GRAPH_MIN_SCALE,
  REFERRAL_GRAPH_SURFACE_SIZE,
  REFERRAL_GRAPH_SURFACE_CENTER,
} from '@/lib/referral-graph-native';
import {
  buildSampleRevenueEdgeFlows,
  formatSampleRevenueFlowKrw,
  getSampleRevenueDescendantCounts,
  type SampleRevenueEdgeFlow,
} from '@/lib/referral-revenue-flow';
import {
  buildRevenueFlowLabelLayouts,
  REVENUE_FLOW_LABEL_HEIGHT,
  REVENUE_FLOW_LABEL_WIDTH,
  REVENUE_NODE_CAPTION_HEIGHT,
  REVENUE_NODE_CAPTION_WIDTH,
  revenueFlowScreenRectFitsViewport,
} from '@/lib/referral-revenue-flow-layout';
import type {
  SampleRevenueGraphEdge,
  SampleRevenueGraphNode,
} from '@/types/referral-revenue-graph';
import type {
  ReferralGraphNode,
  ReferralGraphPoint,
} from '@/types/referral-graph';

type Props = {
  nodes: SampleRevenueGraphNode[];
  edges: SampleRevenueGraphEdge[];
  expectedTotalKrw: number;
  focusedNodeIds?: ReadonlySet<string>;
  selectedNodeId: string | null;
  onSelectNode: (node: SampleRevenueGraphNode) => void;
  fitRequestId: number;
  resetRequestId: number;
};

const GRAPH_RENDER_SURFACE_SIZE = getReferralGraphRenderSurfaceSize(PixelRatio.get());
const GRAPH_RENDER_COORDINATE_SCALE = (
  GRAPH_RENDER_SURFACE_SIZE / REFERRAL_GRAPH_SURFACE_SIZE
);
const NODE_HIT_TARGET_SIZE = 48;
const NODE_CAPTION_GAP = 5;
const NODE_SELECTED_RING_GAP = 7;
const NODE_VISUAL_MAX_SCALE = 1.4;
const LABEL_VISUAL_MIN_SCALE = 0.42;
const LABEL_VISUAL_MAX_SCALE = 1;
const DEFAULT_GRAPH_SCALE = 0.78;
const DEFAULT_FOCUSED_GRAPH_SCALE = 0.84;
const DEFAULT_FOCUS_CONTEXT_BIAS = 22;
const VIEWPORT_CONTENT_INSET = 6;
const FLOW_COLOR = '#ea580c';
const FLOW_COLOR_SOFT = '#fb923c';

const getNodeVisualScale = (graphScale: number) => {
  'worklet';
  return Math.min(
    Math.max(graphScale, REFERRAL_GRAPH_MIN_SCALE),
    NODE_VISUAL_MAX_SCALE,
  );
};

const getLabelVisualScale = (graphScale: number) => {
  'worklet';
  return Math.min(
    Math.max(graphScale, LABEL_VISUAL_MIN_SCALE),
    LABEL_VISUAL_MAX_SCALE,
  );
};

const getRevenueNodeColor = (node: SampleRevenueGraphNode) => {
  if (node.isViewer) return '#facc15';
  if (node.eligible) return '#f97316';
  return '#94a3b8';
};

const getCompactNodeName = (node: SampleRevenueGraphNode) => {
  if (node.isViewer) return '나';
  const name = node.name.replace(/^샘플\s+/u, '').trim();
  return name.length > 9 ? `${name.slice(0, 9)}…` : name;
};

const getNodeAmountLabel = (
  node: SampleRevenueGraphNode,
  expectedTotalKrw: number,
  focused: boolean,
) => {
  if (node.isViewer) {
    return `합계 ${formatSampleRevenueFlowKrw(expectedTotalKrw)}`;
  }
  if (!node.eligible) return '대상 제외';
  if (!focused) return null;
  return `+${formatSampleRevenueFlowKrw(node.expectedAllocationKrw)}`;
};

type NodeLayerProps = {
  node: SampleRevenueGraphNode;
  point: ReferralGraphPoint;
  descendantCount: number;
  graphScale: SharedValue<number>;
  focused: boolean;
  onPath: boolean;
};

type NodeMarkerProps = NodeLayerProps & {
  selected: boolean;
  onSelectNode: (node: SampleRevenueGraphNode) => void;
};

const RevenueFlowNodeMarker = memo(function RevenueFlowNodeMarker({
  node,
  point,
  descendantCount,
  graphScale,
  focused,
  onPath,
  selected,
  onSelectNode,
}: NodeMarkerProps) {
  const screenRadius = getReferralGraphNodeScreenRadius(descendantCount);
  const nodeDiameter = screenRadius * 2;
  const selectedRingDiameter = (screenRadius + NODE_SELECTED_RING_GAP) * 2;
  const inverseScaleStyle = useAnimatedStyle(() => ({
    transform: [{
      scale: GRAPH_RENDER_COORDINATE_SCALE / Math.max(graphScale.value, 0.001),
    }],
  }));
  const visualScaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: getNodeVisualScale(graphScale.value) }],
  }));
  const accessibilityAmount = node.isViewer
    ? '금액 흐름 도착 지점'
    : node.eligible
      ? `예상 배분액 ${node.expectedAllocationKrw.toLocaleString('ko-KR')}원`
      : '배분 대상 제외';

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.nodeAnchor,
        {
          left: point.x * GRAPH_RENDER_COORDINATE_SCALE - NODE_HIT_TARGET_SIZE / 2,
          top: point.y * GRAPH_RENDER_COORDINATE_SCALE - NODE_HIT_TARGET_SIZE / 2,
        },
        inverseScaleStyle,
      ]}
    >
      <Pressable
        style={({ pressed }) => [
          styles.nodeHitTarget,
          pressed && styles.nodeHitTargetPressed,
        ]}
        onPress={() => onSelectNode(node)}
        accessibilityRole="button"
        accessibilityLabel={`${node.name}, ${node.depth}단계, ${accessibilityAmount}`}
        accessibilityHint="두 번 탭하면 금액 흐름 상세 정보를 엽니다."
      >
        <Animated.View
          pointerEvents="none"
          style={[
            styles.nodeVisual,
            { opacity: focused || onPath ? 1 : 0.36 },
            visualScaleStyle,
          ]}
        >
          {selected ? (
            <View
              style={[
                styles.selectedNodeRing,
                {
                  width: selectedRingDiameter,
                  height: selectedRingDiameter,
                  borderRadius: selectedRingDiameter / 2,
                  left: (NODE_HIT_TARGET_SIZE - selectedRingDiameter) / 2,
                  top: (NODE_HIT_TARGET_SIZE - selectedRingDiameter) / 2,
                },
              ]}
            />
          ) : null}
          <View
            style={[
              styles.nodeCircle,
              {
                width: nodeDiameter,
                height: nodeDiameter,
                borderRadius: nodeDiameter / 2,
                left: (NODE_HIT_TARGET_SIZE - nodeDiameter) / 2,
                top: (NODE_HIT_TARGET_SIZE - nodeDiameter) / 2,
                backgroundColor: getRevenueNodeColor(node),
              },
            ]}
          />
          <Text
            accessible={false}
            numberOfLines={1}
            ellipsizeMode="tail"
            style={[
              styles.nodeInsideName,
              {
                width: Math.max(20, nodeDiameter - 4),
                left: (NODE_HIT_TARGET_SIZE - Math.max(20, nodeDiameter - 4)) / 2,
              },
              node.isViewer && styles.viewerInsideName,
              selected && styles.selectedInsideName,
            ]}
          >
            {getCompactNodeName(node)}
          </Text>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
});

type NodeCaptionProps = NodeLayerProps & {
  expectedTotalKrw: number;
};

const RevenueFlowNodeCaption = memo(function RevenueFlowNodeCaption({
  node,
  point,
  descendantCount,
  graphScale,
  focused,
  onPath,
  expectedTotalKrw,
}: NodeCaptionProps) {
  const screenRadius = getReferralGraphNodeScreenRadius(descendantCount);
  const inverseScaleStyle = useAnimatedStyle(() => ({
    transform: [{
      scale: GRAPH_RENDER_COORDINATE_SCALE / Math.max(graphScale.value, 0.001),
    }],
  }));
  const labelPositionStyle = useAnimatedStyle(() => ({
    transform: [{
      translateY: screenRadius * getNodeVisualScale(graphScale.value)
        + NODE_CAPTION_GAP,
    }],
  }));
  const labelVisualScaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: getLabelVisualScale(graphScale.value) }],
  }));
  const amountLabel = getNodeAmountLabel(node, expectedTotalKrw, focused);
  if (amountLabel === null) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.nodeCaptionAnchor,
        {
          left: point.x * GRAPH_RENDER_COORDINATE_SCALE - NODE_HIT_TARGET_SIZE / 2,
          top: point.y * GRAPH_RENDER_COORDINATE_SCALE - NODE_HIT_TARGET_SIZE / 2,
        },
        { opacity: focused || onPath ? 1 : 0.34 },
        inverseScaleStyle,
      ]}
    >
      <Animated.View style={[styles.nodeCaptionStack, labelPositionStyle]}>
        <Animated.View style={[styles.nodeCaptionContent, labelVisualScaleStyle]}>
          <View style={[
            styles.nodeAmountPill,
            node.isViewer && styles.viewerAmountPill,
            !node.eligible && !node.isViewer && styles.excludedAmountPill,
          ]}>
            <Text
              accessible={false}
              numberOfLines={1}
              style={[
                styles.nodeAmountText,
                node.isViewer && styles.viewerAmountText,
                !node.eligible && !node.isViewer && styles.excludedAmountText,
              ]}
            >
              {amountLabel}
            </Text>
          </View>
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
});

type FlowLabelProps = {
  flow: SampleRevenueEdgeFlow;
  point: ReferralGraphPoint;
  graphScale: SharedValue<number>;
  highlighted: boolean;
};

const RevenueFlowEdgeLabel = memo(function RevenueFlowEdgeLabel({
  flow,
  point,
  graphScale,
  highlighted,
}: FlowLabelProps) {
  const inverseScaleStyle = useAnimatedStyle(() => ({
    transform: [{
      scale: GRAPH_RENDER_COORDINATE_SCALE / Math.max(graphScale.value, 0.001),
    }],
  }));
  const visualScaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: getLabelVisualScale(graphScale.value) }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.flowLabelAnchor,
        {
          left: point.x * GRAPH_RENDER_COORDINATE_SCALE
            - REVENUE_FLOW_LABEL_WIDTH / 2,
          top: point.y * GRAPH_RENDER_COORDINATE_SCALE
            - REVENUE_FLOW_LABEL_HEIGHT / 2,
        },
        inverseScaleStyle,
      ]}
    >
      <Animated.View
        style={[
          styles.flowLabel,
          highlighted && styles.flowLabelHighlighted,
          visualScaleStyle,
        ]}
      >
        <Text accessible={false} numberOfLines={1} style={styles.flowLabelText}>
          {formatSampleRevenueFlowKrw(flow.amountKrw)}
        </Text>
      </Animated.View>
    </Animated.View>
  );
});

const clampScale = (value: number) => {
  'worklet';
  return Math.min(
    Math.max(value, REFERRAL_GRAPH_MIN_SCALE),
    REFERRAL_GRAPH_MAX_SCALE,
  );
};

const getArrowPoints = (
  parent: ReferralGraphPoint,
  child: ReferralGraphPoint,
  scale: number,
) => {
  const dx = parent.x - child.x;
  const dy = parent.y - child.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const unitX = dx / distance;
  const unitY = dy / distance;
  const progress = 0.7;
  const tipX = child.x + dx * progress;
  const tipY = child.y + dy * progress;
  const arrowSize = 7 / Math.max(scale, REFERRAL_GRAPH_MIN_SCALE);
  const baseX = tipX - unitX * arrowSize;
  const baseY = tipY - unitY * arrowSize;
  const wing = arrowSize * 0.56;
  const perpendicularX = -unitY;
  const perpendicularY = unitX;

  return [
    `${tipX},${tipY}`,
    `${baseX + perpendicularX * wing},${baseY + perpendicularY * wing}`,
    `${baseX - perpendicularX * wing},${baseY - perpendicularY * wing}`,
  ].join(' ');
};

export function ReferralRevenueFlowCanvas({
  nodes,
  edges,
  expectedTotalKrw,
  focusedNodeIds,
  selectedNodeId,
  onSelectNode,
  fitRequestId,
  resetRequestId,
}: Props) {
  const descendantCounts = useMemo(
    () => getSampleRevenueDescendantCounts(nodes),
    [nodes],
  );
  const layoutNodes = useMemo<ReferralGraphNode[]>(() => nodes.map((node) => ({
    id: node.id,
    name: node.name,
    affiliation: node.affiliation,
    activeCode: null,
    nodeStatus: node.eligible ? 'has_active_code' : 'missing_code',
    signupCompleted: node.eligible,
    allCommissionsCompleted: false,
    directInviteeCount: 0,
    totalDescendantCount: descendantCounts.get(node.id) ?? 0,
    isViewer: node.isViewer,
  })), [descendantCounts, nodes]);
  const positions = useMemo(
    () => buildReferralGraphLayout(layoutNodes, edges),
    [edges, layoutNodes],
  );
  const positionedNodes = useMemo(
    () => nodes.flatMap((node) => {
      const point = positions.get(node.id);
      return point ? [{ node, point }] : [];
    }),
    [nodes, positions],
  );
  const contributorNodeIds = useMemo(
    () => focusedNodeIds ?? new Set(
      nodes.filter((node) => !node.isViewer).map((node) => node.id),
    ),
    [focusedNodeIds, nodes],
  );
  const flows = useMemo(
    () => buildSampleRevenueEdgeFlows(nodes, edges, { contributorNodeIds }),
    [contributorNodeIds, edges, nodes],
  );
  const nodesById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );
  const selectedPath = useMemo(() => {
    const nodeIds = new Set<string>();
    const edgeIds = new Set<string>();
    const selected = selectedNodeId ? nodesById.get(selectedNodeId) : undefined;
    if (!selected) return { edgeIds, nodeIds };

    nodeIds.add(selected.id);
    if (selected.isViewer || !selected.eligible) {
      return { edgeIds, nodeIds };
    }

    let current: SampleRevenueGraphNode | undefined = selected;
    const visited = new Set<string>();

    while (current) {
      if (visited.has(current.id)) break;
      visited.add(current.id);
      nodeIds.add(current.id);
      if (current.parentId === null) break;
      const edge = edges.find(
        (candidate) => (
          candidate.source === current?.parentId
          && candidate.target === current.id
        ),
      );
      if (edge) edgeIds.add(edge.id);
      current = nodesById.get(current.parentId);
    }

    return { edgeIds, nodeIds };
  }, [edges, nodesById, selectedNodeId]);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [displayScale, setDisplayScale] = useState(1);
  const [viewportPan, setViewportPan] = useState({ x: 0, y: 0 });
  const scale = useSharedValue(1);
  const baseScale = useSharedValue(1);
  const panX = useSharedValue(0);
  const panY = useSharedValue(0);
  const startPanX = useSharedValue(0);
  const startPanY = useSharedValue(0);
  const pinchStartPanX = useSharedValue(0);
  const pinchStartPanY = useSharedValue(0);

  const syncViewportSnapshot = useCallback((
    nextScale: number,
    nextPanX: number,
    nextPanY: number,
  ) => {
    setDisplayScale(nextScale);
    setViewportPan({ x: nextPanX, y: nextPanY });
  }, []);

  const applyFit = useCallback((animated: boolean) => {
    if (canvasSize.width <= 0 || canvasSize.height <= 0) return;
    const viewport = getReferralGraphFitViewport({
      nodes: layoutNodes,
      positions,
      width: canvasSize.width,
      height: canvasSize.height,
      padding: 64,
    });
    const timing = { duration: 220, reduceMotion: ReduceMotion.System };

    scale.value = animated ? withTiming(viewport.scale, timing) : viewport.scale;
    panX.value = animated ? withTiming(viewport.panX, timing) : viewport.panX;
    panY.value = animated ? withTiming(viewport.panY, timing) : viewport.panY;
    baseScale.value = viewport.scale;
    syncViewportSnapshot(viewport.scale, viewport.panX, viewport.panY);
  }, [
    baseScale,
    canvasSize.height,
    canvasSize.width,
    layoutNodes,
    panX,
    panY,
    positions,
    scale,
    syncViewportSnapshot,
  ]);

  const applyDefaultViewport = useCallback((animated: boolean) => {
    if (canvasSize.width <= 0 || canvasSize.height <= 0) return;
    const viewer = nodes.find((node) => node.isViewer);
    const viewerPoint = viewer ? positions.get(viewer.id) : undefined;
    const focusedPoints = focusedNodeIds
      ? nodes.flatMap((node) => {
        if (node.isViewer || !focusedNodeIds.has(node.id)) return [];
        const point = positions.get(node.id);
        return point ? [point] : [];
      })
      : [];
    const targetPoint = focusedPoints.length > 0
      ? {
        x: (
          Math.min(...focusedPoints.map((point) => point.x))
          + Math.max(...focusedPoints.map((point) => point.x))
        ) / 2,
        y: (
          Math.min(...focusedPoints.map((point) => point.y))
          + Math.max(...focusedPoints.map((point) => point.y))
        ) / 2,
      }
      : viewerPoint;
    const focusDx = targetPoint && viewerPoint ? targetPoint.x - viewerPoint.x : 0;
    const focusDy = targetPoint && viewerPoint ? targetPoint.y - viewerPoint.y : 0;
    const focusDistance = Math.max(1, Math.hypot(focusDx, focusDy));
    const contextBiasX = focusedPoints.length > 0
      ? (focusDx / focusDistance) * DEFAULT_FOCUS_CONTEXT_BIAS
      : 0;
    const contextBiasY = focusedPoints.length > 0
      ? (focusDy / focusDistance) * DEFAULT_FOCUS_CONTEXT_BIAS
      : 0;
    const nextScale = focusedPoints.length > 0
      ? DEFAULT_FOCUSED_GRAPH_SCALE
      : DEFAULT_GRAPH_SCALE;
    const nextPanX = targetPoint
      ? -(targetPoint.x - REFERRAL_GRAPH_SURFACE_CENTER) * nextScale
        + contextBiasX
      : 0;
    const nextPanY = targetPoint
      ? -(targetPoint.y - REFERRAL_GRAPH_SURFACE_CENTER) * nextScale
        + contextBiasY
      : 0;
    const timing = { duration: 220, reduceMotion: ReduceMotion.System };

    scale.value = animated ? withTiming(nextScale, timing) : nextScale;
    panX.value = animated ? withTiming(nextPanX, timing) : nextPanX;
    panY.value = animated ? withTiming(nextPanY, timing) : nextPanY;
    baseScale.value = nextScale;
    syncViewportSnapshot(nextScale, nextPanX, nextPanY);
  }, [
    baseScale,
    canvasSize.height,
    canvasSize.width,
    focusedNodeIds,
    nodes,
    panX,
    panY,
    positions,
    scale,
    syncViewportSnapshot,
  ]);

  useEffect(() => {
    applyDefaultViewport(false);
  }, [applyDefaultViewport]);

  useEffect(() => {
    if (fitRequestId > 0) applyFit(true);
  }, [applyFit, fitRequestId]);

  useEffect(() => {
    if (resetRequestId > 0) applyDefaultViewport(true);
  }, [applyDefaultViewport, resetRequestId]);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setCanvasSize({ width: Math.max(1, width), height: Math.max(1, height) });
  }, []);

  const panGesture = useMemo(
    () => Gesture.Pan()
      .maxPointers(1)
      .minDistance(3)
      .onStart(() => {
        startPanX.value = panX.value;
        startPanY.value = panY.value;
      })
      .onUpdate((event) => {
        panX.value = startPanX.value + event.translationX;
        panY.value = startPanY.value + event.translationY;
      })
      .onFinalize(() => {
        runOnJS(syncViewportSnapshot)(scale.value, panX.value, panY.value);
      }),
    [panX, panY, scale, startPanX, startPanY, syncViewportSnapshot],
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
        panX.value = focalOffsetX - ratio * (focalOffsetX - pinchStartPanX.value);
        panY.value = focalOffsetY - ratio * (focalOffsetY - pinchStartPanY.value);
      })
      .onEnd(() => {
        baseScale.value = scale.value;
        runOnJS(syncViewportSnapshot)(scale.value, panX.value, panY.value);
      }),
    [
      baseScale,
      canvasSize.height,
      canvasSize.width,
      panX,
      panY,
      pinchStartPanX,
      pinchStartPanY,
      scale,
      syncViewportSnapshot,
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
      { scale: scale.value / GRAPH_RENDER_COORDINATE_SCALE },
    ],
  }));
  const edgeStrokeWidth = 1.4 / Math.max(displayScale, REFERRAL_GRAPH_MIN_SCALE);
  const flowStrokeWidth = 2.6 / Math.max(displayScale, REFERRAL_GRAPH_MIN_SCALE);
  const flowById = useMemo(
    () => new Map(flows.map((flow) => [flow.id, flow])),
    [flows],
  );
  const graphViewportRect = useMemo(() => {
    const offsetX = canvasSize.width / 2
      + viewportPan.x
      - REFERRAL_GRAPH_SURFACE_CENTER * displayScale;
    const offsetY = canvasSize.height / 2
      + viewportPan.y
      - REFERRAL_GRAPH_SURFACE_CENTER * displayScale;

    return {
      left: -offsetX,
      top: -offsetY,
      right: canvasSize.width - offsetX,
      bottom: canvasSize.height - offsetY,
    };
  }, [
    canvasSize.height,
    canvasSize.width,
    displayScale,
    viewportPan.x,
    viewportPan.y,
  ]);
  const visibleFlowLabels = useMemo(() => (
    buildRevenueFlowLabelLayouts({
      flows,
      nodes,
      positions,
      descendantCounts,
      graphScale: displayScale,
      nodeVisualScale: getNodeVisualScale(displayScale),
      labelVisualScale: getLabelVisualScale(displayScale),
      focusedNodeIds,
      selectedEdgeIds: selectedPath.edgeIds,
    }).flatMap((layout) => {
      if (!revenueFlowScreenRectFitsViewport(
        layout.screenRect,
        graphViewportRect,
        VIEWPORT_CONTENT_INSET,
      )) return [];
      const flow = flowById.get(layout.flowId);
      return flow ? [{ flow, point: layout.point }] : [];
    })
  ), [
    descendantCounts,
    displayScale,
    flowById,
    flows,
    focusedNodeIds,
    graphViewportRect,
    nodes,
    positions,
    selectedPath.edgeIds,
  ]);
  const visibleNodeCaptions = useMemo(() => {
    const nodeVisualScale = getNodeVisualScale(displayScale);
    const labelVisualScale = getLabelVisualScale(displayScale);
    const captionWidth = REVENUE_NODE_CAPTION_WIDTH * labelVisualScale;
    const captionHeight = REVENUE_NODE_CAPTION_HEIGHT * labelVisualScale;

    return positionedNodes.filter(({ node, point }) => {
      const focused = focusedNodeIds?.has(node.id) ?? true;
      if (getNodeAmountLabel(node, expectedTotalKrw, focused) === null) return false;

      const screenRadius = getReferralGraphNodeScreenRadius(
        descendantCounts.get(node.id) ?? 0,
      ) * nodeVisualScale;
      const centerX = point.x * displayScale;
      const centerY = point.y * displayScale
        + screenRadius
        + NODE_CAPTION_GAP
        + captionHeight / 2;
      const captionRect = {
        left: centerX - captionWidth / 2,
        top: centerY - captionHeight / 2,
        right: centerX + captionWidth / 2,
        bottom: centerY + captionHeight / 2,
      };

      return revenueFlowScreenRectFitsViewport(
        captionRect,
        graphViewportRect,
        VIEWPORT_CONTENT_INSET,
      );
    });
  }, [
    descendantCounts,
    displayScale,
    expectedTotalKrw,
    focusedNodeIds,
    graphViewportRect,
    positionedNodes,
  ]);

  return (
    <GestureDetector gesture={graphGesture}>
      <View
        style={styles.canvas}
        onLayout={handleLayout}
        accessibilityLabel="추천 관계 기반 금액 흐름 그래프. 주황색 화살표는 하위 샘플 배분액이 나에게 합산되는 방향입니다. 한 손가락으로 이동하고 두 손가락으로 확대하거나 축소할 수 있습니다."
      >
        <View pointerEvents="none" style={styles.grid} />
        <Animated.View
          style={[
            styles.surface,
            {
              width: GRAPH_RENDER_SURFACE_SIZE,
              height: GRAPH_RENDER_SURFACE_SIZE,
              left: (canvasSize.width - GRAPH_RENDER_SURFACE_SIZE) / 2,
              top: (canvasSize.height - GRAPH_RENDER_SURFACE_SIZE) / 2,
            },
            animatedSurfaceStyle,
          ]}
        >
          <Svg
            width={GRAPH_RENDER_SURFACE_SIZE}
            height={GRAPH_RENDER_SURFACE_SIZE}
            viewBox={`0 0 ${REFERRAL_GRAPH_SURFACE_SIZE} ${REFERRAL_GRAPH_SURFACE_SIZE}`}
            accessibilityElementsHidden
            importantForAccessibility="no"
          >
            <G>
              {flows.map((flow) => {
                const parent = positions.get(flow.source);
                const child = positions.get(flow.target);
                if (!parent || !child) return null;
                const highlighted = selectedPath.edgeIds.has(flow.id);
                const dimmedBySelection = selectedNodeId !== null && !highlighted;

                return (
                  <G key={flow.id}>
                    <Line
                      x1={parent.x}
                      y1={parent.y}
                      x2={child.x}
                      y2={child.y}
                      stroke="#cbd5e1"
                      strokeWidth={edgeStrokeWidth}
                      strokeLinecap="round"
                      strokeDasharray={flow.amountKrw <= 0 ? "5 5" : undefined}
                    />
                    {flow.amountKrw > 0 ? (
                      <>
                        <Line
                          x1={child.x}
                          y1={child.y}
                          x2={parent.x}
                          y2={parent.y}
                          stroke={highlighted ? FLOW_COLOR : FLOW_COLOR_SOFT}
                          strokeWidth={highlighted
                            ? flowStrokeWidth * 1.3
                            : flowStrokeWidth}
                          strokeLinecap="round"
                          opacity={dimmedBySelection ? 0.18 : highlighted ? 1 : 0.68}
                        />
                        <Polygon
                          points={getArrowPoints(parent, child, displayScale)}
                          fill={highlighted ? FLOW_COLOR : FLOW_COLOR_SOFT}
                          opacity={dimmedBySelection ? 0.18 : highlighted ? 1 : 0.82}
                        />
                      </>
                    ) : null}
                  </G>
                );
              })}
            </G>
          </Svg>

          {positionedNodes.map(({ node, point }) => {
            const focused = focusedNodeIds?.has(node.id) ?? true;
            const onPath = selectedPath.nodeIds.has(node.id);
            return (
              <RevenueFlowNodeMarker
                key={node.id}
                node={node}
                point={point}
                descendantCount={descendantCounts.get(node.id) ?? 0}
                graphScale={scale}
                focused={focused}
                onPath={onPath}
                selected={node.id === selectedNodeId}
                onSelectNode={onSelectNode}
              />
            );
          })}

          <View pointerEvents="none" style={styles.flowLabelLayer}>
            {visibleFlowLabels.map(({ flow, point }) => (
              <RevenueFlowEdgeLabel
                key={flow.id}
                flow={flow}
                point={point}
                graphScale={scale}
                highlighted={selectedPath.edgeIds.has(flow.id)}
              />
            ))}
          </View>

          <View pointerEvents="none" style={styles.nodeCaptionLayer}>
            {visibleNodeCaptions.map(({ node, point }) => {
              const focused = focusedNodeIds?.has(node.id) ?? true;
              const onPath = selectedPath.nodeIds.has(node.id);
              return (
                <RevenueFlowNodeCaption
                  key={node.id}
                  node={node}
                  point={point}
                  descendantCount={descendantCounts.get(node.id) ?? 0}
                  graphScale={scale}
                  focused={focused}
                  onPath={onPath}
                  expectedTotalKrw={expectedTotalKrw}
                />
              );
            })}
          </View>
        </Animated.View>

        <View pointerEvents="none" style={styles.zoomBadge}>
          <Text style={styles.zoomBadgeText}>{Math.round(displayScale * 100)}%</Text>
        </View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  canvas: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: '#f8fafc',
  },
  grid: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.55,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  surface: {
    position: 'absolute',
  },
  nodeAnchor: {
    position: 'absolute',
    width: NODE_HIT_TARGET_SIZE,
    height: NODE_HIT_TARGET_SIZE,
    overflow: 'visible',
    zIndex: 3,
  },
  nodeHitTarget: {
    position: 'absolute',
    width: NODE_HIT_TARGET_SIZE,
    height: NODE_HIT_TARGET_SIZE,
    left: 0,
    top: 0,
    borderRadius: NODE_HIT_TARGET_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  nodeHitTargetPressed: {
    backgroundColor: 'rgba(234, 88, 12, 0.12)',
  },
  nodeVisual: {
    ...StyleSheet.absoluteFillObject,
  },
  selectedNodeRing: {
    position: 'absolute',
    borderWidth: 3,
    borderColor: FLOW_COLOR,
  },
  nodeCircle: {
    position: 'absolute',
    borderWidth: 2.4,
    borderColor: '#ffffff',
  },
  nodeInsideName: {
    position: 'absolute',
    top: 0,
    height: NODE_HIT_TARGET_SIZE,
    color: '#ffffff',
    fontSize: 9,
    lineHeight: NODE_HIT_TARGET_SIZE,
    fontWeight: '900',
    textAlign: 'center',
    textAlignVertical: 'center',
    textShadowColor: 'rgba(124, 45, 18, 0.34)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1,
  },
  viewerInsideName: {
    color: '#713f12',
    textShadowColor: 'rgba(255,255,255,0.48)',
  },
  selectedInsideName: {
    fontWeight: '900',
  },
  nodeCaptionLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 5,
  },
  nodeCaptionAnchor: {
    position: 'absolute',
    width: NODE_HIT_TARGET_SIZE,
    height: NODE_HIT_TARGET_SIZE,
    overflow: 'visible',
  },
  nodeCaptionStack: {
    position: 'absolute',
    top: NODE_HIT_TARGET_SIZE / 2,
    left: (NODE_HIT_TARGET_SIZE - REVENUE_NODE_CAPTION_WIDTH) / 2,
    width: REVENUE_NODE_CAPTION_WIDTH,
    alignItems: 'center',
  },
  nodeCaptionContent: {
    width: REVENUE_NODE_CAPTION_WIDTH,
    alignItems: 'center',
  },
  nodeAmountPill: {
    minHeight: REVENUE_NODE_CAPTION_HEIGHT,
    maxWidth: REVENUE_NODE_CAPTION_WIDTH,
    justifyContent: 'center',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
    backgroundColor: '#ffedd5',
  },
  viewerAmountPill: {
    backgroundColor: '#fef9c3',
  },
  excludedAmountPill: {
    backgroundColor: '#e2e8f0',
  },
  nodeAmountText: {
    color: '#c2410c',
    fontSize: 9,
    lineHeight: 11,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  viewerAmountText: {
    color: '#854d0e',
  },
  excludedAmountText: {
    color: '#64748b',
  },
  flowLabelLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 4,
  },
  flowLabelAnchor: {
    position: 'absolute',
    width: REVENUE_FLOW_LABEL_WIDTH,
    height: REVENUE_FLOW_LABEL_HEIGHT,
    overflow: 'visible',
  },
  flowLabel: {
    width: REVENUE_FLOW_LABEL_WIDTH,
    height: REVENUE_FLOW_LABEL_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: '#fed7aa',
    borderRadius: 999,
    backgroundColor: 'rgba(255, 247, 237, 0.96)',
  },
  flowLabelHighlighted: {
    borderColor: FLOW_COLOR,
    backgroundColor: '#fff7ed',
  },
  flowLabelText: {
    color: '#9a3412',
    fontSize: 9,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  zoomBadge: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
  },
  zoomBadgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
});
