import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppTopActionBar } from '@/components/AppTopActionBar';
import { BottomNavigation } from '@/components/BottomNavigation';
import { useSession } from '@/hooks/use-session';
import { resolveBottomNavActiveKey, resolveBottomNavPreset } from '@/lib/bottom-navigation';
import { logger } from '@/lib/logger';
import {
  rbGetRequestList,
  rbGetRequests,
  type RbRequestListItem,
  type RbRequestSummary,
} from '@/lib/request-board-api';
import { supabase } from '@/lib/supabase';
import { COLORS, RADIUS, SHADOWS, SPACING, TYPOGRAPHY } from '@/lib/theme';
import { buildWelcomeTitle } from '@/lib/welcome-title';

/* ─── Constants ─── */

const YOUTUBE_URL = 'https://youtu.be/Otu7hc2trfY?si=4sby6Qt9OtTB06GM';
const SCREEN_WIDTH = Dimensions.get('window').width;
const CARD_GAP = 10;
const REQUEST_BOARD_WEB_URL = (
  process.env.EXPO_PUBLIC_REQUEST_BOARD_URL || 'https://requestboard-steel.vercel.app'
).replace(/\/$/, '');

const REQUEST_BOARD_CATEGORY_PREFIX = 'request_board_';

type NotificationItem = {
  id: string;
  title: string;
  body: string;
  category?: string | null;
  created_at?: string | null;
};

/* ─── Helpers ─── */

const CATEGORY_CONFIG: Record<
  string,
  { label: string; icon: keyof typeof Feather.glyphMap; color: string; bg: string }
> = {
  request_board_new_request: { label: '의뢰 도착', icon: 'inbox', color: '#3B82F6', bg: '#EFF6FF' },
  request_board_accepted: { label: '수락', icon: 'check-circle', color: '#10B981', bg: '#D1FAE5' },
  request_board_rejected: { label: '거절', icon: 'x-circle', color: '#EF4444', bg: '#FEE2E2' },
  request_board_completed: { label: '설계 완료', icon: 'award', color: '#8B5CF6', bg: '#EDE9FE' },
  request_board_cancelled: { label: '취소', icon: 'slash', color: '#6B7280', bg: '#F3F4F6' },
  'request_board_fc-accepted': { label: 'FC 승인', icon: 'thumbs-up', color: '#059669', bg: '#D1FAE5' },
  'request_board_fc-rejected': { label: 'FC 거절', icon: 'thumbs-down', color: '#DC2626', bg: '#FEE2E2' },
  request_board_message: { label: '메시지', icon: 'message-circle', color: '#F59E0B', bg: '#FEF3C7' },
};

const getCategoryLabel = (category: string): string => {
  const normalized = category.trim().toLowerCase();
  return CATEGORY_CONFIG[normalized]?.label ?? '알림';
};

const getCategoryIcon = (category: string): keyof typeof Feather.glyphMap => {
  const normalized = category.trim().toLowerCase();
  return CATEGORY_CONFIG[normalized]?.icon ?? 'bell';
};

const getCategoryColor = (category: string): string => {
  const normalized = category.trim().toLowerCase();
  return CATEGORY_CONFIG[normalized]?.color ?? COLORS.primary;
};

const formatRelativeTime = (dateStr: string): string => {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diff = now - date;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  return new Date(dateStr).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
};

/* ─── Types ─── */

type ReqStats = {
  loaded: boolean;
  // FC view
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  // Designer view
  completedThisMonth: number;
  avgDays: number;
};

type RequestListFilter = 'all' | 'pending' | 'in_progress' | 'completed';

const DEFAULT_REQ_STATS: ReqStats = {
  loaded: false,
  total: 0,
  pending: 0,
  inProgress: 0,
  completed: 0,
  completedThisMonth: 0,
  avgDays: 0,
};

/* ─── Helpers ─── */

