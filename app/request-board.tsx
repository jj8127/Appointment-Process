import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useRouter } from 'expo-router';
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

import { BottomNavigation } from '@/components/BottomNavigation';
import { useSession } from '@/hooks/use-session';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import { COLORS, RADIUS, SHADOWS, SPACING, TYPOGRAPHY } from '@/lib/theme';

/* ─── Constants ─── */

const YOUTUBE_URL = 'https://youtu.be/Otu7hc2trfY?si=4sby6Qt9OtTB06GM';
const SCREEN_WIDTH = Dimensions.get('window').width;
const CARD_GAP = 10;

const REQUEST_BOARD_CATEGORY_PREFIX = 'request_board_';

type NotificationItem = {
  id: string;
  title: string;
  body: string;
  category?: string | null;
  created_at?: string | null;
};

type CategoryStat = {
  key: string;
  label: string;
  count: number;
  icon: keyof typeof Feather.glyphMap;
  color: string;
  bg: string;
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

/* ─── Component ─── */

export default function RequestBoardScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { role, residentId, hydrated } = useSession();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const navPreset = role === 'admin' ? 'admin-onboarding' : 'fc';

  /* ─── Data fetch ─── */
  const fetchData = useCallback(async () => {
    if (!role) return;
    try {
      const { data, error } = await supabase.functions.invoke('fc-notify', {
        body: {
          type: 'inbox_list',
          role,
          resident_id: role === 'fc' ? (residentId ?? null) : null,
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
      logger.warn('request-board data fetch failed', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [role, residentId]);

  useEffect(() => {
    if (hydrated) fetchData();
  }, [hydrated, fetchData]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  /* ─── Computed stats ─── */
  const stats: CategoryStat[] = (() => {
    const countMap: Record<string, number> = {};
    for (const n of notifications) {
      const cat = (n.category ?? '').trim().toLowerCase();
      countMap[cat] = (countMap[cat] ?? 0) + 1;
    }

    const ordered = [
      'request_board_new_request',
      'request_board_accepted',
      'request_board_completed',
      'request_board_message',
    ];

    return ordered
      .filter((key) => (countMap[key] ?? 0) > 0)
      .map((key) => ({
        key,
        label: CATEGORY_CONFIG[key]?.label ?? key,
        count: countMap[key] ?? 0,
        icon: CATEGORY_CONFIG[key]?.icon ?? 'bell',
        color: CATEGORY_CONFIG[key]?.color ?? COLORS.primary,
        bg: CATEGORY_CONFIG[key]?.bg ?? '#F3F4F6',
      }));
  })();

  const recentNotifs = notifications.slice(0, 10);

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

  const openNotifications = () => {
    router.push('/notifications');
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

      {/* Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) + 4 }]}>
        <View style={styles.headerInner}>
          <View>
            <Text style={styles.headerTitle}>설계 요청</Text>
            <Text style={styles.headerSub}>의뢰 현황과 알림을 한눈에</Text>
          </View>
          <Pressable
            style={({ pressed }) => [styles.headerAction, pressed && { opacity: 0.6 }]}
            onPress={openNotifications}
          >
            <Feather name="bell" size={20} color={COLORS.gray[700]} />
            {notifications.length > 0 && <View style={styles.badge} />}
          </Pressable>
        </View>
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
              onPress={openMessenger}
            >
              <LinearGradient
                colors={[COLORS.primary, COLORS.primaryDark]}
                style={styles.actionIconWrap}
              >
                <Feather name="message-circle" size={20} color="#fff" />
              </LinearGradient>
              <Text style={styles.actionLabel}>메신저</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.actionCard, pressed && styles.actionCardPressed]}
              onPress={openNotifications}
            >
              <View style={[styles.actionIconWrap, { backgroundColor: '#3B82F6' }]}>
                <Feather name="bell" size={20} color="#fff" />
              </View>
              <Text style={styles.actionLabel}>알림{'\n'}센터</Text>
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

        {/* Status Summary */}
        {stats.length > 0 && (
          <MotiView
            from={{ opacity: 0, translateY: 12 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 400, delay: 100 }}
          >
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>알림 현황</Text>
              <View style={styles.statsRow}>
                {stats.map((stat) => (
                  <View key={stat.key} style={[styles.statCard, { backgroundColor: stat.bg }]}>
                    <View style={styles.statIconRow}>
                      <Feather name={stat.icon} size={16} color={stat.color} />
                      <Text style={[styles.statCount, { color: stat.color }]}>{stat.count}</Text>
                    </View>
                    <Text style={styles.statLabel} numberOfLines={1}>
                      {stat.label}
                    </Text>
                  </View>
                ))}
              </View>
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
              {notifications.length > 10 && (
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
                <Text style={styles.emptyText}>아직 설계요청 알림이 없습니다</Text>
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
              {[
                { icon: 'edit-3' as const, label: '의뢰 작성', desc: 'FC가 고객 정보와\n보험 종목을 입력' },
                { icon: 'send' as const, label: '설계 매니저 배정', desc: '보험사별 설계\n매니저에게 전달' },
                { icon: 'check-square' as const, label: '설계 완료', desc: '매니저가 설계안을\n작성하여 회신' },
                { icon: 'star' as const, label: 'FC 확인', desc: 'FC가 설계안을\n승인 또는 반려' },
              ].map((step, i) => (
                <View key={step.label} style={styles.flowStep}>
                  <View style={[styles.flowIconWrap, i === 0 && { backgroundColor: COLORS.primaryPale, borderColor: COLORS.primary }]}>
                    <Feather
                      name={step.icon}
                      size={16}
                      color={i === 0 ? COLORS.primary : COLORS.gray[500]}
                    />
                  </View>
                  <Text style={[styles.flowLabel, i === 0 && { color: COLORS.primary, fontWeight: '700' }]}>
                    {step.label}
                  </Text>
                  <Text style={styles.flowDesc}>{step.desc}</Text>
                  {i < 3 && (
                    <View style={styles.flowArrow}>
                      <Feather name="chevron-down" size={14} color={COLORS.gray[300]} />
                    </View>
                  )}
                </View>
              ))}
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
                    설계 매니저와 실시간으로{'\n'}메시지를 주고받을 수 있습니다
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
        preset={navPreset}
        activeKey="request-board"
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

  /* Header */
  header: {
    backgroundColor: '#fff',
    paddingHorizontal: SPACING.base,
    paddingBottom: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
    ...SHADOWS.sm,
  },
  headerInner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: TYPOGRAPHY.fontSize.xl,
    fontWeight: '800' as const,
    color: COLORS.gray[900],
  },
  headerSub: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.text.muted,
    marginTop: 2,
  },
  headerAction: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.error,
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

  /* Stats */
  statsRow: {
    flexDirection: 'row',
    gap: CARD_GAP,
    flexWrap: 'wrap',
  },
  statCard: {
    flex: 1,
    minWidth: (SCREEN_WIDTH - SPACING.base * 2 - CARD_GAP * 3) / 4,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    alignItems: 'center',
  },
  statIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  statCount: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontWeight: '800' as const,
  },
  statLabel: {
    fontSize: TYPOGRAPHY.fontSize['2xs'],
    fontWeight: '600' as const,
    color: COLORS.gray[600],
  },

  /* Flow */
  flowCard: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    padding: SPACING.base,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    ...SHADOWS.sm,
  },
  flowStep: {
    alignItems: 'center',
    paddingVertical: SPACING.sm,
  },
  flowIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.gray[100],
    borderWidth: 1.5,
    borderColor: COLORS.gray[200],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  flowLabel: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: '600' as const,
    color: COLORS.gray[700],
    marginBottom: 2,
  },
  flowDesc: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    color: COLORS.text.muted,
    textAlign: 'center',
    lineHeight: 16,
  },
  flowArrow: {
    marginTop: 4,
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
