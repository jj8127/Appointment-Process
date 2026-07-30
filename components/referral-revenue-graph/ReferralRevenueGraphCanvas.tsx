import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import Svg, {
  Line,
  type LineProps,
} from 'react-native-svg';

import {
  buildSampleRevenueGraphLayout,
  formatCompactSampleRevenueKrw,
  formatSampleRevenueNodeAmount,
  getSampleRevenueGraphFitViewport,
  getSampleRevenueGraphNodeColor,
  getSampleRevenueGraphNodeRadius,
  getSampleRevenueGraphNodeStatusLabel,
  prepareSampleRevenueGraphPhysicsTopology,
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
import { ReferralRevenueGraphWebViewCanvas } from './ReferralRevenueGraphWebViewCanvas';

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

let nextNodeDragContextToken = 0;

const allocateNodeDragContextToken = (context: object) => {
  void context;
  nextNodeDragContextToken += 1;
  return nextNodeDragContextToken;
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

const AnimatedLine = Animated.createAnimatedComponent(Line);

export type NodeDragSessionState = Readonly<{
  mounted: boolean;
  contextToken: number;
  activeGestureToken: number | null;
  highestGestureToken: number;
  settleGestureToken: number | null;
}>;

type NodeDragSessionEvent =
  | { type: 'mount'; contextToken: number }
  | { type: 'unmount' }
  | {
    type: 'begin' | 'update' | 'end' | 'cancel' | 'settle';
    contextToken: number;
    gestureToken: number;
  };

type NodeDragSessionTransition = Readonly<{
  accepted: boolean;
  state: NodeDragSessionState;
}>;

export const createNodeDragSessionState = (
  contextToken: number,
): NodeDragSessionState => ({
  mounted: false,
  contextToken,
  activeGestureToken: null,
  highestGestureToken: 0,
  settleGestureToken: null,
});

export const transitionNodeDragSession = (
  state: NodeDragSessionState,
  event: NodeDragSessionEvent,
): NodeDragSessionTransition => {
  if (event.type === 'mount') {
    return {
      accepted: true,
      state: {
        ...state,
        mounted: true,
        contextToken: event.contextToken,
        activeGestureToken: null,
        settleGestureToken: null,
      },
    };
  }
  if (event.type === 'unmount') {
    return {
      accepted: true,
      state: {
        ...state,
        mounted: false,
        activeGestureToken: null,
        settleGestureToken: null,
      },
    };
  }
  if (!('gestureToken' in event)) {
    return { accepted: false, state };
  }

  const matchesContext = state.mounted
    && event.contextToken === state.contextToken;
  if (event.type === 'begin') {
    if (!matchesContext || event.gestureToken <= state.highestGestureToken) {
      return { accepted: false, state };
    }
    return {
      accepted: true,
      state: {
        ...state,
        activeGestureToken: event.gestureToken,
        highestGestureToken: event.gestureToken,
        settleGestureToken: null,
      },
    };
  }

  if (
    !matchesContext
    || event.gestureToken !== state.highestGestureToken
  ) {
    return { accepted: false, state };
  }
  if (event.type === 'settle') {
    return {
      accepted: state.activeGestureToken == null
        && state.settleGestureToken === event.gestureToken,
      state,
    };
  }
  if (event.gestureToken !== state.activeGestureToken) {
    return { accepted: false, state };
  }
  if (event.type === 'update') {
    return { accepted: true, state };
  }
  return {
    accepted: true,
    state: {
      ...state,
      activeGestureToken: null,
      settleGestureToken: event.type === 'end'
        ? event.gestureToken
        : null,
    },
  };
};

const AnimatedRevenueEdge = memo(function AnimatedRevenueEdge({
  context,
  coordinates,
  excluded,
  safeScale,
  sourceIndex,
  targetIndex,
}: {
  context: boolean;
  coordinates: SharedValue<number[]>;
  excluded: boolean;
  safeScale: number;
  sourceIndex: number;
  targetIndex: number;
}) {
  const animatedProps = useAnimatedProps<LineProps>(() => ({
    x1: coordinates.value[sourceIndex * 2] ?? 0,
    y1: coordinates.value[sourceIndex * 2 + 1] ?? 0,
    x2: coordinates.value[targetIndex * 2] ?? 0,
    y2: coordinates.value[targetIndex * 2 + 1] ?? 0,
  }), [coordinates, sourceIndex, targetIndex]);

  return (
    <AnimatedLine
      animatedProps={animatedProps}
      stroke={excluded || context ? '#cbd5e1' : '#fdba74'}
      strokeWidth={Math.max(1.5, 1.35 / safeScale)}
      strokeLinecap="round"
      strokeDasharray={excluded ? '5 5' : undefined}
    />
  );
});

const AnimatedRevenueNode = memo(function AnimatedRevenueNode({
  amountLabel,
  coordinates,
  isContext,
  node,
  nodeAmountLabel,
  nodeIndex,
  radius,
  safeScale,
  scale,
  selected,
}: {
  amountLabel: string;
  coordinates: SharedValue<number[]>;
  isContext: boolean;
  node: SampleRevenueGraphNode;
  nodeAmountLabel: string;
  nodeIndex: number;
  radius: number;
  safeScale: number;
  scale: SharedValue<number>;
  selected: boolean;
}) {
  const positionStyle = useAnimatedStyle(() => {
    const x = coordinates.value[nodeIndex * 2] ?? 0;
    const y = coordinates.value[nodeIndex * 2 + 1] ?? 0;
    return {
      transform: [
        { translateX: x - radius },
        { translateY: y - radius },
      ],
    };
  }, [coordinates, nodeIndex, radius]);
  const inverseScaleStyle = useAnimatedStyle(() => ({
    transform: [{
      scale: 1 / Math.max(
        scale.value,
        SAMPLE_REVENUE_GRAPH_MIN_SCALE,
      ),
    }],
  }), [scale]);
  const ringInset = 7 / safeScale;
  const nodeColor = getSampleRevenueGraphNodeColor(node, isContext);
  const labelColor = isContext ? '#475569' : '#ffffff';

  return (
    <Animated.View
      pointerEvents="none"
      renderToHardwareTextureAndroid
      shouldRasterizeIOS
      style={[
        styles.nodeVisual,
        {
          width: radius * 2,
          height: radius * 2,
          zIndex: selected ? 2 : 1,
        },
        positionStyle,
      ]}
    >
      {selected ? (
        <View
          style={[
            styles.nodeSelectionRing,
            {
              left: -ringInset,
              top: -ringInset,
              width: (radius + ringInset) * 2,
              height: (radius + ringInset) * 2,
              borderRadius: radius + ringInset,
              borderWidth: 3 / safeScale,
            },
          ]}
        />
      ) : null}
      <View
        style={[
          styles.nodeCircle,
          {
            width: radius * 2,
            height: radius * 2,
            borderRadius: radius,
            backgroundColor: nodeColor,
            borderWidth: 2.4 / safeScale,
          },
          !node.eligible && !node.isViewer
            ? styles.nodeCircleExcluded
            : null,
        ]}
      />
      <Animated.View
        style={[
          styles.nodeLabelStack,
          inverseScaleStyle,
        ]}
      >
        <Text
          numberOfLines={1}
          style={[styles.nodeNameLabel, { color: labelColor }]}
        >
          {getCompactNodeLabel(node)}
        </Text>
        <Text
          numberOfLines={1}
          style={[styles.nodeAmountLabel, { color: labelColor }]}
        >
          {nodeAmountLabel}
        </Text>
      </Animated.View>
      {selected ? (
        <Animated.View
          style={[
            styles.selectedNodeLabel,
            {
              top: radius * 2 + (8 / safeScale),
            },
            inverseScaleStyle,
          ]}
        >
          <Text
            numberOfLines={1}
            style={styles.selectedNodeName}
          >
            {node.name}
          </Text>
          <Text
            numberOfLines={1}
            style={[
              styles.selectedNodeAmount,
              {
                color: node.eligible && !isContext
                  ? '#c2410c'
                  : '#64748b',
              },
            ]}
          >
            {amountLabel}
          </Text>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
});

const AnimatedRevenueHitTarget = memo(function AnimatedRevenueHitTarget({
  coordinates,
  hitTargetSize,
  node,
  nodeIndex,
  onSelectNode,
}: {
  coordinates: SharedValue<number[]>;
  hitTargetSize: number;
  node: SampleRevenueGraphNode;
  nodeIndex: number;
  onSelectNode: (node: SampleRevenueGraphNode) => void;
}) {
  const positionStyle = useAnimatedStyle(() => {
    const x = coordinates.value[nodeIndex * 2] ?? 0;
    const y = coordinates.value[nodeIndex * 2 + 1] ?? 0;
    return {
      transform: [
        { translateX: x - hitTargetSize / 2 },
        { translateY: y - hitTargetSize / 2 },
      ],
    };
  }, [coordinates, hitTargetSize, nodeIndex]);

  return (
    <Animated.View
      style={[
        styles.nodeHitTarget,
        {
          width: hitTargetSize,
          height: hitTargetSize,
          borderRadius: hitTargetSize / 2,
        },
        positionStyle,
      ]}
    >
      <Pressable
        style={({ pressed }) => [
          styles.nodeHitTargetPressable,
          pressed && styles.nodeHitTargetPressed,
        ]}
        onPress={() => onSelectNode(node)}
        accessibilityRole="button"
        accessibilityLabel={`${node.name}, ${node.depth}단계, ${getSampleRevenueGraphNodeStatusLabel(node)}`}
        accessibilityHint="두 번 탭하면 샘플 매출과 예상 배분 상세를 엽니다."
      >
      </Pressable>
    </Animated.View>
  );
});

export function ReferralRevenueGraphCanvas(props: Props) {
  if (Platform.OS !== 'web') {
    return <ReferralRevenueGraphWebViewCanvas {...props} />;
  }
  return <ReferralRevenueGraphSvgCanvas {...props} />;
}

function ReferralRevenueGraphSvgCanvas({
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
  const isFocused = useIsFocused();
  const topology = useMemo(
    () => prepareSampleRevenueGraphPhysicsTopology(nodes, edges),
    [edges, nodes],
  );
  const initialPositions = useMemo(
    () => buildSampleRevenueGraphLayout(nodes, edges, topology),
    [edges, nodes, topology],
  );
  const gestureContextToken = useMemo(
    () => allocateNodeDragContextToken({
      isFocused,
      resetRequestId,
      topology,
    }),
    [isFocused, resetRequestId, topology],
  );
  const orderedNodes = useMemo(
    () => topology.nodes.map(({ node }) => node),
    [topology],
  );
  const initialMotion = useMemo(
    () => createMotionLayout(initialPositions),
    [initialPositions],
  );
  const [renderPositions, setRenderPositions] = useState(
    () => new Map(initialPositions),
  );
  const motionRef = useRef(initialMotion);
  const settleFrameRef = useRef<number | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const dragSessionRef = useRef(
    createNodeDragSessionState(gestureContextToken),
  );
  const pendingDragRef = useRef<{
    contextToken: number;
    gestureToken: number;
    nodeIndex: number;
    topology: typeof topology;
    x: number;
    y: number;
  } | null>(null);
  const topologyRef = useRef(topology);
  const zoomTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [physicsActive, setPhysicsActive] = useState(false);
  const [zoomVisible, setZoomVisible] = useState(false);
  const positionsRef = useRef<
    ReadonlyMap<string, { x: number; y: number }>
  >(renderPositions);
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
  const nodeDragGestureSequence = useSharedValue(0);
  const nodeDragGestureToken = useSharedValue(0);
  const motionCoordinates = useSharedValue<number[]>(
    orderedNodes.flatMap((node) => {
      const point = initialPositions.get(node.id);
      return point ? [point.x, point.y] : [0, 0];
    }),
  );

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

  const cancelPendingNodeDrag = useCallback(() => {
    pendingDragRef.current = null;
    if (dragFrameRef.current != null) {
      cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
  }, []);

  const commitMotion = useCallback((
    next: Map<string, SampleRevenueGraphMotionPoint>,
  ) => {
    motionRef.current = next;
    positionsRef.current = next;
    motionCoordinates.value = orderedNodes.flatMap((node) => {
      const point = next.get(node.id);
      return point ? [point.x, point.y] : [0, 0];
    });
  }, [motionCoordinates, orderedNodes]);

  const syncRenderPositions = useCallback((
    next: ReadonlyMap<string, SampleRevenueGraphMotionPoint>,
  ) => {
    const snapshot = new Map(
      Array.from(next, ([id, point]) => [
        id,
        { x: point.x, y: point.y },
      ]),
    );
    positionsRef.current = snapshot;
    setRenderPositions(snapshot);
  }, []);

  useLayoutEffect(() => {
    topologyRef.current = topology;
    if (!isFocused) {
      dragSessionRef.current = transitionNodeDragSession(
        dragSessionRef.current,
        { type: 'unmount' },
      ).state;
      cancelSettle();
      cancelPendingNodeDrag();
      syncRenderPositions(motionRef.current);
      setPhysicsActive(false);
      return undefined;
    }
    dragSessionRef.current = transitionNodeDragSession(
      dragSessionRef.current,
      { type: 'mount', contextToken: gestureContextToken },
    ).state;
    return () => {
      dragSessionRef.current = transitionNodeDragSession(
        dragSessionRef.current,
        { type: 'unmount' },
      ).state;
      cancelSettle();
      cancelPendingNodeDrag();
    };
  }, [
    cancelPendingNodeDrag,
    cancelSettle,
    gestureContextToken,
    isFocused,
    syncRenderPositions,
    topology,
  ]);

  useEffect(() => {
    cancelSettle();
    cancelPendingNodeDrag();
    commitMotion(initialMotion);
    syncRenderPositions(initialMotion);
    setPhysicsActive(false);
  }, [
    cancelPendingNodeDrag,
    cancelSettle,
    commitMotion,
    initialMotion,
    resetRequestId,
    syncRenderPositions,
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
    if (zoomTimerRef.current != null) {
      clearTimeout(zoomTimerRef.current);
    }
  }, []);

  const beginNodeDrag = useCallback((
    contextToken: number,
    gestureToken: number,
  ) => {
    const transition = transitionNodeDragSession(
      dragSessionRef.current,
      { type: 'begin', contextToken, gestureToken },
    );
    if (!transition.accepted) return;
    dragSessionRef.current = transition.state;
    cancelSettle();
    cancelPendingNodeDrag();
    setPhysicsActive(true);
  }, [cancelPendingNodeDrag, cancelSettle]);

  const commitNodeDragSample = useCallback((
    nodeIndex: number,
    x: number,
    y: number,
  ) => {
    const node = orderedNodes[nodeIndex];
    if (!node) return;
    const next = stepSampleRevenueInteractivePhysics({
      nodes,
      edges,
      topology,
      motion: motionRef.current,
      alpha: 0.24,
      ticks: 1,
      fixedNodeId: node.id,
      fixedPosition: {
        x: Math.min(Math.max(x, 70), SAMPLE_REVENUE_GRAPH_SURFACE_SIZE - 70),
        y: Math.min(Math.max(y, 70), SAMPLE_REVENUE_GRAPH_SURFACE_SIZE - 70),
      },
    });
    commitMotion(next);
  }, [commitMotion, edges, nodes, orderedNodes, topology]);

  const updateNodeDrag = useCallback((
    contextToken: number,
    gestureToken: number,
    nodeIndex: number,
    x: number,
    y: number,
  ) => {
    const transition = transitionNodeDragSession(
      dragSessionRef.current,
      { type: 'update', contextToken, gestureToken },
    );
    if (!transition.accepted) return;
    pendingDragRef.current = {
      contextToken,
      gestureToken,
      nodeIndex,
      topology,
      x,
      y,
    };
    if (dragFrameRef.current != null) return;
    dragFrameRef.current = requestAnimationFrame(() => {
      dragFrameRef.current = null;
      const sample = pendingDragRef.current;
      pendingDragRef.current = null;
      if (!sample || sample.topology !== topologyRef.current) {
        return;
      }
      const current = transitionNodeDragSession(
        dragSessionRef.current,
        {
          type: 'update',
          contextToken: sample.contextToken,
          gestureToken: sample.gestureToken,
        },
      );
      if (!current.accepted) {
        return;
      }
      commitNodeDragSample(sample.nodeIndex, sample.x, sample.y);
    });
  }, [commitNodeDragSample, topology]);

  const endNodeDrag = useCallback((
    contextToken: number,
    gestureToken: number,
  ) => {
    const transition = transitionNodeDragSession(
      dragSessionRef.current,
      { type: 'end', contextToken, gestureToken },
    );
    if (!transition.accepted) return;
    const finalSample = pendingDragRef.current?.contextToken === contextToken
      && pendingDragRef.current.gestureToken === gestureToken
      ? pendingDragRef.current
      : null;
    dragSessionRef.current = transition.state;
    cancelPendingNodeDrag();
    cancelSettle();
    let alpha = 0.32;
    let pendingFinalSample = finalSample?.topology === topology
      ? finalSample
      : null;
    setPhysicsActive(true);
    const settle = () => {
      const current = transitionNodeDragSession(
        dragSessionRef.current,
        { type: 'settle', contextToken, gestureToken },
      );
      if (!current.accepted || topology !== topologyRef.current) {
        settleFrameRef.current = null;
        return;
      }
      const finalNode = pendingFinalSample
        ? orderedNodes[pendingFinalSample.nodeIndex]
        : null;
      const next = finalNode && pendingFinalSample
        ? stepSampleRevenueInteractivePhysics({
          nodes,
          edges,
          topology,
          motion: motionRef.current,
          alpha: 0.24,
          ticks: 1,
          fixedNodeId: finalNode.id,
          fixedPosition: {
            x: Math.min(
              Math.max(pendingFinalSample.x, 70),
              SAMPLE_REVENUE_GRAPH_SURFACE_SIZE - 70,
            ),
            y: Math.min(
              Math.max(pendingFinalSample.y, 70),
              SAMPLE_REVENUE_GRAPH_SURFACE_SIZE - 70,
            ),
          },
        })
        : stepSampleRevenueInteractivePhysics({
          nodes,
          edges,
          topology,
          motion: motionRef.current,
          alpha: alpha *= 0.94,
          ticks: 1,
        });
      pendingFinalSample = null;
      commitMotion(next);
      if (alpha > 0.014) {
        settleFrameRef.current = requestAnimationFrame(settle);
      } else {
        settleFrameRef.current = null;
        syncRenderPositions(next);
        setPhysicsActive(false);
      }
    };
    settleFrameRef.current = requestAnimationFrame(settle);
  }, [
    cancelPendingNodeDrag,
    cancelSettle,
    commitMotion,
    edges,
    nodes,
    orderedNodes,
    syncRenderPositions,
    topology,
  ]);

  const cancelNodeDrag = useCallback((
    contextToken: number,
    gestureToken: number,
  ) => {
    const transition = transitionNodeDragSession(
      dragSessionRef.current,
      { type: 'cancel', contextToken, gestureToken },
    );
    if (!transition.accepted) return;
    dragSessionRef.current = transition.state;
    cancelPendingNodeDrag();
    cancelSettle();
    syncRenderPositions(motionRef.current);
    setPhysicsActive(false);
  }, [cancelPendingNodeDrag, cancelSettle, syncRenderPositions]);

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
        nodeDragGestureSequence.value += 1;
        nodeDragGestureToken.value = nodeDragGestureSequence.value;
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
          runOnJS(beginNodeDrag)(
            gestureContextToken,
            nodeDragGestureToken.value,
          );
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
            gestureContextToken,
            nodeDragGestureToken.value,
            draggedNodeIndex.value,
            graphX,
            graphY,
          );
          return;
        }
        panX.value = startPanX.value + event.translationX;
        panY.value = startPanY.value + event.translationY;
      })
      .onFinalize((_event, success) => {
        if (draggedNodeIndex.value >= 0) {
          if (success) {
            runOnJS(endNodeDrag)(
              gestureContextToken,
              nodeDragGestureToken.value,
            );
          } else {
            runOnJS(cancelNodeDrag)(
              gestureContextToken,
              nodeDragGestureToken.value,
            );
          }
        }
        draggedNodeIndex.value = -1;
      }),
    [
      beginNodeDrag,
      cancelNodeDrag,
      canvasSize.height,
      canvasSize.width,
      draggedNodeIndex,
      endNodeDrag,
      gestureContextToken,
      motionCoordinates,
      nodeDragGestureSequence,
      nodeDragGestureToken,
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
  const nodeById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );
  const nodeIndexById = useMemo(
    () => new Map(orderedNodes.map((node, index) => [node.id, index])),
    [orderedNodes],
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
            {visibleEdges.map((edge) => {
              const sourceIndex = nodeIndexById.get(edge.source);
              const targetIndex = nodeIndexById.get(edge.target);
              const targetNode = nodeById.get(edge.target);
              if (
                sourceIndex == null
                || targetIndex == null
                || !targetNode
              ) {
                return null;
              }
              const excluded = !targetNode.eligible && !targetNode.isViewer;
              const context = Boolean(
                focusedNodeIds && !focusedNodeIds.has(edge.target),
              );

              return (
                <AnimatedRevenueEdge
                  key={edge.id}
                  context={context}
                  coordinates={motionCoordinates}
                  excluded={excluded}
                  safeScale={safeScale}
                  sourceIndex={sourceIndex}
                  targetIndex={targetIndex}
                />
              );
            })}
          </Svg>

          {nodes.map((node) => {
            const nodeIndex = nodeIndexById.get(node.id);
            if (nodeIndex == null) return null;
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
              <AnimatedRevenueNode
                key={node.id}
                amountLabel={amountLabel}
                coordinates={motionCoordinates}
                isContext={isContext}
                node={node}
                nodeAmountLabel={nodeAmountLabel}
                nodeIndex={nodeIndex}
                radius={radius}
                safeScale={safeScale}
                scale={scale}
                selected={selected}
              />
            );
          })}

          {nodes.map((node) => {
            const nodeIndex = nodeIndexById.get(node.id);
            if (nodeIndex == null) return null;
            const isContext = Boolean(
              focusedNodeIds && !focusedNodeIds.has(node.id),
            );
            const selectable = !node.isViewer && !isContext;
            if (!selectable) return null;

            return (
              <AnimatedRevenueHitTarget
                key={`hit-${node.id}`}
                coordinates={motionCoordinates}
                hitTargetSize={hitTargetSize}
                node={node}
                nodeIndex={nodeIndex}
                onSelectNode={onSelectNode}
              />
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
  nodeVisual: {
    position: 'absolute',
    left: 0,
    top: 0,
    overflow: 'visible',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nodeSelectionRing: {
    position: 'absolute',
    borderColor: '#2563eb',
    backgroundColor: 'transparent',
  },
  nodeCircle: {
    position: 'absolute',
    left: 0,
    top: 0,
    borderColor: '#ffffff',
  },
  nodeCircleExcluded: {
    borderStyle: 'dashed',
  },
  nodeLabelStack: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nodeNameLabel: {
    fontSize: 11,
    lineHeight: 12,
    fontWeight: '800',
    textAlign: 'center',
  },
  nodeAmountLabel: {
    fontSize: 7,
    lineHeight: 9,
    fontWeight: '800',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  selectedNodeLabel: {
    position: 'absolute',
    left: '50%',
    width: 180,
    marginLeft: -90,
    alignItems: 'center',
  },
  selectedNodeName: {
    color: '#334155',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
  selectedNodeAmount: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '700',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  nodeHitTarget: {
    position: 'absolute',
    left: 0,
    top: 0,
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  nodeHitTargetPressable: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  nodeHitTargetPressed: {
    backgroundColor: 'rgba(249, 115, 22, 0.16)',
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