function computeReqStats(
  requests: (RbRequestSummary | RbRequestListItem)[],
  isDesigner: boolean,
): Omit<ReqStats, 'loaded'> {
  const normalizeStatus = (raw?: string | null): string => {
    const status = String(raw ?? '').trim().toLowerCase();
    if (!status) return '';
    if (status === 'accepted' || status === 'in-progress' || status === 'inprogress') {
      return 'in_progress';
    }
    return status;
  };
  const countUniqueProducts = (request: RbRequestSummary | RbRequestListItem): number => {
    if (!('request_products' in request) || !request.request_products) return 0;
    const ids = new Set(
      request.request_products
        .map((rp) => String(rp.product_id ?? '').trim())
        .filter((id) => id.length > 0),
    );
    return ids.size;
  };

  const assignmentStatusToBucket = (status: string): 'pending' | 'in_progress' | 'completed' | null => {
    if (status === 'pending') return 'pending';
    if (status === 'accepted' || status === 'in_progress') return 'in_progress';
    if (status === 'completed') return 'completed';
    return null;
  };

  // FC/본부장/총무 뷰는 가람Link Matrix와 동일하게 배정 상태(request_designers)로 집계한다.
  if (!isDesigner) {
    let pending = 0;
    let inProgress = 0;
    let completed = 0;

    requests.forEach((request) => {
      const productCount = countUniqueProducts(request);
      if (productCount <= 0) return;

      const assignments = request.request_designers ?? [];
      assignments.forEach((assignment) => {
        const status = normalizeStatus(assignment.status);
        if (status === 'rejected' || status === 'cancelled') return;
        const bucket = assignmentStatusToBucket(status);
        if (!bucket) return;
        if (bucket === 'pending') pending += productCount;
        if (bucket === 'in_progress') inProgress += productCount;
        if (bucket === 'completed') completed += productCount;
      });
    });

    const total = pending + inProgress + completed;
    return {
      total,
      pending,
      inProgress,
      completed,
      completedThisMonth: completed,
      avgDays: 0,
    };
  }

  // 설계매니저 뷰는 배정 상태(assignmentStatus)를 우선 사용
  const getStatus = (r: RbRequestSummary) =>
    normalizeStatus(isDesigner ? (r.assignmentStatus ?? r.status ?? '') : (r.status ?? r.assignmentStatus ?? ''));

  const now = new Date();

  const pending = requests.filter((r) => getStatus(r) === 'pending').length;
  const inProgress = requests.filter((r) => getStatus(r) === 'in_progress').length;
  const completedAll = requests.filter((r) => getStatus(r) === 'completed');
  const completed = completedAll.length;
  // 대시보드 카드에서 노출하는 3개 상태(대기/진행/완료) 합계와 동일하게 맞춘다.
  const total = pending + inProgress + completed;

  const completedThisMonth = completedAll.filter((r) => {
    const d = new Date(r.completedAt ?? r.completed_at ?? '');
    return (
      !isNaN(d.getTime()) &&
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth()
    );
  }).length;

  const avgDays =
    completedAll.length > 0
      ? Math.round(
          (completedAll.reduce(
            (s, r) => s + Number(r.processingDays ?? r.processing_days ?? 0),
            0,
          ) /
            completedAll.length) *
            10,
        ) / 10
      : 0;

  return { total, pending, inProgress, completed, completedThisMonth, avgDays };
}

/* ─── Component ─── */

