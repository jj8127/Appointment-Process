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
  type SharedValue,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { G, Line } from 'react-native-svg';

import {
  buildReferralGraphLayout,
  getReferralGraphFitViewport,
  getReferralGraphNodeColor,
  getReferralGraphNodeScreenRadius,
  getReferralGraphNodeStatusLabel,
  getReferralGraphRenderSurfaceSize,
  REFERRAL_GRAPH_MAX_SCALE,
  REFERRAL_GRAPH_MIN_SCALE,
  REFERRAL_GRAPH_SURFACE_SIZE,
} from '@/lib/referral-graph-native';
import type {
  ReferralGraphEdge,
  ReferralGraphNode,
  ReferralGraphPoint,
} from '@/types/referral-graph';

const GRAPH_RENDER_SURFACE_SIZE = getReferralGraphRenderSurfaceSize(PixelRatio.get());
const GRAPH_RENDER_COORDINATE_SCALE = GRAPH_RENDER_SURFACE_SIZE / REFERRAL_GRAPH_SURFACE_SIZE;
const NODE_HIT_TARGET_SIZE = 48;
const NODE_LABEL_WIDTH = 120;
const NODE_LABEL_GAP = 6;
const NODE_SELECTED_RING_GAP = 7;
const NODE_VISUAL_MAX_SCALE = 1.4;

const getNodeVisualScale = (graphScale: number) => {
  'worklet';
  return Math.min(
    Math.max(graphScale, REFERRAL_GRAPH_MIN_SCALE),
    NODE_VISUAL_MAX_SCALE,
  );
};

type ReferralGraphNodeLayerProps = {
  node: ReferralGraphNode;
  point: ReferralGraphPoint;
  graphScale: SharedValue<number>;
};

type ReferralGraphNodeMarkerProps = ReferralGraphNodeLayerProps & {
  selected: boolean;
  onSelectNode: (node: ReferralGraphNode) => void;
};

const ReferralGraphNodeMarker = memo(function ReferralGraphNodeMarker({
  node,
  point,
  selected,
  graphScale,
  onSelectNode,
}: ReferralGraphNodeMarkerProps) {
  const screenRadius = getReferralGraphNodeScreenRadius(node.totalDescendantCount);
  const nodeDiameter = screenRadius * 2;
  const selectedRingDiameter = (screenRadius + NODE_SELECTED_RING_GAP) * 2;
  const inverseScaleStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: GRAPH_RENDER_COORDINATE_SCALE / Math.max(graphScale.value, 0.001) },
    ],
  }));
  const visualScaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: getNodeVisualScale(graphScale.value) }],
  }));

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
        accessibilityLabel={`${node.name}, ${node.affiliation}, ${getReferralGraphNodeStatusLabel(node)}, 하위 ${node.totalDescendantCount}명`}
        accessibilityHint="두 번 탭하면 상세 정보를 엽니다."
      >
        <Animated.View
          pointerEvents="none"
          style={[styles.nodeVisual, visualScaleStyle]}
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
                backgroundColor: getReferralGraphNodeColor(node),
              },
            ]}
          />
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
});

const ReferralGraphNodeLabel = memo(function ReferralGraphNodeLabel({
  node,
  point,
  graphScale,
}: ReferralGraphNodeLayerProps) {
  const screenRadius = getReferralGraphNodeScreenRadius(node.totalDescendantCount);
  const inverseScaleStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: GRAPH_RENDER_COORDINATE_SCALE / Math.max(graphScale.value, 0.001) },
    ],
  }));
  const labelOffsetStyle = useAnimatedStyle(() => ({
    transform: [{
      translateY:
        screenRadius * getNodeVisualScale(graphScale.value) + NODE_LABEL_GAP,
    }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.nodeLabelAnchor,
        {
          left: point.x * GRAPH_RENDER_COORDINATE_SCALE - NODE_HIT_TARGET_SIZE / 2,
          top: point.y * GRAPH_RENDER_COORDINATE_SCALE - NODE_HIT_TARGET_SIZE / 2,
        },
        inverseScaleStyle,
      ]}
    >
      <Animated.Text
        accessible={false}
        numberOfLines={1}
        ellipsizeMode="tail"
        style={[
          styles.nodeLabel,
          labelOffsetStyle,
        ]}
      >
        {node.name.length > 10 ? `${node.name.slice(0, 10)}…` : node.name}
      </Animated.Text>
    </Animated.View>
  );
});

