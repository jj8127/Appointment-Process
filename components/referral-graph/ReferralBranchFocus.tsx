import { Feather } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import { Animated, Easing, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { buildBranchShareSegments, formatBranchShare } from '@/lib/referral-branch-focus';
import { COLORS, RADIUS, SPACING, TOUCH_TARGET } from '@/lib/theme';

export type BranchFocusRow = {
  id: string;
  label: string;
  meta?: string;
  valueText: string;
  /** 비중 계산용 숫자(금액 또는 인원). 양수만 막대에 들어간다. */
  value: number;
  negative?: boolean;
  drillable: boolean;
  accessibilityLabel: string;
};

type Props = {
  path: { id: string; label: string }[];
  total: { label: string; valueText: string; negative?: boolean; accessibilityLabel: string };
  /** 합계가 어떻게 쌓였는지 한 줄(예: 본인 +1만 + 하위 가지 3개 +9만) */
  summary?: string;
  /** 합계 카드 오른쪽 위(예: 보기 전환) */
  accessory?: ReactElement | null;
  rows: BranchFocusRow[];
  listTitle: string;
  emptyText: string;
  onFocus: (id: string) => void;
  onOpen: (id: string) => void;
  onTotalPress?: () => void;
  /** 바깥 화면이 이미 여백을 주면 false */
  inset?: boolean;
};

/** 가지 색: 앞의 6개만 색을 주고 나머지는 회색(누적 막대의 "그 외"와 같은 색) */
export const BRANCH_COLORS = ['#f36f21', '#0d9488', '#3b82f6', '#8b5cf6', '#65a30d', '#db2777'] as const;
const REST_COLOR = '#cbd5e1';
/** 사용자 선호: 짧은 기본값보다 느리게 차오른다 */
const FILL_MS = 640;

export function ReferralBranchFocus({ path, total, summary, accessory, rows, listTitle, emptyText, onFocus, onOpen, onTotalPress, inset = true }: Props) {
  const focusId = path[path.length - 1]?.id ?? '';
  const { segments, shareOf } = useMemo(() => buildBranchShareSegments(rows), [rows]);
  const colorOf = useMemo(() => {
    const map = new Map(segments.filter((segment) => segment.id).map((segment) => [segment.id!, BRANCH_COLORS[segment.colorIndex]]));
    return (id: string) => map.get(id) ?? REST_COLOR;
  }, [segments]);

  // 기준을 바꿀 때마다 막대가 왼쪽에서부터 차오른다
  const fill = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    fill.setValue(0);
    const animation = Animated.timing(fill, { toValue: 1, duration: FILL_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [focusId, fill]);
  const grow = { transform: [{ scaleX: fill }], transformOrigin: 'left' as const };

  const header = <View style={styles.header}>
    {path.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.crumbs}
      accessibilityLabel="보고 있는 가지 경로">
      {path.map((crumb, index) => {
        const last = index === path.length - 1;
        return <View key={crumb.id} style={styles.crumbItem}>
          {index > 0 ? <Feather name="chevron-right" size={14} color={COLORS.text.muted} /> : null}
          <Pressable disabled={last} onPress={() => onFocus(crumb.id)} accessibilityRole="button"
            accessibilityState={{ selected: last }} style={[styles.crumb, last && styles.crumbCurrent]}>
            <Text style={[styles.crumbText, last && styles.crumbTextCurrent]} numberOfLines={1}>{crumb.label}</Text>
          </Pressable>
        </View>;
      })}
    </ScrollView> : null}

    <View style={styles.totalCard}>
      <View style={styles.totalTop}>
        <Pressable style={styles.totalPress} onPress={onTotalPress} disabled={!onTotalPress}
          accessibilityRole={onTotalPress ? 'button' : 'summary'} accessibilityLabel={total.accessibilityLabel}>
          <Text style={styles.totalLabel} numberOfLines={1}>{total.label}</Text>
          <Text style={[styles.totalValue, total.negative && styles.negative]} numberOfLines={1} adjustsFontSizeToFit>{total.valueText}</Text>
        </Pressable>
        {accessory ?? null}
      </View>
      {summary ? <Text style={styles.summary}>{summary}</Text> : null}
      {segments.length ? <View style={styles.stack} accessibilityRole="image"
        accessibilityLabel={`가지별 비중: ${segments.map((segment) => {
          const row = segment.id ? rows.find((item) => item.id === segment.id) : null;
          return `${row ? row.label : '그 외'} ${formatBranchShare(segment.share)}`;
        }).join(', ')}`}>
        <Animated.View style={[styles.stackFill, grow]}>
          {segments.map((segment) => <View key={segment.id ?? 'rest'}
            style={{ flex: segment.share, backgroundColor: segment.id ? BRANCH_COLORS[segment.colorIndex] : REST_COLOR }} />)}
        </Animated.View>
      </View> : null}
    </View>

    <View style={styles.listHeading}><Text style={styles.listTitle}>{listTitle}</Text>
      <Text style={styles.listCount}>{rows.length.toLocaleString('ko-KR')}명</Text></View>
  </View>;

  return <FlatList data={rows} keyExtractor={(row) => row.id} contentContainerStyle={[styles.list, !inset && styles.listFlush]}
    initialNumToRender={12} maxToRenderPerBatch={12} windowSize={5}
    ListHeaderComponent={header}
    ListEmptyComponent={<Text style={styles.empty}>{emptyText}</Text>}
    renderItem={({ item }) => {
      const share = shareOf(item.value);
      return <Pressable style={({ pressed }) => [styles.row, pressed && styles.rowPressed]} accessibilityRole="button"
        accessibilityLabel={`${item.accessibilityLabel}${share > 0 ? `, 비중 ${formatBranchShare(share)}` : ''}`}
        accessibilityHint={item.drillable ? '이 사람을 기준으로 아래 가지를 봅니다' : '상세 내역을 엽니다'}
        onPress={() => item.drillable ? onFocus(item.id) : onOpen(item.id)} onLongPress={() => onOpen(item.id)}>
        <View style={styles.rowMain}>
          <View style={styles.rowTop}>
            <View style={[styles.dot, { backgroundColor: colorOf(item.id) }]} />
            <Text style={styles.rowLabel} numberOfLines={1}>{item.label}</Text>
            <Text style={[styles.rowValue, item.negative && styles.negative]} numberOfLines={1}>{item.valueText}</Text>
          </View>
          <View style={styles.rowBottom}>
            <View style={styles.track}>
              <Animated.View style={[styles.trackFill, grow, { width: `${share * 100}%`, backgroundColor: colorOf(item.id) }]} />
            </View>
            <Text style={styles.share}>{formatBranchShare(share)}</Text>
          </View>
          {item.meta ? <Text style={styles.rowMeta} numberOfLines={1}>{item.meta}</Text> : null}
        </View>
        <Feather name={item.drillable ? 'chevron-right' : 'info'} size={17} color={COLORS.text.secondary} />
      </Pressable>;
    }} />;
}

const styles = StyleSheet.create({
  list: { padding: SPACING.md, paddingBottom: 32 },
  listFlush: { padding: 0, paddingBottom: 32 },
  header: { gap: 12, paddingBottom: 8 },
  crumbs: { alignItems: 'center', gap: 2 },
  crumbItem: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  crumb: { minHeight: TOUCH_TARGET.min, justifyContent: 'center', paddingHorizontal: 10, borderRadius: RADIUS.full },
  crumbCurrent: { backgroundColor: COLORS.primaryPale },
  crumbText: { fontSize: 13, color: COLORS.text.secondary, fontWeight: '600', maxWidth: 120 },
  crumbTextCurrent: { color: COLORS.primaryDark, fontWeight: '700' },
  totalCard: { backgroundColor: COLORS.white, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border.light, padding: 16, gap: 10 },
  totalTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  totalPress: { flex: 1, minWidth: 0, gap: 2 },
  totalLabel: { fontSize: 13, fontWeight: '700', color: COLORS.text.secondary },
  totalValue: { fontSize: 28, fontWeight: '800', color: COLORS.text.primary, fontVariant: ['tabular-nums'] },
  summary: { fontSize: 13, lineHeight: 20, color: COLORS.text.secondary, fontVariant: ['tabular-nums'] },
  stack: { height: 14, borderRadius: 7, backgroundColor: COLORS.border.light, overflow: 'hidden' },
  stackFill: { flex: 1, flexDirection: 'row' },
  listHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  listTitle: { fontSize: 15, fontWeight: '700', color: COLORS.text.primary },
  listCount: { fontSize: 13, fontWeight: '700', color: COLORS.primaryDark },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.white, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border.light, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 8, minHeight: 64 },
  rowPressed: { backgroundColor: COLORS.primaryPale },
  rowMain: { flex: 1, minWidth: 0, gap: 6 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  rowLabel: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '700', color: COLORS.text.primary },
  rowValue: { fontSize: 16, fontWeight: '800', color: COLORS.text.primary, fontVariant: ['tabular-nums'] },
  rowBottom: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  track: { flex: 1, height: 6, borderRadius: 3, backgroundColor: COLORS.border.light, overflow: 'hidden' },
  trackFill: { height: 6, borderRadius: 3 },
  share: { width: 36, textAlign: 'right', fontSize: 12, fontWeight: '700', color: COLORS.text.secondary, fontVariant: ['tabular-nums'] },
  rowMeta: { fontSize: 12, color: COLORS.text.secondary },
  negative: { color: COLORS.error },
  empty: { fontSize: 13, color: COLORS.text.secondary, textAlign: 'center', paddingVertical: 16 },
});