export default function RequestBoardScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { role, residentId, displayName, hydrated, isRequestBoardDesigner, requestBoardRole, readOnly, logout } = useSession();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reqStats, setReqStats] = useState<ReqStats>(DEFAULT_REQ_STATS);
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);
  const homeHeaderTitle = buildWelcomeTitle({
    role,
    readOnly,
    isRequestBoardDesigner,
    displayName,
    fallbackTitle: '홈',
  });

  const navPreset = resolveBottomNavPreset({
    role,
    readOnly,
    hydrated,
    isRequestBoardDesigner,
  });
  const navActiveKey = resolveBottomNavActiveKey(navPreset, 'request-board');

  // 설계 매니저가 아니면서 request_board를 FC로 사용하는 모든 사용자
  // (FC 역할 + 본부장/manager 브릿지 계정이 FC로 매핑된 경우)
  const isRbFcUser =
    !isRequestBoardDesigner && (!!requestBoardRole || role === 'fc');
  const showStats = reqStats.loaded && (isRbFcUser || !!isRequestBoardDesigner);

  /* ─── Data fetch ─── */
  const fetchData = useCallback(async () => {
    const inboxRole: 'admin' | 'fc' | null = role;
    if (!inboxRole) return;

    await Promise.allSettled([
      // Notifications from fc-notify
      (async () => {
        try {
          const { data, error } = await supabase.functions.invoke('fc-notify', {
            body: {
              type: 'inbox_list',
              role: inboxRole,
              resident_id: residentId ?? null,
              limit: 100,
            },
          });
          if (error) throw error;
          if (!data?.ok) throw new Error(data?.message ?? '데이터 로드 실패');

          const rbNotifs: NotificationItem[] = (data.notifications ?? [])
            .filter(
              (n: any) =>
                (n.category ?? '').trim().toLowerCase().startsWith(REQUEST_BOARD_CATEGORY_PREFIX),
            )
            .sort(
              (a: any, b: any) =>
                new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime(),
            );

          setNotifications(rbNotifs);
        } catch (err) {
          logger.warn('request-board notifications fetch failed', err);
        }
      })(),

      // Unread notification count (same contract as home header bell)
      (async () => {
        try {
          const lastCheck = await AsyncStorage.getItem('lastNotificationCheckTime');
          const lastCheckDate = lastCheck ? new Date(lastCheck) : new Date(0);
          const { data, error } = await supabase.functions.invoke('fc-notify', {
            body: {
              type: 'inbox_unread_count',
              role: inboxRole,
              resident_id: residentId ?? null,
              since: lastCheckDate.toISOString(),
            },
          });
          if (error) throw error;
          if (!data?.ok) throw new Error(data?.message ?? '미확인 알림 조회 실패');
          setUnreadNotifCount(Number(data.count ?? 0));
        } catch (err) {
          logger.warn('request-board unread notification count fetch failed', err);
          setUnreadNotifCount(0);
        }
      })(),

      // Request stats from request_board API (FC, 본부장, 총무 and Designer views)
      (async () => {
        // skip if user has no request_board access at all
        if (!isRequestBoardDesigner && !requestBoardRole && role !== 'fc') return;
        try {
          const requests = isRequestBoardDesigner
            ? await rbGetRequests()
            : await rbGetRequestList();
          const computed = computeReqStats(requests, !!isRequestBoardDesigner);
          setReqStats({ loaded: true, ...computed });
        } catch (err) {
          logger.warn('request-board stats fetch failed', err);
        }
      })(),
    ]);

    setLoading(false);
    setRefreshing(false);
  }, [role, residentId, requestBoardRole, isRequestBoardDesigner]);

  useEffect(() => {
    if (hydrated) fetchData();
  }, [hydrated, fetchData]);

  useFocusEffect(
    useCallback(() => {
      if (hydrated) {
        void fetchData();
      }
    }, [hydrated, fetchData]),
  );

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const recentNotifs = notifications.slice(0, 3);

  /* ─── Actions ─── */
  const openYoutube = async () => {
    try {
      await Linking.openURL(YOUTUBE_URL);
    } catch (err) {
      logger.warn('Failed to open YouTube', err);
    }
  };

  const openMessenger = () => {
    router.push('/request-board-messenger' as any);
  };

  const openFcCodes = () => {
    router.push('/request-board-fc-codes' as any);
  };

  const openRequests = (filter: RequestListFilter = 'all') => {
    router.push({
      pathname: '/request-board-requests' as any,
      params: { filter },
    } as any);
  };

  const openNotifications = () => {
    router.push('/notifications');
  };

  const handleLogout = () => {
    logout();
  };

  const copyRequestBoardUrl = async () => {
    try {
      await Clipboard.setStringAsync(REQUEST_BOARD_WEB_URL);
      Alert.alert('복사 완료', '가람Link 주소를 복사했습니다.');
    } catch (err) {
      logger.warn('failed to copy request_board url', err);
      Alert.alert('복사 실패', '주소 복사 중 오류가 발생했습니다.');
    }
  };

  const handleNotifPress = (item: NotificationItem) => {
    const catKey = (item.category ?? '').trim().toLowerCase();
    const isMessage = catKey === 'request_board_message';
    Alert.alert(
      item.title,
      item.body,
      [
        { text: '닫기', style: 'cancel' },
        ...(isMessage ? [{ text: '메신저 열기', onPress: openMessenger }] : []),
      ],
    );
  };

  /* ─── Render ─── */
  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <AppTopActionBar
        title={homeHeaderTitle}
        onLogout={handleLogout}
        onOpenNotifications={openNotifications}
        notificationCount={unreadNotifCount}
      />
      <View style={styles.pageTitleWrap}>
        <Text style={styles.pageTitle}>설계 요청</Text>
        <Text style={styles.pageSubtitle}>의뢰 현황과 알림을 한눈에</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 80 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.primary} />
        }
      >
        {/* Quick Actions */}
        <MotiView
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 400 }}
        >
          <View style={styles.actionsRow}>
            <Pressable
              style={({ pressed }) => [styles.actionCard, pressed && styles.actionCardPressed]}
              onPress={copyRequestBoardUrl}
            >
              <View style={[styles.actionIconWrap, { backgroundColor: '#10B981' }]}>
                <Feather name="link" size={20} color="#fff" />
              </View>
              <Text style={styles.actionLabel}>가람Link{'\n'}주소 복사</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.actionCard, pressed && styles.actionCardPressed]}
              onPress={openYoutube}
            >
              <View style={[styles.actionIconWrap, { backgroundColor: '#EF4444' }]}>
                <Feather name="youtube" size={20} color="#fff" />
              </View>
              <Text style={styles.actionLabel}>사용법{'\n'}가이드</Text>
            </Pressable>
          </View>
        </MotiView>

        {/* Request Stats */}
        {showStats && (
          <MotiView
            from={{ opacity: 0, translateY: 12 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 400, delay: 80 }}
          >
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>의뢰 현황</Text>
              <View style={styles.reqStatsGrid}>
                {isRequestBoardDesigner ? (
                  <>
                    <Pressable
                      style={({ pressed }) => [
                        styles.reqStatCard,
                        { borderLeftColor: '#F59E0B' },
                        pressed && styles.reqStatCardPressed,
                      ]}
                      onPress={() => openRequests('pending')}
                    >
                      <Text style={[styles.reqStatValue, { color: '#F59E0B' }]}>{reqStats.pending}</Text>
                      <Text style={styles.reqStatLabel}>수락 대기중</Text>
                      <Text style={styles.reqStatDesc}>빠른 확인 필요</Text>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [
                        styles.reqStatCard,
                        { borderLeftColor: '#3B82F6' },
                        pressed && styles.reqStatCardPressed,
                      ]}
                      onPress={() => openRequests('in_progress')}
                    >
                      <Text style={[styles.reqStatValue, { color: '#3B82F6' }]}>{reqStats.inProgress}</Text>
                      <Text style={styles.reqStatLabel}>작업중인 의뢰</Text>
                      <Text style={styles.reqStatDesc}>
                        평균 {reqStats.avgDays}일 경과
                      </Text>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [
                        styles.reqStatCard,
                        { borderLeftColor: '#10B981' },
                        pressed && styles.reqStatCardPressed,
                      ]}
                      onPress={() => openRequests('completed')}
                    >
                      <Text style={[styles.reqStatValue, { color: '#10B981' }]}>{reqStats.completed}</Text>
                      <Text style={styles.reqStatLabel}>완료 의뢰</Text>
                      <Text style={styles.reqStatDesc}>누적 완료 의뢰</Text>
                    </Pressable>
                    <View style={[styles.reqStatCard, { borderLeftColor: '#8B5CF6' }]}>
                      <Text style={[styles.reqStatValue, { color: '#8B5CF6' }]}>{reqStats.avgDays}<Text style={styles.reqStatUnit}>일</Text></Text>
                      <Text style={styles.reqStatLabel}>평균 처리 시간</Text>
                      <Text style={styles.reqStatDesc}>완료 의뢰 기준</Text>
                    </View>
                  </>
                ) : (
                  <>
                    <Pressable
                      style={({ pressed }) => [
                        styles.reqStatCard,
                        { borderLeftColor: COLORS.primary },
                        pressed && styles.reqStatCardPressed,
                      ]}
                      onPress={() => openRequests('all')}
                    >
                      <Text style={[styles.reqStatValue, { color: COLORS.primary }]}>{reqStats.total}</Text>
                      <Text style={styles.reqStatLabel}>전체 의뢰건수</Text>
                      <Text style={styles.reqStatDesc}>누적 의뢰</Text>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [
                        styles.reqStatCard,
                        { borderLeftColor: '#F59E0B' },
                        pressed && styles.reqStatCardPressed,
                      ]}
                      onPress={() => openRequests('pending')}
                    >
                      <Text style={[styles.reqStatValue, { color: '#F59E0B' }]}>{reqStats.pending}</Text>
                      <Text style={styles.reqStatLabel}>수락 대기중</Text>
                      <Text style={styles.reqStatDesc}>설계 매니저 수락 대기</Text>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [
                        styles.reqStatCard,
                        { borderLeftColor: '#3B82F6' },
                        pressed && styles.reqStatCardPressed,
                      ]}
                      onPress={() => openRequests('in_progress')}
                    >
                      <Text style={[styles.reqStatValue, { color: '#3B82F6' }]}>{reqStats.inProgress}</Text>
                      <Text style={styles.reqStatLabel}>진행중인 의뢰</Text>
                      <Text style={styles.reqStatDesc}>처리 중</Text>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [
                        styles.reqStatCard,
                        { borderLeftColor: '#10B981' },
                        pressed && styles.reqStatCardPressed,
                      ]}
                      onPress={() => openRequests('completed')}
                    >
                      <Text style={[styles.reqStatValue, { color: '#10B981' }]}>{reqStats.completed}</Text>
                      <Text style={styles.reqStatLabel}>완료 의뢰</Text>
                      <Text style={styles.reqStatDesc}>완료된 의뢰</Text>
                    </Pressable>
                  </>
                )}
              </View>
            </View>
          </MotiView>
        )}

        {/* FC Links */}
        {isRbFcUser && (
          <MotiView
            from={{ opacity: 0, translateY: 12 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 400, delay: 120 }}
          >
            <View style={styles.section}>
              <Pressable
                style={({ pressed }) => [styles.codeManageCard, pressed && { opacity: 0.7 }]}
                onPress={() => openRequests()}
              >
                <View style={[styles.codeManageIcon, { backgroundColor: '#EDE9FE' }]}>
                  <Feather name="clipboard" size={20} color="#7C3AED" />
                </View>
                <View style={styles.codeManageText}>
                  <Text style={styles.codeManageTitle}>의뢰 목록 · 검토</Text>
                  <Text style={styles.codeManageDesc}>설계 완료 건 승인 및 파일 확인</Text>
                </View>
                <Feather name="chevron-right" size={18} color={COLORS.gray[400]} />
              </Pressable>
              <View style={{ height: SPACING.sm }} />
              <Pressable
                style={({ pressed }) => [styles.codeManageCard, pressed && { opacity: 0.7 }]}
                onPress={openFcCodes}
              >
                <View style={styles.codeManageIcon}>
                  <Feather name="tag" size={20} color={COLORS.primary} />
                </View>
                <View style={styles.codeManageText}>
                  <Text style={styles.codeManageTitle}>설계코드 관리</Text>
                  <Text style={styles.codeManageDesc}>보험회사별 FC 코드 등록 및 관리</Text>
                </View>
                <Feather name="chevron-right" size={18} color={COLORS.gray[400]} />
              </Pressable>
            </View>
          </MotiView>
        )}

        {/* Recent Activity Feed */}
        <MotiView
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 400, delay: 200 }}
        >
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>최근 활동</Text>
              {notifications.length > 3 && (
                <Pressable onPress={openNotifications}>
                  <Text style={styles.seeAll}>전체보기</Text>
                </Pressable>
              )}
            </View>

            {loading ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator color={COLORS.primary} />
              </View>
            ) : recentNotifs.length === 0 ? (
              <View style={styles.emptyWrap}>
                <Feather name="inbox" size={40} color={COLORS.gray[200]} />
                <Text style={styles.emptyText}>아직 가람Link 알림이 없습니다</Text>
                <Pressable
                  style={({ pressed }) => [styles.emptyAction, pressed && { opacity: 0.7 }]}
                  onPress={openMessenger}
                >
                  <Text style={styles.emptyActionText}>메신저 바로가기</Text>
                  <Feather name="arrow-right" size={14} color={COLORS.primary} />
                </Pressable>
              </View>
            ) : (
              <View style={styles.feedList}>
                {recentNotifs.map((item, index) => {
                  const catKey = (item.category ?? '').trim().toLowerCase();
                  const catColor = getCategoryColor(catKey);
                  const catIcon = getCategoryIcon(catKey);
                  const catLabel = getCategoryLabel(catKey);

                  return (
                    <MotiView
                      key={item.id}
                      from={{ opacity: 0, translateX: -8 }}
                      animate={{ opacity: 1, translateX: 0 }}
                      transition={{ type: 'timing', duration: 300, delay: index * 40 }}
                    >
                      <Pressable
                        style={({ pressed }) => [
                          styles.feedItem,
                          pressed && { backgroundColor: COLORS.gray[50] },
                        ]}
                        onPress={() => handleNotifPress(item)}
                      >
                        <View style={[styles.feedDot, { backgroundColor: catColor }]} />
                        <View style={styles.feedContent}>
                          <View style={styles.feedTopRow}>
                            <View style={[styles.feedBadge, { backgroundColor: `${catColor}15` }]}>
                              <Feather name={catIcon} size={11} color={catColor} />
                              <Text style={[styles.feedBadgeText, { color: catColor }]}>
                                {catLabel}
                              </Text>
                            </View>
                            <Text style={styles.feedTime}>
                              {item.created_at ? formatRelativeTime(item.created_at) : ''}
                            </Text>
                          </View>
                          <Text style={styles.feedTitle} numberOfLines={1}>
                            {item.title}
                          </Text>
                          <Text style={styles.feedBody} numberOfLines={2}>
                            {item.body}
                          </Text>
                        </View>
                      </Pressable>
                    </MotiView>
                  );
                })}
              </View>
            )}
          </View>
        </MotiView>

        {/* How It Works */}
        <MotiView
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 400, delay: 300 }}
        >
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>설계 요청 흐름</Text>
            <View style={styles.flowCard}>
              <View style={styles.flowRow}>
                {[
                  { icon: 'edit-3' as const, label: '의뢰\n작성' },
                  { icon: 'send' as const, label: '매니저\n배정' },
                  { icon: 'check-square' as const, label: '설계\n완료' },
                  { icon: 'star' as const, label: 'FC\n확인' },
                ].flatMap((step, i) => [
                  ...(i > 0 ? [
                    <View key={`arr-${i}`} style={styles.flowArrowH}>
                      <Feather name="chevron-right" size={11} color={COLORS.gray[300]} />
                    </View>,
                  ] : []),
                  <View key={step.label} style={styles.flowStepH}>
                    <View style={[styles.flowIconWrapH, i === 0 && styles.flowIconActiveH]}>
                      <Feather
                        name={step.icon}
                        size={13}
                        color={i === 0 ? COLORS.primary : COLORS.gray[400]}
                      />
                    </View>
                    <Text style={[styles.flowLabelH, i === 0 && styles.flowLabelActiveH]}>
                      {step.label}
                    </Text>
                  </View>,
                ])}
              </View>
            </View>
          </View>
        </MotiView>

        {/* Info Cards */}
        <MotiView
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 400, delay: 400 }}
        >
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>알아두세요</Text>
            <View style={styles.infoCardsWrap}>
              <View style={styles.infoCard}>
                <Feather name="shield" size={18} color="#3B82F6" />
                <View style={styles.infoCardText}>
                  <Text style={styles.infoCardTitle}>개인정보 보호</Text>
                  <Text style={styles.infoCardDesc}>
                    고객 주민번호는 암호화 저장되며{'\n'}마스킹 처리되어 표시됩니다
                  </Text>
                </View>
              </View>
              <Pressable
                style={({ pressed }) => [styles.infoCard, pressed && { backgroundColor: COLORS.gray[50] }]}
                onPress={openMessenger}
              >
                <Feather name="message-circle" size={18} color="#F59E0B" />
                <View style={styles.infoCardText}>
                  <Text style={styles.infoCardTitle}>실시간 메신저</Text>
                  <Text style={styles.infoCardDesc}>
                    {isRequestBoardDesigner
                      ? 'FC와 실시간으로 메시지를 주고받을 수 있습니다'
                      : '설계 매니저와 실시간으로\n메시지를 주고받을 수 있습니다'}
                  </Text>
                </View>
                <Feather name="chevron-right" size={16} color={COLORS.gray[400]} />
              </Pressable>
              <View style={styles.infoCard}>
                <Feather name="bell" size={18} color="#10B981" />
                <View style={styles.infoCardText}>
                  <Text style={styles.infoCardTitle}>푸시 알림</Text>
                  <Text style={styles.infoCardDesc}>
                    의뢰 상태 변경, 새 메시지 등{'\n'}주요 이벤트를 즉시 알려드립니다
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </MotiView>
      </ScrollView>

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
  container: {
    flex: 1,
    backgroundColor: COLORS.gray[50],
  },
  pageTitleWrap: {
    marginHorizontal: SPACING.base,
    marginBottom: SPACING.sm,
    alignItems: 'center',
  },
  pageTitle: {
    fontSize: TYPOGRAPHY.fontSize.xl,
    fontWeight: '800' as const,
    color: COLORS.gray[900],
    textAlign: 'center',
  },
  pageSubtitle: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.text.muted,
    marginTop: 2,
    textAlign: 'center',
  },

  scrollContent: {
    paddingHorizontal: SPACING.base,
    paddingTop: SPACING.base,
  },

  /* Quick Actions */
  actionsRow: {
    flexDirection: 'row',
    gap: CARD_GAP,
    marginBottom: SPACING.lg,
  },
  actionCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border.light,
    ...SHADOWS.sm,
  },
  actionCardPressed: {
    backgroundColor: COLORS.gray[50],
    transform: [{ scale: 0.97 }],
  },
  actionIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.sm,
  },
  actionLabel: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontWeight: '600' as const,
    color: COLORS.gray[700],
    textAlign: 'center',
    lineHeight: 16,
  },

  /* Section */
  section: {
    marginBottom: SPACING.lg,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  sectionTitle: {
    fontSize: TYPOGRAPHY.fontSize.md,
    fontWeight: '700' as const,
    color: COLORS.gray[900],
    marginBottom: SPACING.sm,
  },
  seeAll: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.primary,
    fontWeight: '600' as const,
    marginBottom: SPACING.sm,
  },

  /* Flow */
  flowCard: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    paddingHorizontal: SPACING.base,
    paddingVertical: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    ...SHADOWS.sm,
  },
  flowRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  flowStepH: {
    flex: 1,
    alignItems: 'center',
    gap: 5,
  },
  flowIconWrapH: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.gray[100],
    borderWidth: 1.5,
    borderColor: COLORS.gray[200],
    alignItems: 'center',
    justifyContent: 'center',
  },
  flowIconActiveH: {
    backgroundColor: COLORS.primaryPale,
    borderColor: COLORS.primary,
  },
  flowLabelH: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    color: COLORS.gray[500],
    textAlign: 'center',
    fontWeight: '500' as const,
    lineHeight: 14,
  },
  flowLabelActiveH: {
    color: COLORS.primary,
    fontWeight: '700' as const,
  },
  flowArrowH: {
    marginTop: 10,
    paddingHorizontal: 2,
  },

  /* Feed */
  loadingWrap: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyWrap: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    padding: SPACING.xl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border.light,
    gap: SPACING.sm,
  },
  emptyText: {
    fontSize: TYPOGRAPHY.fontSize.base,
    color: COLORS.text.muted,
  },
  emptyAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: SPACING.xs,
  },
  emptyActionText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.primary,
    fontWeight: '600' as const,
  },

  feedList: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    overflow: 'hidden',
    ...SHADOWS.sm,
  },
  feedItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.base,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border.light,
  },
  feedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
    marginRight: SPACING.sm,
  },
  feedContent: {
    flex: 1,
  },
  feedTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  feedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: RADIUS.sm,
  },
  feedBadgeText: {
    fontSize: TYPOGRAPHY.fontSize['2xs'],
    fontWeight: '700' as const,
  },
  feedTime: {
    fontSize: TYPOGRAPHY.fontSize['2xs'],
    color: COLORS.text.muted,
  },
  feedTitle: {
    fontSize: TYPOGRAPHY.fontSize.base,
    fontWeight: '600' as const,
    color: COLORS.gray[900],
    marginBottom: 2,
  },
  feedBody: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.text.secondary,
    lineHeight: 18,
  },

  /* Request Stats Grid */
  reqStatsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: CARD_GAP,
  },
  reqStatCard: {
    width: (SCREEN_WIDTH - SPACING.base * 2 - CARD_GAP) / 2,
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
    ...SHADOWS.sm,
  },
  reqStatCardPressed: {
    opacity: 0.85,
  },
  reqStatValue: {
    fontSize: 28,
    fontWeight: '800' as const,
    color: COLORS.gray[900],
    lineHeight: 34,
  },
  reqStatUnit: {
    fontSize: TYPOGRAPHY.fontSize.base,
    fontWeight: '400' as const,
    color: COLORS.gray[500],
  },
  reqStatLabel: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: '600' as const,
    color: COLORS.gray[700],
    marginTop: 2,
  },
  reqStatDesc: {
    fontSize: TYPOGRAPHY.fontSize['2xs'],
    color: COLORS.text.muted,
    marginTop: 2,
  },

  /* Code Management Card */
  codeManageCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    padding: SPACING.base,
    gap: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    ...SHADOWS.sm,
  },
  codeManageIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: COLORS.primaryPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeManageText: {
    flex: 1,
  },
  codeManageTitle: {
    fontSize: TYPOGRAPHY.fontSize.base,
    fontWeight: '700' as const,
    color: COLORS.gray[800],
  },
  codeManageDesc: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.text.secondary,
    marginTop: 1,
  },

  /* Info Cards */
  infoCardsWrap: {
    gap: SPACING.sm,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    padding: SPACING.base,
    gap: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border.light,
  },
  infoCardText: {
    flex: 1,
  },
  infoCardTitle: {
    fontSize: TYPOGRAPHY.fontSize.base,
    fontWeight: '700' as const,
    color: COLORS.gray[800],
    marginBottom: 2,
  },
  infoCardDesc: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.text.secondary,
    lineHeight: 18,
  },
});
