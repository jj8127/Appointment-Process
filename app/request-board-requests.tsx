import { Feather } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomNavigation } from '@/components/BottomNavigation';
import { useSession } from '@/hooks/use-session';
import { resolveBottomNavActiveKey, resolveBottomNavPreset } from '@/lib/bottom-navigation';
import { logger } from '@/lib/logger';
import { rbGetRequestList, type RbRequestListItem } from '@/lib/request-board-api';
import { COLORS, RADIUS, SHADOWS, SPACING, TYPOGRAPHY } from '@/lib/theme';

/* ─── Helpers ─── */

const formatDate = (value: string) => {
  const d = new Date(value);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
};

const getProductNames = (req: RbRequestListItem): string => {
  const names = (req.request_products ?? [])
    .map((rp) => rp.insurance_products?.name)
    .filter(Boolean) as string[];
  return names.length > 0 ? names.join(', ') : '종목 없음';
};

type FilterKey = 'all' | 'pending' | 'in_progress' | 'completed' | 'review_pending';

const hasPendingReview = (req: RbRequestListItem) =>
  (req.request_designers ?? []).some(
    (d) => d.status === 'completed' && (d.fc_decision === 'pending' || d.fc_decision == null),
  );

const getFcDecisionMeta = (req: RbRequestListItem) => {
  const assignments = req.request_designers ?? [];
  const decisions = assignments.map((d) => d.fc_decision);
  const hasDesignerRejected = assignments.some((d) => d.status === 'rejected');
  const hasCancelled =
    req.status === 'cancelled' || assignments.some((d) => d.status === 'cancelled');

  if (decisions.includes('rejected')) {
    return { icon: 'thumbs-down' as const, text: 'FC 거절', color: '#DC2626' };
  }
  if (decisions.includes('accepted')) {
    return { icon: 'thumbs-up' as const, text: 'FC 승인', color: '#059669' };
  }

  const hasCompletedPending = assignments.some(
    (d) => d.status === 'completed' && (d.fc_decision === 'pending' || d.fc_decision == null),
  );
  if (hasCompletedPending) {
    return { icon: 'clock' as const, text: 'FC 검토대기', color: '#B45309' };
  }

  if (hasDesignerRejected) {
    return { icon: 'x-circle' as const, text: '설계 거절', color: '#DC2626' };
  }

  if (hasCancelled) {
    return { icon: 'slash' as const, text: '요청 취소', color: COLORS.gray[500] };
  }

  return { icon: 'minus-circle' as const, text: 'FC 미결정', color: COLORS.gray[500] };
};

const REQUEST_STATUS_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: '수락 대기', color: '#F59E0B', bg: '#FEF3C7' },
  in_progress: { label: '진행중', color: '#3B82F6', bg: '#EFF6FF' },
  completed: { label: '완료', color: '#10B981', bg: '#ECFDF5' },
  cancelled: { label: '취소', color: COLORS.gray[500], bg: COLORS.gray[100] },
};

/* ─── Component ─── */