type ReferralGraphCanvasProps = {
  nodes: ReferralGraphNode[];
  edges: ReferralGraphEdge[];
  selectedNodeId: string | null;
  onSelectNode: (node: ReferralGraphNode) => void;
  fitRequestId: number;
  resetRequestId: number;
};

const clampScale = (value: number) => {
  'worklet';
  return Math.min(Math.max(value, REFERRAL_GRAPH_MIN_SCALE), REFERRAL_GRAPH_MAX_SCALE);
};

export function ReferralGraphCanvas({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
  fitRequestId,
  resetRequestId,
}: ReferralGraphCanvasProps) {
  const positions = useMemo(
    () => buildReferralGraphLayout(nodes, edges),
    [edges, nodes],
  );
  const positionedNodes = useMemo(
    () => nodes.flatMap((node) => {
      const point = positions.get(node.id);
      return point ? [{ node, point }] : [];
    }),
    [nodes, positions],
  );
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

  const applyFit = useCallback((animated: boolean) => {
    if (canvasSize.width <= 0 || canvasSize.height <= 0) return;
    const viewport = getReferralGraphFitViewport({
      nodes,
      positions,
      width: canvasSize.width,
      height: canvasSize.height,
    });

    scale.value = animated ? withTiming(viewport.scale, { duration: 220 }) : viewport.scale;
    panX.value = animated ? withTiming(viewport.panX, { duration: 220 }) : viewport.panX;
    panY.value = animated ? withTiming(viewport.panY, { duration: 220 }) : viewport.panY;
    baseScale.value = viewport.scale;
    setDisplayScale(viewport.scale);
  }, [baseScale, canvasSize.height, canvasSize.width, nodes, panX, panY, positions, scale]);

  useEffect(() => {
    applyFit(fitRequestId > 0 || resetRequestId > 0);
  }, [applyFit, fitRequestId, resetRequestId]);

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
      }),
    [panX, panY, startPanX, startPanY],
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
        runOnJS(setDisplayScale)(scale.value);
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

  const visibleNodeIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);
  const visibleEdges = useMemo(
    () => edges.filter(
      (edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target),
    ),
    [edges, visibleNodeIds],
  );
  const edgeStrokeWidth = 1.4 / Math.max(displayScale, REFERRAL_GRAPH_MIN_SCALE);

  return (
    <GestureDetector gesture={graphGesture}>
      <View
        style={styles.canvas}
        onLayout={handleLayout}
        accessibilityLabel="추천 관계 그래프. 한 손가락으로 이동하고 두 손가락으로 확대하거나 축소할 수 있습니다."
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
          >
            <G>
              {visibleEdges.map((edge) => {
                const source = positions.get(edge.source);
                const target = positions.get(edge.target);
                if (!source || !target) return null;
                return (
                  <Line
                    key={edge.id}
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                    stroke="#cbd5e1"
                    strokeWidth={edgeStrokeWidth}
                    strokeLinecap="round"
                  />
                );
              })}
            </G>
          </Svg>

          {positionedNodes.map(({ node, point }) => (
              <ReferralGraphNodeMarker
                key={node.id}
                node={node}
                point={point}
                selected={node.id === selectedNodeId}
                graphScale={scale}
                onSelectNode={onSelectNode}
              />
          ))}

          <View pointerEvents="none" style={styles.nodeLabelLayer}>
            {positionedNodes.map(({ node, point }) => (
                <ReferralGraphNodeLabel
                  key={node.id}
                  node={node}
                  point={point}
                  graphScale={scale}
                />
            ))}
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
  },
  nodeLabelLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
  },
  nodeLabelAnchor: {
    position: 'absolute',
    width: NODE_HIT_TARGET_SIZE,
    height: NODE_HIT_TARGET_SIZE,
    overflow: 'visible',
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
    backgroundColor: 'rgba(37, 99, 235, 0.12)',
  },
  nodeVisual: {
    ...StyleSheet.absoluteFillObject,
  },
  selectedNodeRing: {
    position: 'absolute',
    borderWidth: 3,
    borderColor: '#2563eb',
  },
  nodeCircle: {
    position: 'absolute',
    borderWidth: 2.4,
    borderColor: '#ffffff',
  },
  nodeLabel: {
    position: 'absolute',
    top: NODE_HIT_TARGET_SIZE / 2,
    width: NODE_LABEL_WIDTH,
    left: (NODE_HIT_TARGET_SIZE - NODE_LABEL_WIDTH) / 2,
    color: '#334155',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    textAlign: 'center',
    textShadowColor: '#f8fafc',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 3,
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
