import { useCallback, useEffect, useMemo, useState } from 'react';
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
  buildReferralGraphLayout,
  getReferralGraphFitViewport,
  getReferralGraphNodeColor,
  getReferralGraphNodeRadius,
  getReferralGraphNodeStatusLabel,
  REFERRAL_GRAPH_MAX_SCALE,
  REFERRAL_GRAPH_MIN_SCALE,
  REFERRAL_GRAPH_SURFACE_SIZE,
} from '@/lib/referral-graph-native';
import type { ReferralGraphEdge, ReferralGraphNode } from '@/types/referral-graph';

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
      { scale: scale.value },
    ],
  }));

  const visibleNodeIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);
  const visibleEdges = useMemo(
    () => edges.filter(
      (edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target),
    ),
    [edges, visibleNodeIds],
  );
  const minimumScreenRadius = 15 / Math.max(displayScale, REFERRAL_GRAPH_MIN_SCALE);
  const hitTargetSize = 48 / Math.max(displayScale, REFERRAL_GRAPH_MIN_SCALE);
  const labelFontSize = Math.min(34, 11 / Math.max(displayScale, REFERRAL_GRAPH_MIN_SCALE));

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
              left: (canvasSize.width - REFERRAL_GRAPH_SURFACE_SIZE) / 2,
              top: (canvasSize.height - REFERRAL_GRAPH_SURFACE_SIZE) / 2,
            },
            animatedSurfaceStyle,
          ]}
        >
          <Svg
            width={REFERRAL_GRAPH_SURFACE_SIZE}
            height={REFERRAL_GRAPH_SURFACE_SIZE}
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
                    strokeWidth={Math.max(1.4, 1.2 / Math.max(displayScale, 0.5))}
                    strokeLinecap="round"
                  />
                );
              })}
            </G>
            <G>
              {nodes.map((node) => {
                const point = positions.get(node.id);
                if (!point) return null;
                const radius = Math.max(
                  getReferralGraphNodeRadius(node.totalDescendantCount),
                  minimumScreenRadius,
                );
                const selected = node.id === selectedNodeId;
                return (
                  <G key={node.id}>
                    {selected ? (
                      <Circle
                        cx={point.x}
                        cy={point.y}
                        r={radius + 7 / Math.max(displayScale, 0.5)}
                        fill="none"
                        stroke="#2563eb"
                        strokeWidth={3 / Math.max(displayScale, 0.5)}
                      />
                    ) : null}
                    <Circle
                      cx={point.x}
                      cy={point.y}
                      r={radius}
                      fill={getReferralGraphNodeColor(node)}
                      stroke="#ffffff"
                      strokeWidth={2.4 / Math.max(displayScale, 0.5)}
                    />
                    <SvgText
                      x={point.x}
                      y={point.y + radius + labelFontSize + 5}
                      fill="#334155"
                      fontSize={labelFontSize}
                      fontWeight="700"
                      textAnchor="middle"
                    >
                      {node.name.length > 10 ? `${node.name.slice(0, 10)}…` : node.name}
                    </SvgText>
                  </G>
                );
              })}
            </G>
          </Svg>

          {nodes.map((node) => {
            const point = positions.get(node.id);
            if (!point) return null;
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
                accessibilityLabel={`${node.name}, ${node.affiliation}, ${getReferralGraphNodeStatusLabel(node)}, 하위 ${node.totalDescendantCount}명`}
                accessibilityHint="두 번 탭하면 상세 정보를 엽니다."
              >
                <Text style={styles.hiddenNodeLabel}>{node.name}</Text>
              </Pressable>
            );
          })}
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
    width: REFERRAL_GRAPH_SURFACE_SIZE,
    height: REFERRAL_GRAPH_SURFACE_SIZE,
  },
  nodeHitTarget: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  nodeHitTargetPressed: {
    backgroundColor: 'rgba(37, 99, 235, 0.12)',
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
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
  },
  zoomBadgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
});
