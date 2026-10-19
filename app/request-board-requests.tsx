import { Feather } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { REQUEST_PROGRESS_TONE, RequestProgressSteps } from '@/components/RequestProgressSteps';
import { summarizeRequestProgress } from '@/lib/request-board-progress';

import BrandedLoadingState from '@/components/BrandedLoadingState';
import { BottomNavigation } from '@/components/BottomNavigation';
import { useBottomNavAnimation } from '@/hooks/use-bottom-nav-animation';
import { useSession } from '@/hooks/use-session';
import { resolveBottomNavActiveKey, resolveBottomNavPreset } from '@/lib/bottom-navigation';
import { logger } from '@/lib/logger';
import {
  rbGetRequestDetail,
  rbGetRequestListOrThrow,
  type RbRequestListItem,
} from '@/lib/request-board-api';
import {
  getRequestBoardPrimaryStatus,
  requestBoardListHasBucket,
  type RequestBoardListFilterKey,
} from '@/lib/request-board-list-filters';
import { formatRequestBoardFcDisplayName } from '@/lib/request-board-fc-identity';
import { formatRequestBoardCustomerDisplayName } from '@/lib/request-board-policyholder-display';
import {
  getDesignerRejectionSummary,
  mergeDesignerRejectionReasonFromDetail,
  requestNeedsDesignerRejectionReasonHydration,
} from '@/lib/request-board-rejection-summary';
import { toRequestBoardSessionErrorMessage } from '@/lib/request-board-session-error';
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

const formatRequestBoardPhone = (value?: string | null) => {
  const digits = String(value ?? '').replace(/[^0-9]/g, '');
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  return String(value ?? '').trim() || '-';
};

const formatDesignCodeDisplay = (codeValue?: unknown, fallbackName?: unknown): string | null => {
  const value = String(codeValue ?? '').trim();
  if (value) return value;
  const fallback = String(fallbackName ?? '').trim();
  return fallback || null;
};

const getRequestDesignCodeDisplay = (req: RbRequestListItem): string | null => {
  const assignmentCode = (req.request_designers ?? [])
    .map((assignment) => formatDesignCodeDisplay(assignment.fc_code_value, assignment.fc_code_name))
    .find((value): value is string => Boolean(value));
  return assignmentCode ?? formatDesignCodeDisplay(req.fc_code_value, req.fc_code_name);
};

