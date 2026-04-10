import { Feather } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { COLORS, RADIUS, SPACING } from '@/lib/theme';

export type AncestorNode = {
  fcId: string;
  name: string | null;
  affiliation: string | null;
  code: string | null;
};

type Props = {
  ancestors: AncestorNode[]; // root → 직속 추천인 순서
  self: AncestorNode;
};

export function ReferralAncestorsChain({ ancestors, self }: Props) {
  if (ancestors.length === 0) {
    return (
      <View style={styles.emptyChain}>
        <Feather name="anchor" size={18} color={COLORS.gray[300]} />
        <Text style={styles.emptyChainText}>나를 추천한 사람이 없어요 (최상위 루트)</Text>
      </View>
    );
  }

  const chain: (AncestorNode & { isSelf?: boolean; isRoot?: boolean })[] = [
    { ...ancestors[0], isRoot: true },
    ...ancestors.slice(1),
    { ...self, isSelf: true },
  ];

  return (
    <View style={styles.container}>
      {chain.map((node, index) => (
        <View key={node.fcId} style={styles.nodeWrap}>
          {/* 연결선 */}
          {index > 0 && (
            <View style={styles.connectorRow}>
              <View style={styles.connectorLine} />
              <Feather name="chevron-down" size={12} color={COLORS.gray[300]} />
            </View>
          )}

          {/* 노드 카드 */}
          <View style={[styles.nodeCard, node.isSelf && styles.selfCard, node.isRoot && styles.rootCard]}>
            {/* 아바타 */}
            <View style={[styles.avatar, node.isSelf && styles.selfAvatar, node.isRoot && styles.rootAvatar]}>
              <Feather
                name={node.isRoot ? 'anchor' : 'user'}
                size={15}
                color={node.isSelf ? COLORS.white : node.isRoot ? COLORS.primary : COLORS.gray[500]}
              />
            </View>

            {/* 정보 */}
            <View style={styles.nodeInfo}>
              <View style={styles.nodeTopRow}>
                <Text
                  style={[styles.nodeName, node.isSelf && styles.selfName]}
                  numberOfLines={1}
                >
                  {node.name ?? '이름 없음'}
                  {node.isSelf ? <Text style={styles.selfLabel}> (나)</Text> : null}
                </Text>
                {node.isRoot && !node.isSelf && (
                  <View style={styles.rootBadge}>
                    <Text style={styles.rootBadgeText}>루트</Text>
                  </View>
                )}
              </View>
              {node.affiliation ? (
                <Text style={styles.nodeAffiliation} numberOfLines={1}>
                  {node.affiliation}
                </Text>
              ) : null}
            </View>

            {/* 추천 코드 */}
            {node.code ? (
              <View style={[styles.codeBadge, node.isSelf && styles.selfCodeBadge]}>
                <Text style={[styles.codeBadgeText, node.isSelf && styles.selfCodeBadgeText]}>
                  {node.code}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingVertical: SPACING.xs },

  emptyChain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: SPACING.md,
    backgroundColor: COLORS.gray[50],
    borderRadius: RADIUS.md,
  },
  emptyChainText: { fontSize: 13, color: COLORS.text.muted },

  nodeWrap: { alignItems: 'stretch' },

  connectorRow: {
    alignItems: 'center',
    paddingVertical: 2,
  },
  connectorLine: {
    width: 2,
    height: 8,
    backgroundColor: COLORS.gray[200],
    borderRadius: 1,
  },

  nodeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: COLORS.background.primary,
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border.light,
  },
  selfCard: {
    borderColor: COLORS.primary,
    borderWidth: 2,
    backgroundColor: COLORS.primaryPale,
  },
  rootCard: {
    borderColor: COLORS.border.medium,
    backgroundColor: COLORS.gray[50],
  },

  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  selfAvatar: { backgroundColor: COLORS.primary },
  rootAvatar: {
    backgroundColor: COLORS.primaryPale,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },

  nodeInfo: { flex: 1, minWidth: 0 },
  nodeTopRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  nodeName: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text.primary,
    flexShrink: 1,
  },
  selfName: { color: COLORS.primaryDark },
  selfLabel: { fontSize: 12, fontWeight: '400', color: COLORS.primary },
  nodeAffiliation: { fontSize: 11, color: COLORS.text.muted, marginTop: 2 },

  rootBadge: {
    backgroundColor: COLORS.primaryPale,
    borderRadius: RADIUS.full,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: COLORS.primary,
    flexShrink: 0,
  },
  rootBadgeText: { fontSize: 10, fontWeight: '700', color: COLORS.primary },

  codeBadge: {
    backgroundColor: COLORS.gray[100],
    borderRadius: RADIUS.sm,
    paddingHorizontal: 7,
    paddingVertical: 3,
    flexShrink: 0,
  },
  selfCodeBadge: { backgroundColor: 'rgba(243,111,33,0.15)' },
  codeBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.text.secondary,
    letterSpacing: 1.5,
  },
  selfCodeBadgeText: { color: COLORS.primaryDark },
});
