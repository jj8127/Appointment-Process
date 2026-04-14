import { Feather } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { COLORS, RADIUS, SPACING } from '@/lib/theme';

type DirectRecommenderSummary = {
  name: string | null;
  affiliation: string | null;
  code: string | null;
};

type Props = {
  recommender: DirectRecommenderSummary | null;
};

export function ReferralDirectRecommenderCard({ recommender }: Props) {
  if (!recommender) {
    return (
      <View style={styles.emptyState}>
        <Feather name="user-x" size={24} color={COLORS.gray[300]} />
        <Text style={styles.emptyTitle}>아직 등록된 추천인이 없어요</Text>
        <Text style={styles.emptyDesc}>
          추천 코드를 입력하면 여기에 직접 추천인 1명이 표시됩니다.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.avatar}>
        <Feather name="user-check" size={16} color={COLORS.primary} />
      </View>
      <View style={styles.content}>
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={1}>
            {recommender.name ?? '이름 없음'}
          </Text>
          {recommender.affiliation ? (
            <Text style={styles.affiliation} numberOfLines={1}>
              {recommender.affiliation}
            </Text>
          ) : null}
        </View>
        <View style={styles.metaColumn}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>직접 추천인</Text>
          </View>
          {recommender.code ? (
            <View style={styles.codeBadge}>
              <Text style={styles.codeText}>{recommender.code}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    padding: SPACING.sm,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.background.secondary,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primaryPale,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  info: { flex: 1, minWidth: 0 },
  name: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text.primary,
  },
  affiliation: {
    fontSize: 12,
    color: COLORS.text.secondary,
    marginTop: 2,
  },
  metaColumn: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 6,
    flexShrink: 0,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.primaryPale,
    flexShrink: 0,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.primary,
  },
  codeBadge: {
    minWidth: 96,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.gray[100],
    alignItems: 'center',
    flexShrink: 0,
  },
  codeText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.text.secondary,
    letterSpacing: 1,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: SPACING.xl,
    gap: SPACING.xs,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text.secondary,
  },
  emptyDesc: {
    fontSize: 12,
    color: COLORS.text.muted,
    textAlign: 'center',
    lineHeight: 18,
  },
});