const getRequestFcContactSummary = (
  request: RbRequestListItem,
  designCode?: string | null,
): string | null => {
  const rawName = String(request.fc?.name ?? '').trim();
  const fcName = rawName
    ? formatRequestBoardFcDisplayName(request.fc?.name, request.fc?.affiliation)
    : null;
  const phone = formatRequestBoardPhone(request.fc?.phone);
  const parts = [
    fcName ? `요청 FC: ${fcName}` : null,
    designCode ? `설계 코드: ${designCode}` : null,
    phone !== '-' ? `전화번호: ${phone}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
};
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

const hydrateDesignerRejectionReasons = async (
  listItems: RbRequestListItem[],
): Promise<RbRequestListItem[]> => {
  const targets = listItems.filter(requestNeedsDesignerRejectionReasonHydration);
  if (targets.length === 0) {
    return listItems;
  }

  const detailResults = await Promise.all(
    targets.map(async (request) => {
      const detail = await rbGetRequestDetail(request.id);
      return { requestId: request.id, detail };
    }),
  );

  const detailsByRequestId = new Map<number, Awaited<ReturnType<typeof rbGetRequestDetail>>>();
  for (const result of detailResults) {
    detailsByRequestId.set(result.requestId, result.detail);
  }

  return listItems.map((request) =>
    mergeDesignerRejectionReasonFromDetail(request, detailsByRequestId.get(request.id)),
  );
};

/* ─── Component ─── */

export default function RequestBoardRequestsScreen() {
  const router = useRouter();
  const { filter } = useLocalSearchParams<{ filter?: string | string[] }>();
  const insets = useSafeAreaInsets();
  const { scrollHandler, animatedStyle } = useBottomNavAnimation();
  const { role, readOnly, hydrated, isRequestBoardDesigner, ensureRequestBoardSession } = useSession();

  const [requests, setRequests] = useState<RbRequestListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<RequestBoardListFilterKey>('all');
  const requestSequenceRef = useRef(0);

  useEffect(() => () => {
    requestSequenceRef.current += 1;
  }, []);

  useEffect(() => {
    const rawFilter = Array.isArray(filter) ? filter[0] : filter;
    const nextFilter = (() => {
      if (
        rawFilter === 'all' ||
        rawFilter === 'pending' ||
        rawFilter === 'in_progress' ||
        rawFilter === 'completed' ||
        rawFilter === 'cancelled' ||
        rawFilter === 'review_pending'
      ) {
        return rawFilter;
      }
      return 'all';
    })();
    setActiveFilter(nextFilter);
  }, [filter]);

  const fetchData = useCallback(async () => {
    if (!hydrated) {
      return;
    }
    const requestSequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestSequence;
    setFetchError(null);
    try {
      const sync = await ensureRequestBoardSession();
      if (!sync.ok) {
        throw new Error(sync.error ?? '가람Link 세션 동기화에 실패했습니다.');
      }

      const data = await rbGetRequestListOrThrow();
      if (requestSequence !== requestSequenceRef.current) return;
      setRequests(data);

      setTimeout(() => {
        void hydrateDesignerRejectionReasons(data)
          .then((hydratedData) => {
            if (requestSequence === requestSequenceRef.current) {
              setRequests(hydratedData);
            }
          })
          .catch((error) => {
            if (requestSequence !== requestSequenceRef.current) return;
            logger.warn('[requests] rejection-reason hydration failed', error);
            setFetchError(
              toRequestBoardSessionErrorMessage(
                error,
                '의뢰의 설계 거절 사유를 불러오지 못했습니다.',
              ),
            );
          });
      }, 0);
    } catch (err) {
      if (requestSequence !== requestSequenceRef.current) return;
      logger.warn('[requests] fetch failed', err);
      setFetchError(
        toRequestBoardSessionErrorMessage(err, '의뢰 목록을 불러오는데 실패했습니다.'),
      );
    } finally {
      if (requestSequence === requestSequenceRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [ensureRequestBoardSession, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    fetchData();
  }, [fetchData, hydrated]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  /* ─── Derived ─── */
  const reviewPendingCount = useMemo(
    () => requests.filter((r) => requestBoardListHasBucket(r, 'review_pending', isRequestBoardDesigner)).length,
    [isRequestBoardDesigner, requests],
  );
  const pendingCount = useMemo(
    () => requests.filter((r) => requestBoardListHasBucket(r, 'pending', isRequestBoardDesigner)).length,
    [isRequestBoardDesigner, requests],
  );
  const inProgressCount = useMemo(
    () => requests.filter((r) => requestBoardListHasBucket(r, 'in_progress', isRequestBoardDesigner)).length,
    [isRequestBoardDesigner, requests],
  );
  const completedCount = useMemo(
    () => requests.filter((r) => requestBoardListHasBucket(r, 'completed', isRequestBoardDesigner)).length,
    [isRequestBoardDesigner, requests],
  );
  const cancelledCount = useMemo(
    () => requests.filter((r) => requestBoardListHasBucket(r, 'cancelled', isRequestBoardDesigner)).length,
    [isRequestBoardDesigner, requests],
  );
  const countedTotal = useMemo(
    () => requests.filter((r) => requestBoardListHasBucket(r, 'all', isRequestBoardDesigner)).length,
    [isRequestBoardDesigner, requests],
  );

  const filteredRequests = useMemo(() => {
    const sorted = [...requests].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    return sorted.filter((r) => requestBoardListHasBucket(r, activeFilter, isRequestBoardDesigner));
  }, [activeFilter, isRequestBoardDesigner, requests]);

  const FILTERS: { key: RequestBoardListFilterKey; label: string; count?: number }[] = [
    { key: 'all', label: '전체', count: countedTotal },
    { key: 'pending', label: '수락 대기', count: pendingCount },
    { key: 'in_progress', label: '진행중', count: inProgressCount },
    { key: 'completed', label: '완료', count: completedCount },
    { key: 'cancelled', label: '거절·취소', count: cancelledCount },
    { key: 'review_pending', label: '검토 대기', count: reviewPendingCount },
  ];

  /* ─── Render ─── */
  const renderItem = ({ item }: { item: RbRequestListItem }) => {
    const isPendingReview = requestBoardListHasBucket(item, 'review_pending', isRequestBoardDesigner);
    const primaryStatus = getRequestBoardPrimaryStatus(item, isRequestBoardDesigner);
    const statusInfo = REQUEST_STATUS_LABEL[primaryStatus] ?? {
      label: primaryStatus,
      color: COLORS.gray[500],
      bg: COLORS.gray[100],
    };
    const requestId = Number(item.id ?? (item as any).request_id ?? 0);
    const fcDecisionMeta = getFcDecisionMeta(item);
    const designCodeDisplay = getRequestDesignCodeDisplay(item);
    const fcContactSummary = getRequestFcContactSummary(item, designCodeDisplay);
    const fcMeta = fcDecisionMeta;
    const progress = summarizeRequestProgress(item.request_designers, isRequestBoardDesigner ? 'designer' : 'fc');
    const progressTone = progress ? REQUEST_PROGRESS_TONE[progress.tone] : null;
    const designerRejectionSummary = getDesignerRejectionSummary(item);
    const customerName = String(item.customer_name ?? '').trim();
    const policyholderName = String(item.policyholder_name ?? '').trim();
    const hasSeparatePolicyholder = !!item.has_separate_policyholder;
    const fallbackCustomerDisplayName =
      String(item.customer_display_name ?? '').trim() ||
      formatRequestBoardCustomerDisplayName({
        customerName: item.customer_name,
        hasSeparatePolicyholder: item.has_separate_policyholder,
        policyholderName: item.policyholder_name,
      });
    const customerDisplayName = hasSeparatePolicyholder && customerName
      ? customerName
      : fallbackCustomerDisplayName;
    const separatePolicyholderSummary = hasSeparatePolicyholder
      ? [
          customerName ? `피보험자: ${customerName}` : null,
          policyholderName ? `계약자: ${policyholderName}` : '계약자: 정보 확인 필요',
        ]
          .filter(Boolean)
          .join(' · ')
      : null;
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
        <View style={styles.cardTop}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.customerName} numberOfLines={1}>
              {customerDisplayName}
            </Text>
            <View style={styles.badgeColumn}>
              {isPendingReview && !progress && (
                <View style={styles.reviewStatusBadge}>
                  <Feather name="eye" size={10} color="#fff" />
                  <Text style={styles.reviewStatusBadgeText}>검토 대기</Text>
                </View>
              )}
              <View style={[styles.statusBadge, { backgroundColor: progressTone?.background ?? statusInfo.bg }]}>
                <Text style={[styles.statusBadgeText, { color: progressTone?.color ?? statusInfo.color }]}>
                  {progress?.label ?? statusInfo.label}
                </Text>
              </View>
            </View>
          </View>
          {separatePolicyholderSummary ? (
            <View style={styles.requestPolicyholderRow}>
              <View style={styles.requestPolicyholderBadge}>
                <Feather name="user" size={14} color="#92400E" />
                <Text style={styles.requestPolicyholderBadgeText}>계약자 다름</Text>
              </View>
              <Text style={styles.requestPolicyholderText} numberOfLines={1}>
                {separatePolicyholderSummary}
              </Text>
            </View>
          ) : null}
          <Text style={styles.productNames} numberOfLines={1}>
            {getProductNames(item)}
          </Text>
          {progress ? (
            <View style={styles.progressBlock}>
              <RequestProgressSteps step={progress.step} tone={progress.tone} />
              <View style={styles.progressMetaRow}>
                <Text style={[styles.turnText, progress.isMyTurn && styles.turnTextMine]}>
                  {progress.turnLabel}
                </Text>
                {progress.manager ? (
                  <Text style={styles.managerText} numberOfLines={1}>
                    담당 {progress.manager}{progress.others > 0 ? ` 외 ${progress.others}명` : ''}
                  </Text>
                ) : null}
              </View>
            </View>
          ) : null}
          {fcContactSummary ? (
            <View style={styles.requestFcSummaryRow}>
              <Feather name="user" size={11} color={COLORS.primary} />
              <Text style={styles.requestFcSummaryText} numberOfLines={2}>
                {fcContactSummary}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={styles.cardBottom}>
          <View style={styles.cardMeta}>
            <Feather name="calendar" size={11} color={COLORS.gray[400]} />
            <Text style={styles.cardMetaText}>{formatDate(item.created_at)}</Text>
          </View>
          {!progress ? (
            <View style={styles.cardMeta}>
              <Feather name={fcMeta.icon} size={11} color={fcMeta.color} />
              <Text style={[styles.cardMetaText, { color: fcMeta.color }]} numberOfLines={1}>
                {fcMeta.text}
              </Text>
            </View>
          ) : null}
          <View style={[styles.cardMeta, { marginLeft: 'auto' }]}>
            <Text style={[styles.cardMetaText, { color: COLORS.primary }]}>
              상세 보기
            </Text>
            <Feather name="chevron-right" size={11} color={COLORS.primary} />
          </View>
        </View>
        {designerRejectionSummary ? (
          <View style={styles.rejectionReasonBox}>
            <Text style={styles.rejectionReasonLabel}>
              {designerRejectionSummary.label}
            </Text>
            <Text style={styles.rejectionReasonText} numberOfLines={2}>
              {designerRejectionSummary.reason}
            </Text>
          </View>
        ) : null}
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
          <Pressable accessibilityLabel="뒤로 가기" accessibilityRole="button"
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
            onPress={() => router.back()}
          >
            <Feather name="arrow-left" size={20} color={COLORS.gray[700]} />
          </Pressable>
          <View style={styles.headerTitles}>
            <Text style={styles.headerTitle}>의뢰 목록</Text>
            <Text style={styles.headerSub}>설계 의뢰를 검토하고 승인하세요</Text>
          </View>
        </View>

        {/* One summary in the app's orange tone: what waits on the manager, and what waits on me. */}
        <View style={styles.summaryStrip}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`설계매니저 수락 대기 ${pendingCount}건`}
            style={({ pressed }) => [styles.summaryHalf, pressed && styles.summaryCardPressed]}
            onPress={() => setActiveFilter('pending')}
          >
            <Text style={styles.summaryLabel}>매니저 수락 대기</Text>
            <Text style={styles.summaryValue}>{pendingCount}<Text style={styles.summaryUnit}>건</Text></Text>
          </Pressable>
          <View style={styles.summaryDivider} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`내 검토 대기 ${reviewPendingCount}건`}
            style={({ pressed }) => [styles.summaryHalf, pressed && styles.summaryCardPressed]}
            onPress={() => setActiveFilter('review_pending')}
          >
            <Text style={styles.summaryLabel}>내 검토 대기</Text>
            <Text style={[styles.summaryValue, reviewPendingCount > 0 && styles.summaryValueAlert]}>
              {reviewPendingCount}<Text style={styles.summaryUnit}>건</Text>
            </Text>
          </Pressable>
        </View>

        {/* Filter tabs */}
        <ScrollView
          style={styles.filterTabs}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterTabsContent}
        >
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
        </ScrollView>
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
          <BrandedLoadingState variant="request-board-requests" layout="section" />
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
        <Animated.FlatList
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
          onScroll={scrollHandler}
          scrollEventThrottle={16}
        />
      )}

      <BottomNavigation
        preset={navPreset ?? undefined}
        activeKey={navActiveKey}
        animatedStyle={animatedStyle}
        bottomInset={insets.bottom}
      />
    </View>
  );
}

/* ─── Styles ─── */
const styles = StyleSheet.create({
  summaryStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.md,
    borderRadius: 18,
    backgroundColor: COLORS.primaryPale,
  },
  summaryHalf: { flex: 1, paddingHorizontal: 18, paddingVertical: 14, gap: 2 },
  summaryDivider: { width: 1, alignSelf: 'stretch', marginVertical: 14, backgroundColor: '#fed7aa' },
  summaryUnit: { fontSize: 14, fontWeight: '700' as const, color: COLORS.gray[600] },
  summaryValueAlert: { color: COLORS.primaryButton },
  progressBlock: { marginTop: 10, gap: 8 },
  progressMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  turnText: { fontSize: 13, fontWeight: '700', color: COLORS.gray[600] },
  turnTextMine: { color: COLORS.primaryButton },
  managerText: { flex: 1, textAlign: 'right', fontSize: 12, color: COLORS.gray[500] },
  container: { flex: 1, backgroundColor: '#f3f4f6' },

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
    width: 44,
    height: 44,
    borderRadius: 22,
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
  summaryCardPressed: {
    opacity: 0.85,
  },
  summaryLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: '#9a3412',
  },
  summaryValue: {
    fontSize: 22,
    fontWeight: '800' as const,
    color: COLORS.gray[900],
    fontVariant: ['tabular-nums'],
  },

  /* Filter tabs */
  filterTabs: {
    marginHorizontal: -SPACING.base,
  },
  filterTabsContent: {
    flexDirection: 'row',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.base,
    paddingRight: SPACING.base * 2,
  },
  filterTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: COLORS.gray[100],
  },
  filterTabActive: { backgroundColor: COLORS.primaryButton },
  filterTabText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: COLORS.gray[700],
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
  filterTabCountAlert: { backgroundColor: COLORS.primaryPale },
  filterTabCountText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: COLORS.gray[600],
  },
  filterTabCountTextActive: { color: '#fff' },
  filterTabCountTextAlert: { color: COLORS.primaryButton },

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
  cardTop: { marginBottom: SPACING.sm },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
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
  badgeColumn: {
    alignItems: 'flex-end',
    gap: 6,
    flexShrink: 0,
  },
  reviewStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  reviewStatusBadgeText: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontWeight: '700' as const,
    color: '#fff',
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
  requestPolicyholderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
    minWidth: 0,
  },
  requestPolicyholderBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    flexShrink: 0,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FCD34D',
  },
  requestPolicyholderBadgeText: {
    fontSize: TYPOGRAPHY.fontSize['2xs'],
    fontWeight: '800' as const,
    color: '#92400E',
  },
  requestPolicyholderText: {
    flex: 1,
    minWidth: 0,
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontWeight: '700' as const,
    color: '#92400E',
  },
  productNames: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.text.muted,
  },
  requestFcSummaryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
    marginTop: 6,
    minWidth: 0,
  },
  requestFcSummaryText: {
    flex: 1,
    minWidth: 0,
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontWeight: '800' as const,
    lineHeight: 17,
    color: COLORS.primary,
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
  // Same treatment as the appointment screens: neutral box, red edge and label, readable reason.
  rejectionReasonBox: {
    marginTop: SPACING.sm,
    padding: 12,
    borderRadius: 12,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.error,
    backgroundColor: COLORS.gray[50],
  },
  rejectionReasonLabel: {
    fontSize: 12,
    fontWeight: '800' as const,
    color: '#B91C1C',
    marginBottom: 4,
  },
  rejectionReasonText: {
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.gray[800],
  },
});
