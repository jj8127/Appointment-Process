import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import BrandedLoadingSpinner from '@/components/BrandedLoadingSpinner';
import { COLORS, RADIUS, SPACING } from '@/lib/theme';

export type DescendantNode = {
  fcId: string;
  parentFcId: string | null;
  name: string | null;
  affiliation: string | null;
  code: string | null;
  directInviteeCount: number;
  totalDescendantCount: number;
  depth: number;
  relationshipSource: 'linked';
};

type Props = {
  node: DescendantNode;
  depth?: number;
  expanded: boolean;
  isLoadingExpand: boolean;
  onToggle: (fcId: string) => void;
  expandedIds: Set<string>;
  loadingIds: Set<string>;
  allNodes: DescendantNode[];
};

const MAX_VISUAL_DEPTH = 5;

export function ReferralTreeNode({
  node,
  depth = 0,
  expanded,
  isLoadingExpand,
  onToggle,
  expandedIds,
  loadingIds,
  allNodes,
}: Props) {
  const hasChildren = node.directInviteeCount > 0 || node.totalDescendantCount > 0;
  const directChildren = allNodes.filter((n) => n.parentFcId === node.fcId);
  const indent = Math.min(depth, MAX_VISUAL_DEPTH) * 14;
  const hasLoadedChildren = directChildren.length > 0;
  const highlightTopLevel = depth === 0;

  return (
    <View>
      <Pressable
        onPress={hasChildren ? () => onToggle(node.fcId) : undefined}
        style={({ pressed }) => [
          styles.nodeRow,
          { paddingLeft: SPACING.sm + indent },
          pressed && hasChildren && styles.nodeRowPressed,
        ]}
        accessibilityRole={hasChildren ? 'button' : 'text'}
        accessibilityState={{ expanded }}
        accessibilityLabel={`${node.name ?? '이름 없음'}, 직속 ${node.directInviteeCount}명`}
      >
        {/* 깊이 인디케이터 선 */}
        {depth > 0 && (
          <View
            style={[
              styles.depthLine,
              { left: SPACING.sm + (indent - 14) + 6 },
            ]}
          />
        )}

        {/* Chevron / 로딩 / Leaf dot */}
        <View style={styles.chevronWrap}>
          {isLoadingExpand ? (
            <BrandedLoadingSpinner size="sm" color={COLORS.primary} />
          ) : hasChildren ? (
            <Feather
              name={expanded ? 'chevron-down' : 'chevron-right'}
              size={16}
              color={COLORS.gray[400]}
            />
          ) : (
            <View style={styles.leafDot} />
          )}
        </View>

        {/* 아바타 */}
        <View style={[styles.avatar, highlightTopLevel && styles.avatarDepth1]}>
          <Feather
            name="user"
            size={13}
            color={highlightTopLevel ? COLORS.primary : COLORS.gray[400]}
          />
        </View>

        {/* 정보 영역 */}
        <View style={styles.infoWrap}>
          <Text style={[styles.nodeName, highlightTopLevel && styles.nodeNameDepth1]} numberOfLines={1}>
            {node.name ?? '이름 없음'}
          </Text>
          {node.affiliation ? (
            <Text style={styles.nodeAffiliation} numberOfLines={1}>
              {node.affiliation}
            </Text>
          ) : null}
          {hasChildren ? (
            <Text style={styles.countText}>
              직속 {node.directInviteeCount}명
              {node.totalDescendantCount > node.directInviteeCount
                ? ` · 전체 ${node.totalDescendantCount}명`
                : ''}
            </Text>
          ) : null}
        </View>

        {/* 추천 코드 */}
        {node.code ? (
          <View style={styles.codeBadge}>
            <Text style={styles.codeBadgeText}>{node.code}</Text>
          </View>
        ) : null}
      </Pressable>

      {/* 자식 노드 (재귀) */}
      {expanded && hasLoadedChildren && (
        <View>
          {directChildren.map((child) => (
            <ReferralTreeNode
              key={child.fcId}
              node={child}
              depth={depth + 1}
              expanded={expandedIds.has(child.fcId)}
              isLoadingExpand={loadingIds.has(child.fcId)}
              onToggle={onToggle}
              expandedIds={expandedIds}
              loadingIds={loadingIds}
              allNodes={allNodes}
            />
          ))}
        </View>
      )}

      {/* 펼쳤지만 아직 로드 안 됨 — 하위 인원만 안내 */}
      {expanded && !hasLoadedChildren && node.totalDescendantCount > 0 && (
        <View style={[styles.moreHint, { paddingLeft: SPACING.sm + indent + 36 }]}>
          <Feather name="more-horizontal" size={14} color={COLORS.gray[300]} />
          <Text style={styles.moreHintText}>
            하위 {node.totalDescendantCount}명 더 있음
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  nodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: SPACING.sm,
    paddingVertical: 10,
    borderRadius: RADIUS.md,
    gap: 8,
    position: 'relative',
  },
  nodeRowPressed: { backgroundColor: COLORS.gray[50] },

  depthLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: COLORS.gray[100],
    borderRadius: 1,
  },

  chevronWrap: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  leafDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: COLORS.gray[300],
  },

  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarDepth1: {
    backgroundColor: COLORS.primaryPale,
  },

  infoWrap: { flex: 1, minWidth: 0 },
  nodeName: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text.primary,
  },
  nodeNameDepth1: {
    fontSize: 14,
    color: COLORS.text.primary,
  },
  nodeAffiliation: { fontSize: 11, color: COLORS.text.muted, marginTop: 1 },
  countText: { fontSize: 11, color: COLORS.info, marginTop: 2 },

  codeBadge: {
    backgroundColor: COLORS.gray[100],
    borderRadius: RADIUS.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    flexShrink: 0,
  },
  codeBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.text.secondary,
    letterSpacing: 1,
  },

  moreHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
  },
  moreHintText: { fontSize: 11, color: COLORS.text.muted, fontStyle: 'italic' },
});