export default function RequestBoardRequestsScreen() {
  const router = useRouter();
  const { filter } = useLocalSearchParams<{ filter?: string | string[] }>();
  const insets = useSafeAreaInsets();
  const { role, readOnly, hydrated, isRequestBoardDesigner } = useSession();

  const [requests, setRequests] = useState<RbRequestListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');

  useEffect(() => {
    const rawFilter = Array.isArray(filter) ? filter[0] : filter;
    const nextFilter = (() => {
      if (
        rawFilter === 'all' ||
        rawFilter === 'pending' ||
        rawFilter === 'in_progress' ||
        rawFilter === 'completed' ||
        rawFilter === 'review_pending'
      ) {
        return rawFilter;
      }
      return 'all';
    })();
    setActiveFilter(nextFilter);
  }, [filter]);

  const fetchData = useCallback(async () => {
    setFetchError(null);
    try {
      const data = await rbGetRequestList();
      setRequests(data);
    } catch (err) {
      logger.warn('[requests] fetch failed', err);
      setFetchError('의뢰 목록을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  /* ─── Derived ─── */
  const reviewPendingCount = useMemo(
    () => requests.filter(hasPendingReview).length,
    [requests],
  );
  const pendingCount = useMemo(
    () => requests.filter((r) => r.status === 'pending').length,
    [requests],
  );
  const inProgressCount = useMemo(
    () => requests.filter((r) => r.status === 'in_progress').length,
    [requests],
  );
  const completedCount = useMemo(
    () => requests.filter((r) => r.status === 'completed').length,
    [requests],
  );
  const countedTotal = useMemo(
    () => pendingCount + inProgressCount + completedCount,
    [pendingCount, inProgressCount, completedCount],
  );

  const filteredRequests = useMemo(() => {
    const sorted = [...requests].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    switch (activeFilter) {
      case 'pending':
        return sorted.filter((r) => r.status === 'pending');
      case 'review_pending':
        return sorted.filter(hasPendingReview);
      case 'in_progress':
        return sorted.filter((r) => r.status === 'in_progress');
      case 'completed':
        return sorted.filter((r) => r.status === 'completed');
      default:
        return sorted.filter(
          (r) => r.status === 'pending' || r.status === 'in_progress' || r.status === 'completed',
        );
    }
  }, [requests, activeFilter]);

  const FILTERS: { key: FilterKey; label: string; count?: number }[] = [
    { key: 'all', label: '전체', count: countedTotal },
    { key: 'pending', label: '수락 대기', count: pendingCount },
    { key: 'in_progress', label: '진행중', count: inProgressCount },
    { key: 'completed', label: '완료', count: completedCount },
    { key: 'review_pending', label: '검토 대기', count: reviewPendingCount },
  ];

  /* ─── Render ─── */
  const renderItem = ({ item }: { item: RbRequestListItem }) => {
    const isPendingReview = hasPendingReview(item);
    const statusInfo = REQUEST_STATUS_LABEL[item.status] ?? {
      label: item.status,
      color: COLORS.gray[500],
      bg: COLORS.gray[100],
    };
    const requestId = Number(item.id ?? (item as any).request_id ?? 0);
    const fcDecisionMeta = getFcDecisionMeta(item);

    return (
      <Pressable
        style={({ pressed }) => [
          styles.requestCard,
          isPendingReview && styles.requestCardHighlight,
          pressed && { opacity: 0.85 },
        ]}
        onPress={() => {
          if (!Number.isFinite(requestId) || requestId <= 0) {
            logger.warn('[requests] invalid request id', { rawId: item.id, rawRequestId: (item as any).request_id });
            Alert.alert('오류', '의뢰 상세 정보를 열 수 없습니다. 새로고침 후 다시 시도해주세요.');
            return;
          }
          router.push({ pathname: '/request-board-review' as any, params: { id: String(requestId) } });
        }}
      >
        {isPendingReview && (
          <View style={styles.reviewBadge}>
            <Feather name="eye" size={10} color="#fff" />
            <Text style={styles.reviewBadgeText}>검토 대기</Text>
          </View>
        )}
        <View style={styles.cardTop}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.customerName} numberOfLines={1}>
              {item.customer_name}
            </Text>
            <View style={[styles.statusBadge, { backgroundColor: statusInfo.bg }]}>
              <Text style={[styles.statusBadgeText, { color: statusInfo.color }]}>
                {statusInfo.label}
              </Text>
            </View>
          </View>
          <Text style={styles.productNames} numberOfLines={1}>
            {getProductNames(item)}
          </Text>
        </View>
        <View style={styles.cardBottom}>
          <View style={styles.cardMeta}>
            <Feather name="calendar" size={11} color={COLORS.gray[400]} />
            <Text style={styles.cardMetaText}>{formatDate(item.created_at)}</Text>
          </View>
          <View style={styles.cardMeta}>
            <Feather name={fcDecisionMeta.icon} size={11} color={fcDecisionMeta.color} />
            <Text style={[styles.cardMetaText, { color: fcDecisionMeta.color }]}>
              {fcDecisionMeta.text}
            </Text>
          </View>
          <View style={[styles.cardMeta, { marginLeft: 'auto' }]}>
            <Text style={[styles.cardMetaText, { color: COLORS.primary }]}>
              상세 보기
            </Text>
            <Feather name="chevron-right" size={11} color={COLORS.primary} />
          </View>
        </View>
      </Pressable>
    );
  };

  const navPreset = resolveBottomNavPreset({ role, readOnly, hydrated, isRequestBoardDesigner });
  const navActiveKey = resolveBottomNavActiveKey(navPreset, 'request-board');

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) + 4 }]}>
        <View style={styles.headerInner}>
          <Pressable
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
            onPress={() => router.back()}
          >
            <Feather name="arrow-left" size={20} color={COLORS.gray[700]} />
          </Pressable>
          <View style={styles.headerTitles}>
            <Text style={styles.headerTitle}>의뢰 목록</Text>
            <Text style={styles.headerSub}>설계 의뢰를 검토하고 승인하세요</Text>
          </View>
          {reviewPendingCount > 0 && (
            <View style={styles.pendingBadge}>
              <Text style={styles.pendingBadgeText}>{reviewPendingCount}</Text>
            </View>
          )}
        </View>

        {/* Filter tabs */}
        <View style={styles.filterTabs}>
          {FILTERS.map((f) => (
            <Pressable
              key={f.key}
              style={[styles.filterTab, activeFilter === f.key && styles.filterTabActive]}
              onPress={() => setActiveFilter(f.key)}
            >
              <Text
                style={[
                  styles.filterTabText,
                  activeFilter === f.key && styles.filterTabTextActive,
                ]}
              >
                {f.label}
              </Text>
              {(f.count ?? 0) > 0 && (
                <View
                  style={[
                    styles.filterTabCount,
                    activeFilter === f.key && styles.filterTabCountActive,
                    f.key === 'review_pending' && (f.count ?? 0) > 0 && styles.filterTabCountAlert,
                  ]}
                >
                  <Text
                    style={[
                      styles.filterTabCountText,
                      activeFilter === f.key && styles.filterTabCountTextActive,
                      f.key === 'review_pending' && (f.count ?? 0) > 0 && styles.filterTabCountTextAlert,
                    ]}
                  >
                    {f.count}
                  </Text>
                </View>
              )}
            </Pressable>
          ))}
        </View>
      </View>

      {/* Error */}
      {fetchError && (
        <View style={styles.errorBanner}>
          <Feather name="alert-circle" size={14} color={COLORS.error} />
          <Text style={styles.errorBannerText}>{fetchError}</Text>
        </View>
      )}

      {/* List */}
      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={COLORS.primary} />
          <Text style={styles.loadingText}>불러오는 중...</Text>
        </View>
      ) : filteredRequests.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Feather name="inbox" size={44} color={COLORS.gray[200]} />
          <Text style={styles.emptyText}>
            {activeFilter === 'review_pending' ? '검토 대기 의뢰가 없습니다' : '의뢰가 없습니다'}
          </Text>
          <Text style={styles.emptySubText}>
            {activeFilter !== 'all' ? '다른 필터를 선택해보세요' : '새 의뢰가 생기면 여기에 표시됩니다'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredRequests}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={[styles.listContent, { paddingBottom: 80 + insets.bottom }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={COLORS.primary}
            />
          }
          ItemSeparatorComponent={() => <View style={{ height: SPACING.sm }} />}
        />
      )}

      <BottomNavigation
        preset={navPreset ?? undefined}
        activeKey={navActiveKey}
        bottomInset={insets.bottom}
      />
    </View>
  );
}

