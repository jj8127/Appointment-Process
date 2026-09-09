import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, type LayoutChangeEvent, PixelRatio, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { type SharedValue, cancelAnimation, runOnJS, useAnimatedProps, useAnimatedReaction, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { getReferralGraphNodeColor, getReferralGraphNodeScreenRadius, getReferralGraphNodeStatusLabel, getReferralGraphRenderSurfaceSize } from '@/lib/referral-graph-native';
import {
  buildReadableReferralGraphLayout,
  buildReferralGraphLabels,
  clampReadableReferralGraphScale,
  getReadableReferralGraphViewport,
  getReferralGraphLabelText,
  getReferralGraphVisualScale,
  projectReferralGraphPoint,
  REFERRAL_GRAPH_HIT_SIZE,
  type GraphLabelPlacement,
} from '@/lib/referral-graph-readable';
import type { ReferralGraphEdge, ReferralGraphNode, ReferralGraphPoint } from '@/types/referral-graph';
import { buildReferralGraphRenderSet, getReferralGraphPrimitivePadding, REFERRAL_GRAPH_OVERSCAN } from '@/lib/referral-graph-render-model';
import { getReferralGraphLabelRect, getReferralGraphLabelScale, isReferralGraphLabelVisible, shouldRefreshReferralGraphViewport, type ReferralGraphCameraSnapshot } from '@/lib/referral-graph-viewport';
import { getReferralGraphNodeAmountMetrics, type ReferralGraphNodeAmounts } from '@/lib/referral-graph-node-amounts';

const GRAPH_RENDER_SURFACE_SIZE = getReferralGraphRenderSurfaceSize(PixelRatio.get());
const AnimatedPath = Animated.createAnimatedComponent(Path);

type Camera = {
  scale: SharedValue<number>;
  width: number;
  height: number;
  padding: number;
};

const ReferralGraphNodeMarker = memo(function ReferralGraphNodeMarker({ node, point, selected, camera, onSelectNode, getNodeAccessibilityLabel }: {
  node: ReferralGraphNode;
  point: ReferralGraphPoint;
  selected: boolean;
  camera: Camera;
  onSelectNode: (node: ReferralGraphNode) => void;
  getNodeAccessibilityLabel?: (node: ReferralGraphNode) => string;
}) {
  const radius = getReferralGraphNodeScreenRadius(node.totalDescendantCount);
  const anchorStyle = useAnimatedStyle(() => {
    const screen = projectReferralGraphPoint(point, camera.scale.value, 0, 0, camera.width, camera.height);
    return { transform: [{ translateX: screen.x + camera.padding - REFERRAL_GRAPH_HIT_SIZE / 2 }, { translateY: screen.y + camera.padding - REFERRAL_GRAPH_HIT_SIZE / 2 }] };
  });
  const visualStyle = useAnimatedStyle(() => ({ transform: [{ scale: getReferralGraphVisualScale(camera.scale.value) }] }));
  return (
    <Animated.View pointerEvents="box-none" style={[styles.nodeAnchor, anchorStyle]}>
      <Pressable
        style={styles.nodeHitTarget}
        onPress={() => onSelectNode(node)}
        accessibilityRole="button"
        accessibilityLabel={getNodeAccessibilityLabel?.(node) ?? [node.name, node.affiliation, getReferralGraphNodeStatusLabel(node), '하위 ' + node.totalDescendantCount + '명'].join(', ')}
        accessibilityHint="두 번 탭하면 상세 정보를 엽니다."
      >
        <Animated.View pointerEvents="none" style={[styles.nodeVisual, visualStyle]}>
          {selected ? <View style={[styles.selectedNodeRing, {
            width: (radius + 7) * 2, height: (radius + 7) * 2, borderRadius: radius + 7,
            left: REFERRAL_GRAPH_HIT_SIZE / 2 - radius - 7, top: REFERRAL_GRAPH_HIT_SIZE / 2 - radius - 7,
          }]} /> : null}
          <View style={[styles.nodeCircle, {
            width: radius * 2, height: radius * 2, borderRadius: radius,
            left: REFERRAL_GRAPH_HIT_SIZE / 2 - radius, top: REFERRAL_GRAPH_HIT_SIZE / 2 - radius,
            backgroundColor: getReferralGraphNodeColor(node),
          }]} />
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
});

const ReferralGraphNodeLabel = memo(function ReferralGraphNodeLabel({ node, point, placement, labelScale, camera, amounts, fontScale }: {
  node: ReferralGraphNode;
  point: ReferralGraphPoint;
  placement: GraphLabelPlacement;
  labelScale: number;
  camera: Camera;
  amounts?: ReferralGraphNodeAmounts;
  fontScale: number;
}) {
  // One shared layer transforms these fixed layout coordinates during gestures.
  const screen = projectReferralGraphPoint(point, labelScale, 0, 0, camera.width, camera.height);
  const bounds = { width: placement.width, height: placement.height,
    left: screen.x + placement.offsetX + camera.padding, top: screen.y + placement.offsetY + camera.padding };
  if (placement.showDetails && amounts) {
    const metrics = getReferralGraphNodeAmountMetrics(node.name, amounts, fontScale);
    const amountStyle = { fontSize: metrics.fontSize, lineHeight: metrics.lineHeight };
    return (
      <View accessible={false} pointerEvents="none" style={[styles.nodeAmountCard, bounds]}>
        <Text accessible={false} allowFontScaling={false} numberOfLines={1} ellipsizeMode="tail"
          style={[styles.nodeAmountName, { fontSize: metrics.nameFontSize, lineHeight: metrics.lineHeight, marginBottom: metrics.nameGap }]}>
          {getReferralGraphLabelText(node.name)}
        </Text>
        <Text accessible={false} allowFontScaling={false} numberOfLines={1} style={[styles.nodeDirect, amountStyle, amounts.directNegative && styles.nodeNegative]}>{amounts.directText}</Text>
        <Text accessible={false} allowFontScaling={false} numberOfLines={1} style={[styles.nodeTotal, amountStyle, amounts.totalNegative && styles.nodeNegative]}>{amounts.totalText}</Text>
      </View>
    );
  }
  return (
    <Text accessible={false} pointerEvents="none" numberOfLines={1} ellipsizeMode="tail"
      style={[styles.nodeLabel, bounds]}>
      {getReferralGraphLabelText(node.name)}
    </Text>
  );
});

type ReferralGraphCanvasProps = {
  nodeAmounts?: readonly ReferralGraphNodeAmounts[];
  getNodeAccessibilityLabel?: (node: ReferralGraphNode) => string;
  nodes: ReferralGraphNode[];
  edges: ReferralGraphEdge[];
  selectedNodeId: string | null;
  onSelectNode: (node: ReferralGraphNode) => void;
  fitRequestId: number;
  resetRequestId: number;
};

export const ReferralGraphCanvas = memo(function ReferralGraphCanvas({ nodes, edges, selectedNodeId, onSelectNode, fitRequestId, resetRequestId, getNodeAccessibilityLabel, nodeAmounts }: ReferralGraphCanvasProps) {
  const { fontScale } = useWindowDimensions();
  const positions = useMemo(() => buildReadableReferralGraphLayout(nodes, edges, fontScale), [edges, nodes, fontScale]);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [displayScale, setDisplayScale] = useState(1);
  const [renderCamera, setRenderCamera] = useState<ReferralGraphCameraSnapshot>({ scale: 1, panX: 0, panY: 0, width: 0, height: 0 });
  const [screenReaderEnabled, setScreenReaderEnabled] = useState(true);
  const [fitting, setFitting] = useState(false);
  const mounted = useRef(true);
  const scale = useSharedValue(1);
  const baseScale = useSharedValue(1);
  const panX = useSharedValue(0);
  const panY = useSharedValue(0);
  const startPanX = useSharedValue(0);
  const startPanY = useSharedValue(0);
  const pinchStartPanX = useSharedValue(0);
  const pinchStartPanY = useSharedValue(0);
  const pinchStartFocalX = useSharedValue(0);
  const pinchStartFocalY = useSharedValue(0);
  const pinchTouchCount = useSharedValue(0);
  const pinchActive = useSharedValue(false);
  const panActive = useSharedValue(false);
  const labelSettleSignal = useSharedValue(0);
  const lastViewport = useSharedValue(renderCamera);
  const viewportPending = useSharedValue(false);
  const fitGeneration = useSharedValue(0);
  const fitAnimating = useSharedValue(false);
  const fit = useMemo(() => getReadableReferralGraphViewport({ positions, ...canvasSize }), [positions, canvasSize]);
  const primitivePadding = useMemo(() => getReferralGraphPrimitivePadding(nodes, fontScale), [nodes, fontScale]);
  const contentPadding = REFERRAL_GRAPH_OVERSCAN + primitivePadding;
  const camera = useMemo(() => ({ scale, ...canvasSize, padding: contentPadding }),
    [scale, canvasSize, contentPadding]);
  const amountsByNodeId = useMemo(() => new Map(nodeAmounts?.map((amounts) => [amounts.nodeId, amounts])), [nodeAmounts]);
  const detailSizes = useMemo(() => new Map(nodes.flatMap((node) => {
    const amounts = amountsByNodeId.get(node.id);
    return amounts ? [[node.id, getReferralGraphNodeAmountMetrics(node.name, amounts, fontScale)] as const] : [];
  })), [nodes, amountsByNodeId, fontScale]);
  const labels = useMemo(() => buildReferralGraphLabels({ nodes, positions, scale: displayScale, selectedNodeId, fontScale, detailSizes }),
    [nodes, positions, displayScale, selectedNodeId, fontScale, detailSizes]);
  const visibleNodeLabels = useMemo(() => nodes.flatMap((node) => {
    const point = positions.get(node.id), placement = labels.get(node.id);
    if (!point || !placement) return [];
    const rect = getReferralGraphLabelRect(point, placement, displayScale, renderCamera);
    return isReferralGraphLabelVisible(rect, canvasSize.width, canvasSize.height, REFERRAL_GRAPH_OVERSCAN)
      ? [{ node, point, placement }] : [];
  }), [nodes, positions, labels, displayScale, renderCamera, canvasSize.width, canvasSize.height]);
  const { positionedNodes, edgePath } = useMemo(() => buildReferralGraphRenderSet({
    nodes, edges, positions, camera: renderCamera, primitivePadding,
    // Preserve every accessible node; brief fit animations also retain both views.
    renderAll: screenReaderEnabled || fitting,
  }), [nodes, edges, positions, renderCamera, primitivePadding, screenReaderEnabled, fitting]);

  const commitViewport = useCallback((next: ReferralGraphCameraSnapshot) => {
    if (!mounted.current) return;
    setRenderCamera((current) => current.scale === next.scale && current.panX === next.panX
      && current.panY === next.panY && current.width === next.width && current.height === next.height ? current : next);
  }, []);
  const finishFit = useCallback((next: ReferralGraphCameraSnapshot, generation: number, reflow = true) => {
    if (!mounted.current || fitGeneration.value !== generation) return;
    commitViewport(next);
    if (reflow) setDisplayScale(next.scale);
    setFitting(false);
  }, [commitViewport, fitGeneration]);
  const commitLabelScale = useCallback((nextScale: number) => {
    if (mounted.current) setDisplayScale(nextScale);
  }, []);
  const settleLabels = useCallback(() => {
    'worklet';
    cancelAnimation(labelSettleSignal);
    labelSettleSignal.value = 0;
    // Rapid successive drags/pinches keep one continuous layer. Reflow only after
    // a short idle window; starting another gesture cancels this on the UI thread.
    labelSettleSignal.value = withDelay(120, withTiming(1, { duration: 0 }, (finished) => {
      if (finished) runOnJS(commitLabelScale)(scale.value);
    }));
  }, [labelSettleSignal, scale, commitLabelScale]);

  useEffect(() => {
    // Acknowledge only committed React output. At most one bridge callback waits
    // for mounting; camera movement while JS is busy is coalesced into the next one.
    lastViewport.value = renderCamera;
    viewportPending.value = false;
  }, [lastViewport, renderCamera, viewportPending]);

  useEffect(() => {
    mounted.current = true;
    // Do not temporarily prune the accessibility tree while detection is pending.
    let changed = false;
    let active = true;
    void AccessibilityInfo.isScreenReaderEnabled().then((enabled) => {
      if (active && !changed) setScreenReaderEnabled(enabled);
    }).catch(() => { /* Keep the full accessibility tree if detection is unavailable. */ });
    const subscription = AccessibilityInfo.addEventListener('screenReaderChanged', (enabled) => {
      changed = true;
      if (mounted.current) setScreenReaderEnabled(enabled);
    });
    return () => {
      active = false;
      mounted.current = false;
      fitGeneration.value += 1;
      subscription.remove();
      cancelAnimation(scale);
      cancelAnimation(panX);
      cancelAnimation(panY);
      cancelAnimation(labelSettleSignal);
    };
  }, [scale, panX, panY, fitGeneration, labelSettleSignal]);

  useAnimatedReaction(
    () => ({ ready: !viewportPending.value, camera: { scale: scale.value, panX: panX.value, panY: panY.value, width: canvasSize.width, height: canvasSize.height } }),
    ({ ready, camera: next }) => {
      if (!ready || !shouldRefreshReferralGraphViewport(lastViewport.value, next, REFERRAL_GRAPH_OVERSCAN, 1.1, primitivePadding)) return;
      viewportPending.value = true;
      runOnJS(commitViewport)(next);
    },
  );
  const panLayerStyle = useAnimatedStyle(() => ({
    // Culling commits never change the coordinate origin of mounted children.
    transform: [{ translateX: panX.value }, { translateY: panY.value }],
  }));
  const labelLayerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: getReferralGraphLabelScale(scale.value, displayScale) }],
  }));
  const edgeProps = useAnimatedProps(() => ({
    // One native path update replaces one endpoint mapper per edge. Its geometry
    // stays in logical coordinates; only the bounded SVG viewport is rasterized.
    matrix: [scale.value, 0, 0, scale.value, canvasSize.width / 2 + panX.value, canvasSize.height / 2 + panY.value],
    strokeWidth: 1.4 / Math.max(scale.value, 0.000001),
  }));

  const applyFit = useCallback((animated: boolean) => {
    if (canvasSize.width <= 0 || canvasSize.height <= 0) return;
    cancelAnimation(labelSettleSignal);
    const generation = fitGeneration.value + 1;
    fitGeneration.value = generation;
    fitAnimating.value = animated;
    setFitting(animated);
    const target = { ...fit, ...canvasSize };
    if (!animated) commitViewport(target);
    scale.value = animated ? withTiming(fit.scale, { duration: 220 }, (finished) => {
      if (!finished || fitGeneration.value !== generation) return;
      fitAnimating.value = false;
      runOnJS(finishFit)({ scale: scale.value, panX: panX.value, panY: panY.value, width: canvasSize.width, height: canvasSize.height }, generation);
    }) : fit.scale;
    panX.value = animated ? withTiming(fit.panX, { duration: 220 }) : fit.panX;
    panY.value = animated ? withTiming(fit.panY, { duration: 220 }) : fit.panY;
    baseScale.value = fit.scale;
    if (!animated) setDisplayScale(fit.scale);
  }, [baseScale, canvasSize, fit, panX, panY, scale, commitViewport, finishFit, fitGeneration, fitAnimating, labelSettleSignal]);
  useEffect(() => { applyFit(fitRequestId > 0 || resetRequestId > 0); }, [applyFit, fitRequestId, resetRequestId]);
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setCanvasSize((current) => current.width === width && current.height === height ? current : { width: Math.max(1, width), height: Math.max(1, height) });
  }, []);

  const panGesture = useMemo(() => Gesture.Pan().maxPointers(1).minDistance(3)
    .onStart(() => {
      panActive.value = true;
      cancelAnimation(labelSettleSignal);
      if (fitAnimating.value) {
        fitAnimating.value = false;
        fitGeneration.value += 1;
        runOnJS(finishFit)({ scale: scale.value, panX: panX.value, panY: panY.value, width: canvasSize.width, height: canvasSize.height }, fitGeneration.value, false);
      }
      cancelAnimation(scale); cancelAnimation(panX); cancelAnimation(panY);
      startPanX.value = panX.value; startPanY.value = panY.value;
    })
    .onUpdate((event) => { panX.value = startPanX.value + event.translationX; panY.value = startPanY.value + event.translationY; })
    .onFinalize(() => {
      if (!panActive.value) return;
      panActive.value = false;
      if (!pinchActive.value) settleLabels();
    }),
  [scale, panX, panY, startPanX, startPanY, fitAnimating, fitGeneration, finishFit, canvasSize.width, canvasSize.height, panActive, pinchActive, labelSettleSignal, settleLabels]);
  const pinchGesture = useMemo(() => Gesture.Pinch()
    .onTouchesDown((event) => { pinchTouchCount.value = event.numberOfTouches; })
    .onTouchesUp((event) => { pinchTouchCount.value = event.numberOfTouches; })
    .onStart((event) => {
      pinchActive.value = true;
      cancelAnimation(labelSettleSignal);
      if (fitAnimating.value) {
        fitAnimating.value = false;
        fitGeneration.value += 1;
        runOnJS(finishFit)({ scale: scale.value, panX: panX.value, panY: panY.value, width: canvasSize.width, height: canvasSize.height }, fitGeneration.value, false);
      }
      cancelAnimation(scale); cancelAnimation(panX); cancelAnimation(panY);
      baseScale.value = scale.value;
      pinchStartPanX.value = panX.value;
      pinchStartPanY.value = panY.value;
      pinchStartFocalX.value = event.focalX - canvasSize.width / 2;
      pinchStartFocalY.value = event.focalY - canvasSize.height / 2;
    })
    .onUpdate((event) => {
      // Android's POINTER_UP update still counts the lifted pointer, but moves
      // its focal point to the remaining finger. Raw touch count excludes it.
      if (pinchTouchCount.value < 2 || event.numberOfPointers < 2) return;
      const nextScale = clampReadableReferralGraphScale(baseScale.value * event.scale, fit.scale);
      const ratio = nextScale / Math.max(baseScale.value, 0.000001);
      const focalOffsetX = event.focalX - canvasSize.width / 2;
      const focalOffsetY = event.focalY - canvasSize.height / 2;
      scale.value = nextScale;
      panX.value = focalOffsetX - ratio * (pinchStartFocalX.value - pinchStartPanX.value);
      panY.value = focalOffsetY - ratio * (pinchStartFocalY.value - pinchStartPanY.value);
    })
    .onFinalize(() => {
      pinchTouchCount.value = 0;
      // A one-finger pan also finalizes a failed pinch recognizer.
      if (!pinchActive.value) return;
      pinchActive.value = false;
      baseScale.value = scale.value;
      if (!panActive.value) settleLabels();
      const next = { scale: scale.value, panX: panX.value, panY: panY.value, width: canvasSize.width, height: canvasSize.height };
      runOnJS(commitViewport)(next);
    }),
  [baseScale, canvasSize.height, canvasSize.width, fit.scale, panX, panY, pinchStartFocalX, pinchStartFocalY, pinchStartPanX, pinchStartPanY, pinchTouchCount, scale, commitViewport, fitAnimating, fitGeneration, finishFit, pinchActive, panActive, labelSettleSignal, settleLabels]);
  const graphGesture = useMemo(() => Gesture.Simultaneous(panGesture, pinchGesture), [panGesture, pinchGesture]);

  return (
    <GestureDetector gesture={graphGesture}>
      <View style={styles.canvas} onLayout={handleLayout}
        accessibilityLabel="추천 관계 그래프. 한 손가락으로 이동하고 두 손가락으로 확대하거나 축소할 수 있습니다.">
        <View pointerEvents="none" style={styles.grid} />
        {/* Edges project into a bounded viewport bitmap, independently of logical graph size. */}
        <View pointerEvents="none" style={{ position: 'absolute', width: GRAPH_RENDER_SURFACE_SIZE, height: GRAPH_RENDER_SURFACE_SIZE,
          left: (canvasSize.width - GRAPH_RENDER_SURFACE_SIZE) / 2, top: (canvasSize.height - GRAPH_RENDER_SURFACE_SIZE) / 2,
          transform: [{ scaleX: Math.max(1, canvasSize.width) / GRAPH_RENDER_SURFACE_SIZE }, { scaleY: Math.max(1, canvasSize.height) / GRAPH_RENDER_SURFACE_SIZE }] }}>
          <Svg width={GRAPH_RENDER_SURFACE_SIZE} height={GRAPH_RENDER_SURFACE_SIZE}
            viewBox={['0', '0', Math.max(1, canvasSize.width), Math.max(1, canvasSize.height)].join(' ')} preserveAspectRatio="none">
            <AnimatedPath d={edgePath} animatedProps={edgeProps} fill="none" stroke="#cbd5e1" strokeLinecap="round" />
          </Svg>
        </View>
        <Animated.View pointerEvents="box-none" style={[styles.nodeContent, {
          left: -contentPadding, top: -contentPadding,
          width: canvasSize.width + contentPadding * 2, height: canvasSize.height + contentPadding * 2,
        }, panLayerStyle]}>
          {positionedNodes.map(({ node, point }) => <ReferralGraphNodeMarker key={node.id} node={node} point={point}
            getNodeAccessibilityLabel={getNodeAccessibilityLabel}
            selected={node.id === selectedNodeId} camera={camera} onSelectNode={onSelectNode} />)}
          <View pointerEvents="none" style={styles.nodeLabelLayer}>
            <Animated.View style={[StyleSheet.absoluteFillObject, labelLayerStyle]}>
              {visibleNodeLabels.map(({ node, point, placement }) => <ReferralGraphNodeLabel key={node.id} node={node} point={point}
                placement={placement} labelScale={displayScale} camera={camera} amounts={amountsByNodeId.get(node.id)} fontScale={fontScale} />)}
            </Animated.View>
          </View>
        </Animated.View>
        <View pointerEvents="none" style={styles.zoomBadge}><Text style={styles.zoomBadgeText}>{Math.round(displayScale * 100)}%</Text></View>
      </View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  canvas: { flex: 1, overflow: 'hidden', backgroundColor: '#f8fafc' },
  grid: { ...StyleSheet.absoluteFillObject, opacity: 0.55, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0' },
  nodeContent: { position: 'absolute', overflow: 'visible' },
  nodeAnchor: { position: 'absolute', left: 0, top: 0, width: REFERRAL_GRAPH_HIT_SIZE, height: REFERRAL_GRAPH_HIT_SIZE, overflow: 'visible' },
  nodeHitTarget: { width: REFERRAL_GRAPH_HIT_SIZE, height: REFERRAL_GRAPH_HIT_SIZE, borderRadius: REFERRAL_GRAPH_HIT_SIZE / 2 },
  nodeVisual: { ...StyleSheet.absoluteFillObject },
  nodeCircle: { position: 'absolute', borderWidth: 2.4, borderColor: '#ffffff' },
  selectedNodeRing: { position: 'absolute', borderWidth: 3, borderColor: '#2563eb' },
  nodeLabelLayer: { ...StyleSheet.absoluteFillObject, zIndex: 2 },
  nodeAmountCard: { position: 'absolute', paddingHorizontal: 6, paddingVertical: 4, backgroundColor: 'rgba(255, 255, 255, 0.96)', borderRadius: 5 },
  nodeAmountName: { color: '#334155', fontWeight: '700', includeFontPadding: false },
  nodeDirect: { color: '#475569', fontWeight: '600', fontVariant: ['tabular-nums'], includeFontPadding: false },
  nodeTotal: { color: '#d65a16', fontWeight: '700', fontVariant: ['tabular-nums'], includeFontPadding: false },
  nodeNegative: { color: '#ef4444' },
  nodeLabel: { position: 'absolute', left: 0, top: 0, color: '#334155', fontSize: 11, lineHeight: 14,
    fontWeight: '700', textAlign: 'center', includeFontPadding: false, textShadowColor: '#f8fafc',
    textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 3 },
  zoomBadge: { position: 'absolute', zIndex: 3, right: 12, bottom: 12, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(15, 23, 42, 0.72)' },
  zoomBadgeText: { color: '#ffffff', fontSize: 11, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
