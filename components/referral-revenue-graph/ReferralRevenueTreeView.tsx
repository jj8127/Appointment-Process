import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';

import { formatSampleRevenueKrw } from '@/lib/referral-revenue-demo';
import {
  getSampleRevenueTreeCanvasHeight,
  getSampleRevenueTreeConnector,
  getSampleRevenueTreeNodePosition,
  SAMPLE_REVENUE_TREE_CANVAS_WIDTH,
  SAMPLE_REVENUE_TREE_NODE_HEIGHT,
  SAMPLE_REVENUE_TREE_NODE_WIDTH,
} from '@/lib/referral-revenue-tree-layout';
import { COLORS, RADIUS, SHADOWS, TOUCH_TARGET } from '@/lib/theme';
import type {
  SampleRevenueGraphEdge,
  SampleRevenueGraphNode,
} from '@/types/referral-revenue-graph';

type Props = {
  nodes: SampleRevenueGraphNode[];
  edges: SampleRevenueGraphEdge[];
  focusedNodeIds?: ReadonlySet<string>;
  selectedNodeId?: string | null;
  onSelectNode: (node: SampleRevenueGraphNode) => void;
};

export function ReferralRevenueTreeView({
  nodes,
  edges,
  focusedNodeIds,
  selectedNodeId,
  onSelectNode,
}: Props) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const height = getSampleRevenueTreeCanvasHeight(nodes);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator
      contentContainerStyle={styles.horizontalContent}
      accessibilityLabel="샘플 매출 기여 트리"
    >
      <View
        style={[
          styles.canvas,
          { width: SAMPLE_REVENUE_TREE_CANVAS_WIDTH, height },
        ]}
      >
        <Svg
          width={SAMPLE_REVENUE_TREE_CANVAS_WIDTH}
          height={height}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {edges.map((edge) => {
            const sourceNode = nodeById.get(edge.source);
            const targetNode = nodeById.get(edge.target);
            if (!sourceNode || !targetNode) return null;

            const connector = getSampleRevenueTreeConnector(
              sourceNode,
              targetNode,
            );
            const excluded = !targetNode.eligible && targetNode.depth > 0;
            const isContextEdge = Boolean(
              focusedNodeIds && !focusedNodeIds.has(edge.target),
            );

            return (
              <Line
                key={edge.id}
                {...connector}
                stroke={
                  excluded || isContextEdge
                    ? COLORS.gray[300]
                    : COLORS.primaryLight
                }
                strokeWidth={excluded || isContextEdge ? 1.5 : 2}
                strokeDasharray={excluded ? '5 5' : undefined}
              />
            );
          })}
        </Svg>

        {nodes.map((node) => {
          const position = getSampleRevenueTreeNodePosition(node);
          const isViewer = node.isViewer;
          const excluded = !node.eligible && !isViewer;
          const isContext = Boolean(
            focusedNodeIds && !focusedNodeIds.has(node.id),
          );
          const selected = selectedNodeId === node.id;
          const amountLabel = isViewer
            ? '기준'
            : excluded
              ? '대상 제외'
              : `예상 ${formatSampleRevenueKrw(node.expectedAllocationKrw)}`;
          const accessibilityStatus = isContext
            ? `${amountLabel}, 연결 경로`
            : amountLabel;

          return (
            <Pressable
              key={node.id}
              onPress={() => onSelectNode(node)}
              disabled={isViewer || isContext}
              style={({ pressed }) => [
                styles.node,
                { left: position.x, top: position.y },
                isViewer && styles.viewerNode,
                excluded && styles.excludedNode,
                isContext && styles.contextNode,
                selected && styles.selectedNode,
                pressed && !isViewer && !isContext && styles.pressed,
              ]}
              accessibilityRole={isViewer || isContext ? 'text' : 'button'}
              accessibilityLabel={`${node.name}, ${node.depth}단계, ${accessibilityStatus}`}
              accessibilityHint={
                isViewer || isContext
                  ? undefined
                  : '샘플 매출과 예상 배분 상세를 엽니다'
              }
              accessibilityState={{
                disabled: isViewer || isContext,
                selected,
              }}
            >
              <View style={styles.nodeTopRow}>
                <Text
                  style={styles.nodeName}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.72}
                  maxFontSizeMultiplier={1.2}
                >
                  {node.name}
                </Text>
                <View style={[styles.depthBadge, excluded && styles.excludedBadge]}>
                  <Text
                    style={[styles.depthText, excluded && styles.excludedText]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.72}
                    maxFontSizeMultiplier={1.2}
                  >
                    {node.depth}단계
                  </Text>
                </View>
              </View>
              <Text
                style={[styles.amount, excluded && styles.excludedText]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.72}
                maxFontSizeMultiplier={1.2}
              >
                {amountLabel}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  horizontalContent: {
    minWidth: '100%',
  },
  canvas: {
    position: 'relative',
    backgroundColor: COLORS.background.primary,
  },
  node: {
    position: 'absolute',
    width: SAMPLE_REVENUE_TREE_NODE_WIDTH,
    height: Math.max(SAMPLE_REVENUE_TREE_NODE_HEIGHT, TOUCH_TARGET.min),
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderWidth: 1.5,
    borderColor: COLORS.primaryLight,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.white,
    ...SHADOWS.sm,
  },
  viewerNode: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryPale,
  },
  excludedNode: {
    borderColor: COLORS.gray[300],
    borderStyle: 'dashed',
    backgroundColor: COLORS.gray[50],
  },
  contextNode: {
    opacity: 0.48,
  },
  selectedNode: {
    borderColor: COLORS.info,
    borderWidth: 2,
  },
  pressed: {
    opacity: 0.68,
  },
  nodeTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  nodeName: {
    flex: 1,
    color: COLORS.text.primary,
    fontSize: 12,
    fontWeight: '800',
  },
  depthBadge: {
    minWidth: 34,
    minHeight: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.primaryPale,
  },
  excludedBadge: {
    backgroundColor: COLORS.gray[200],
  },
  depthText: {
    color: COLORS.primaryDark,
    fontSize: 9,
    fontWeight: '800',
  },
  excludedText: {
    color: COLORS.text.muted,
  },
  amount: {
    marginTop: 7,
    color: COLORS.primaryDark,
    fontSize: 10,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