/* ─── Styles ─── */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.gray[50] },

  /* Header */
  header: {
    backgroundColor: '#fff',
    paddingHorizontal: SPACING.base,
    paddingBottom: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
    ...SHADOWS.sm,
  },
  headerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitles: { flex: 1 },
  headerTitle: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontWeight: '800' as const,
    color: COLORS.gray[900],
  },
  headerSub: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    color: COLORS.text.muted,
    marginTop: 1,
  },
  pendingBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.error,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  pendingBadgeText: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontWeight: '700' as const,
    color: '#fff',
  },

  /* Filter tabs */
  filterTabs: {
    flexDirection: 'row',
    gap: SPACING.xs,
  },
  filterTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    backgroundColor: COLORS.gray[50],
  },
  filterTabActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  filterTabText: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontWeight: '600' as const,
    color: COLORS.gray[600],
  },
  filterTabTextActive: { color: '#fff' },
  filterTabCount: {
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: COLORS.gray[200],
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  filterTabCountActive: { backgroundColor: 'rgba(255,255,255,0.3)' },
  filterTabCountAlert: { backgroundColor: '#FEE2E2' },
  filterTabCountText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: COLORS.gray[600],
  },
  filterTabCountTextActive: { color: '#fff' },
  filterTabCountTextAlert: { color: COLORS.error },

  /* Error */
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    backgroundColor: '#FEE2E2',
    paddingHorizontal: SPACING.base,
    paddingVertical: SPACING.sm,
  },
  errorBannerText: {
    flex: 1,
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.error,
  },

  /* Loading / Empty */
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
  },
  loadingText: { fontSize: TYPOGRAPHY.fontSize.sm, color: COLORS.text.muted },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.xl,
  },
  emptyText: {
    fontSize: TYPOGRAPHY.fontSize.base,
    fontWeight: '600' as const,
    color: COLORS.gray[600],
    textAlign: 'center',
  },
  emptySubText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.text.muted,
    textAlign: 'center',
  },

  /* List */
  listContent: { padding: SPACING.base },

  /* Request card */
  requestCard: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    padding: SPACING.base,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    ...SHADOWS.sm,
    overflow: 'hidden',
  },
  requestCardHighlight: {
    borderColor: COLORS.primary,
    borderWidth: 1.5,
  },
  reviewBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderBottomLeftRadius: RADIUS.sm,
  },
  reviewBadgeText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: '#fff',
  },
  cardTop: { marginBottom: SPACING.sm },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
    marginBottom: 4,
  },
  customerName: {
    flex: 1,
    fontSize: TYPOGRAPHY.fontSize.base,
    fontWeight: '700' as const,
    color: COLORS.gray[900],
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  statusBadgeText: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontWeight: '700' as const,
  },
  productNames: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.text.muted,
  },
  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.gray[100],
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  cardMetaText: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    color: COLORS.gray[500],
  },
});
