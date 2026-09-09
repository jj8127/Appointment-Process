import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Skeleton } from '@/components/LoadingSkeleton';
import { ReferralDirectRecommenderCard } from '@/components/ReferralAncestorsChain';
import { ReferralTreeNode, type DescendantNode } from '@/components/ReferralTreeNode';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useMyReferralCode } from '@/hooks/use-my-referral-code';
import { useReferralAllowanceAccess } from '@/hooks/use-referral-allowance';
import { isReferralReloginError } from '@/hooks/use-referral-app-session';
import { useReferralTree } from '@/hooks/use-referral-tree';
import { useSession } from '@/hooks/use-session';
import { buildReferralShareText } from '@/lib/referral-share';
import { COLORS, RADIUS, SHADOWS, SPACING } from '@/lib/theme';

const APP_STORE_URL = (process.env.EXPO_PUBLIC_APP_STORE_URL ?? '').trim();
const INVITE_BASE_URL = process.env.EXPO_PUBLIC_INVITE_BASE_URL ?? '';

function buildShareText(code: string): string {
  return buildReferralShareText({
    code,
    inviteBaseUrl: INVITE_BASE_URL,
    appStoreUrl: APP_STORE_URL,
  });
}

export default function ReferralPage() {
  const router = useRouter();
  const { role, readOnly, isRequestBoardDesigner } = useSession();
  const allowanceAccess = useReferralAllowanceAccess();
  const canViewReferral =
    !isRequestBoardDesigner && (role === 'fc' || (role === 'admin' && readOnly));
  const {
    data: referralInfo,
    isLoading: referralLoading,
    error: referralInfoError,
    refetch: refetchReferralInfo,
  } = useMyReferralCode();
  const {
    data: referralTree,
    isLoading: referralTreeLoading,
    isError: referralTreeError,
    error: referralTreeQueryError,
    refetch: refetchReferralTree,
    loadChildrenOf,
    hasLoadedChildrenOf,
    prefetchVisibleChildrenOf,
  } = useReferralTree({ depth: 2 });
  const keyboardPadding = useKeyboardPadding();

  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const referralCode = referralInfo?.code ?? null;
  const currentRecommender = referralInfo?.recommender ?? null;
  const currentRecommenderAffiliation = referralInfo?.recommenderAffiliation ?? null;
  const currentRecommenderCode = referralInfo?.recommenderCode ?? null;
  const referralTreeErrorMessage =
    referralTreeQueryError instanceof Error
      ? referralTreeQueryError.message
      : '추천 관계 정보를 불러오지 못했습니다.';
  const referralNeedsRelogin =
    isReferralReloginError(referralInfoError) || isReferralReloginError(referralTreeQueryError);
  const referralReloginMessage =
    isReferralReloginError(referralInfoError)
      ? referralInfoError.message
      : isReferralReloginError(referralTreeQueryError)
      ? referralTreeQueryError.message
      : '세션이 만료되었습니다. 다시 로그인해주세요.';
  const referralInfoErrorMessage =
    referralInfoError instanceof Error
      ? referralInfoError.message
      : '추천인 정보를 불러오지 못했습니다.';
  const openRelogin = useCallback(() => {
    router.push('/login?skipAuto=1');
  }, [router]);

  const handleCopyCode = async () => {
    if (!referralCode) return;
    try {
      await Clipboard.setStringAsync(referralCode);
      setCopied(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  const handleShare = async () => {
    if (!referralCode) return;
    try {
      await Share.share({ title: '가람in 앱 초대', message: buildShareText(referralCode) });
    } catch { /* cancelled */ }
  };

  const handleOpenGraphView = useCallback(() => {
    router.push('/referral-graph');
  }, [router]);

  const handleOpenRevenueGraphView = useCallback(() => {
    if (allowanceAccess.mode === 'enabled') {
      router.push('/referral-allowance');
      return;
    }
    if (allowanceAccess.mode !== 'sample') {
      if (isReferralReloginError(allowanceAccess.error)) {
        router.push('/login?skipAuto=1');
        return;
      }
      allowanceAccess.retry();
      return;
    }
    router.push('/referral-revenue-graph');
  }, [router, allowanceAccess]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      if (!canViewReferral) {
        return;
      }
      await Promise.all([refetchReferralInfo(), refetchReferralTree()]);
    } finally {
      setRefreshing(false);
    }
  };

  const handleToggleTreeNode = useCallback(
    async (fcId: string) => {
      if (expandedIds.has(fcId)) {
        setExpandedIds((prev) => {
          const next = new Set(prev);
          next.delete(fcId);
          return next;
        });
        return;
      }

      setExpandedIds((prev) => new Set([...prev, fcId]));

      const alreadyLoaded = hasLoadedChildrenOf(fcId);
      if (alreadyLoaded) {
        prefetchVisibleChildrenOf(fcId);
        return;
      }

      setLoadingIds((prev) => new Set([...prev, fcId]));
      try {
        await loadChildrenOf(fcId);
        prefetchVisibleChildrenOf(fcId);
      } catch {
        // retry via chevron tap
      } finally {
        setLoadingIds((prev) => {
          const next = new Set(prev);
          next.delete(fcId);
          return next;
        });
      }
    },
    [expandedIds, hasLoadedChildrenOf, loadChildrenOf, prefetchVisibleChildrenOf],
  );

  const rootDescendants: DescendantNode[] =
    referralTree?.descendants?.filter((node) => referralTree.root && node.parentFcId === referralTree.root.fcId) ?? [];
  const totalTreeDescendants = referralTree?.root.totalDescendantCount ?? 0;
  const directRecommender = referralTree?.ancestors?.length
    ? referralTree.ancestors[referralTree.ancestors.length - 1]
    : null;
  const directRecommenderSummary = directRecommender
    ? {
      name: directRecommender.name,
      affiliation: directRecommender.affiliation,
      code: directRecommender.code,
    }
    : referralTree
      ? null
      : currentRecommender
      ? {
        name: currentRecommender,
        affiliation: currentRecommenderAffiliation,
        code: currentRecommenderCode,
      }
      : null;
  const blockedContent = !canViewReferral;

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(SPACING['5xl'], keyboardPadding + 200) },
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.primary} />
        }
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="none"
      >
        <View style={styles.pageContent}>
          {blockedContent ? (
            <View style={styles.blockedState}>
              <View style={styles.blockedIconWrap}>
                <Feather name="lock" size={28} color={COLORS.gray[400]} />
              </View>
              <Text style={styles.blockedTitle}>추천인 코드는 FC 또는 본부장 세션에서만 사용할 수 있어요</Text>
              <Text style={styles.blockedDescription}>
                총무/개발자 계정은 운영 추천인 화면에서만 데이터를 조회할 수 있습니다.
              </Text>
            </View>
          ) : (
            <>
        {/* ── 내 추천 코드 카드 ── */}
        <View style={styles.codeCard}>
          <View style={styles.deco1} />
          <View style={styles.deco2} />
          <View style={styles.codeCardInner}>
            <Text style={styles.codeCardLabel}>내 추천 코드</Text>
            {referralLoading ? (
              <View style={{ marginVertical: 12 }}>
                <Skeleton width={180} height={40} borderRadius={8} />
              </View>
            ) : referralInfoError ? (
              <>
                <Text style={styles.codeEmpty}>{referralInfoErrorMessage}</Text>
                {isReferralReloginError(referralInfoError) ? (
                  <Pressable
                    style={({ pressed }) => [styles.treeRetryBtn, pressed && { opacity: 0.85 }]}
                    onPress={openRelogin}
                  >
                    <Text style={styles.treeRetryBtnText}>다시 로그인</Text>
                  </Pressable>
                ) : null}
              </>
            ) : referralCode ? (
              <Text style={styles.codeText}>{referralCode}</Text>
            ) : (
              <Text style={styles.codeEmpty}>추천 코드가 없습니다</Text>
            )}
            {referralCode && (
              <View style={styles.codeActions}>
                <Pressable
                  style={({ pressed }) => [styles.codeBtn, pressed && styles.codeBtnPressed]}
                  onPress={handleCopyCode}
                >
                  <Feather name={copied ? 'check' : 'copy'} size={15} color={COLORS.primary} />
                  <Text style={styles.codeBtnText}>{copied ? '복사됨' : '코드 복사'}</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.codeBtn, pressed && styles.codeBtnPressed]}
                  onPress={handleShare}
                >
                  <Feather name="share-2" size={15} color={COLORS.primary} />
                  <Text style={styles.codeBtnText}>공유하기</Text>
                </Pressable>
              </View>
            )}
            {referralTree ? (
              <View style={styles.codeMetaRow}>
                <View style={styles.codeMetaProfile}>
                  <View style={styles.codeMetaAvatar}>
                    <Feather name="user" size={18} color={COLORS.white} />
                  </View>
                  <View style={styles.codeMetaInfo}>
                    <Text style={styles.codeMetaName} numberOfLines={1}>
                      {referralTree.root.name ?? '나'}
                    </Text>
                    {referralTree.root.affiliation ? (
                      <Text style={styles.codeMetaAffiliation} numberOfLines={1}>
                        {referralTree.root.affiliation}
                      </Text>
                    ) : null}
                  </View>
                </View>
                <View style={styles.codeMetaStatWrap}>
                  <Text style={styles.codeMetaStatNum}>{totalTreeDescendants}</Text>
                  <Text style={styles.codeMetaStatLabel}>전체 하위</Text>
                </View>
              </View>
            ) : null}
          </View>
        </View>

        <Pressable
          style={({ pressed }) => [styles.graphLinkCard, pressed && { opacity: 0.7 }]}
          onPress={handleOpenGraphView}
          accessibilityRole="button"
          accessibilityLabel="모바일 추천 관계 그래프 보기"
        >
          <View style={styles.graphLinkIconWrap}>
            <Feather name="users" size={18} color={COLORS.primary} />
          </View>
          <View style={styles.graphLinkTextWrap}>
            <Text style={styles.graphLinkTitle}>추천 관계 그래프로 보기</Text>
            <Text style={styles.graphLinkDesc}>앱 안에서 하위 연결을 확대하고 살펴봅니다</Text>
          </View>
          <Feather name="chevron-right" size={17} color={COLORS.gray[400]} />
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.graphLinkCard,
            styles.revenueGraphLinkCard,
            pressed && { opacity: 0.7 },
          ]}
          onPress={handleOpenRevenueGraphView}
          accessibilityRole="button"
          disabled={allowanceAccess.mode === 'loading'}
          accessibilityState={{ disabled: allowanceAccess.mode === 'loading' }}
          accessibilityLabel={allowanceAccess.mode === 'enabled' ? '월별 증원수당 내역 보기'
            : allowanceAccess.mode === 'sample' ? '샘플 증원수당 흐름 미리보기' : '증원수당 조회 권한 다시 확인'}
          accessibilityHint={allowanceAccess.mode === 'sample' ? '가상 추천 관계와 가상 매출로 만든 금액 흐름 화면을 엽니다'
            : '월별 공개된 증원수당 명세를 확인합니다'}
        >
          <View style={[styles.graphLinkIconWrap, styles.revenueGraphLinkIconWrap]}>
            <Feather name="share-2" size={18} color="#ea580c" />
          </View>
          <View style={styles.graphLinkTextWrap}>
            <View style={styles.revenueGraphTitleRow}>
              <Text style={styles.graphLinkTitle}>{allowanceAccess.mode === 'enabled' ? '월별 증원수당 내역'
                : allowanceAccess.mode === 'sample' ? '증원수당 흐름 미리보기'
                  : allowanceAccess.mode === 'loading' ? '증원수당 조회 확인 중' : '증원수당 조회 다시 확인'}</Text>
              {allowanceAccess.mode === 'sample' ? <View style={styles.sampleBadge}>
                <Text style={styles.sampleBadgeText}>샘플</Text>
              </View> : null}
            </View>
            <Text style={styles.graphLinkDesc}>
              {allowanceAccess.mode === 'enabled' ? '당월 지급예정액과 FP별 기여 내역을 확인합니다'
                : allowanceAccess.mode === 'sample' ? '추천 관계를 따라 예상 금액이 합산되는 경로를 확인합니다'
                  : allowanceAccess.mode === 'loading' ? '공개된 수당 내역의 조회 권한을 확인합니다' : '연결 상태를 확인한 뒤 눌러서 다시 시도해주세요'}
            </Text>
          </View>
          <Feather name="chevron-right" size={17} color={COLORS.gray[400]} />
        </Pressable>

        {referralTreeLoading ? (
          <View style={styles.treeSkeletonWrap}>
            <Skeleton width="100%" height={84} borderRadius={RADIUS.xl} style={{ marginBottom: SPACING.base }} />
            <Skeleton width="48%" height={18} borderRadius={RADIUS.sm} style={{ marginBottom: SPACING.sm }} />
            <Skeleton width="100%" height={60} borderRadius={RADIUS.lg} style={{ marginBottom: 8 }} />
            <Skeleton width="82%" height={60} borderRadius={RADIUS.lg} style={{ marginBottom: SPACING.lg }} />
            <Skeleton width="48%" height={18} borderRadius={RADIUS.sm} style={{ marginBottom: SPACING.sm }} />
            <Skeleton width="100%" height={52} borderRadius={RADIUS.lg} style={{ marginBottom: 6 }} />
            <Skeleton width="100%" height={52} borderRadius={RADIUS.lg} />
          </View>
        ) : referralTreeError ? (
          <View style={styles.treeErrorState}>
            <View style={styles.treeErrorIconWrap}>
              <Feather name="alert-circle" size={26} color={COLORS.error} />
            </View>
            <Text style={styles.treeErrorTitle}>
              {referralNeedsRelogin ? '세션이 만료되었습니다.' : '추천 관계 정보를 가져오지 못했어요'}
            </Text>
            <Text style={styles.treeErrorDesc}>
              {referralNeedsRelogin
                ? referralReloginMessage
                : referralTreeErrorMessage}
            </Text>
            <Pressable
              style={({ pressed }) => [styles.treeRetryBtn, pressed && { opacity: 0.85 }]}
              onPress={referralNeedsRelogin ? openRelogin : () => refetchReferralTree()}
            >
              <Text style={styles.treeRetryBtnText}>
                {referralNeedsRelogin ? '다시 로그인' : '관계 구조 다시 불러오기'}
              </Text>
            </Pressable>
          </View>
        ) : referralTree ? (
          <>
            <View style={styles.treeSectionHeader}>
              <Feather name="heart" size={15} color={COLORS.primary} />
              <Text style={styles.treeSectionTitle}>나를 추천한 사람</Text>
            </View>
            <View style={styles.treeSectionCard}>
              <ReferralDirectRecommenderCard recommender={directRecommenderSummary} />
            </View>

            <View style={[styles.treeSectionHeader, { marginTop: SPACING.lg }]}>
              <Feather name="arrow-down-circle" size={15} color={COLORS.primary} />
              <Text style={styles.treeSectionTitle}>내가 추천한 사람들</Text>
              {rootDescendants.length > 0 && (
                <View style={styles.treeCountBadge}>
                  <Text style={styles.treeCountBadgeText}>{rootDescendants.length}명</Text>
                </View>
              )}
            </View>
            <View style={styles.treeSectionCard}>
              {rootDescendants.length === 0 ? (
                <View style={styles.treeEmptyState}>
                  <Feather name="user-plus" size={26} color={COLORS.gray[200]} />
                  <Text style={styles.treeEmptyTitle}>아직 추천한 사람이 없어요</Text>
                  <Text style={styles.treeEmptyDesc}>추천 코드를 공유하면 여기에 연결됩니다.</Text>
                </View>
              ) : (
                <>
                  {rootDescendants.map((node) => (
                    <ReferralTreeNode
                      key={node.fcId}
                      node={node}
                      depth={0}
                      expanded={expandedIds.has(node.fcId)}
                      isLoadingExpand={loadingIds.has(node.fcId)}
                      onToggle={handleToggleTreeNode}
                      expandedIds={expandedIds}
                      loadingIds={loadingIds}
                      allNodes={referralTree.descendants}
                    />
                  ))}
                  {referralTree.truncated && (
                    <View style={styles.treeTruncatedBanner}>
                      <Feather name="info" size={13} color={COLORS.info} />
                      <Text style={styles.treeTruncatedText}>일부 하위 항목은 탭하면 더 볼 수 있어요</Text>
                    </View>
                  )}
                </>
              )}
            </View>

            <View style={styles.bottomContentSpacer} />
          </>
        ) : null}
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background.secondary },
  scroll: { flex: 1 },
  scrollContent: { padding: SPACING.base, paddingBottom: SPACING['4xl'] },
  pageContent: { flexGrow: 1 },

  // 내 코드 카드
  codeCard: { borderRadius: RADIUS.xl, padding: SPACING.lg, marginBottom: SPACING.base, overflow: 'hidden', position: 'relative', backgroundColor: COLORS.primary, ...SHADOWS.lg },
  deco1: { position: 'absolute', top: -30, right: -30, width: 120, height: 120, borderRadius: 60, backgroundColor: 'rgba(255,255,255,0.1)' },
  deco2: { position: 'absolute', bottom: -20, left: -20, width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(255,255,255,0.08)' },
  codeCardInner: { zIndex: 1 },
  codeCardLabel: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.85)', marginBottom: 6, letterSpacing: 0.5 },
  codeText: { fontSize: 30, fontWeight: '800', color: '#fff', letterSpacing: 5, marginBottom: 14, ...Platform.select({ ios: { fontVariant: ['tabular-nums'] } }) },
  codeEmpty: { fontSize: 16, color: 'rgba(255,255,255,0.7)', marginBottom: 12, marginTop: 4 },
  codeActions: { flexDirection: 'row', gap: 8 },
  codeBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.full },
  codeBtnPressed: { opacity: 0.8 },
  codeBtnText: { fontSize: 12, fontWeight: '700', color: COLORS.primary },
  codeMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.md,
    marginTop: SPACING.md,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.18)',
  },
  codeMetaProfile: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, minWidth: 0 },
  codeMetaAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  codeMetaInfo: { flex: 1, minWidth: 0 },
  codeMetaName: { fontSize: 15, fontWeight: '800', color: COLORS.white },
  codeMetaAffiliation: { fontSize: 11, color: 'rgba(255,255,255,0.82)', marginTop: 1 },
  codeMetaStatWrap: { alignItems: 'center', flexShrink: 0 },
  codeMetaStatNum: { fontSize: 20, fontWeight: '800', color: COLORS.white },
  codeMetaStatLabel: { fontSize: 10, color: 'rgba(255,255,255,0.75)', marginTop: 2 },

  treeSkeletonWrap: { marginBottom: SPACING.base },
  treeErrorState: {
    alignItems: 'center',
    backgroundColor: COLORS.background.primary,
    borderRadius: RADIUS.xl,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.xl,
    marginBottom: SPACING.base,
    ...SHADOWS.sm,
  },
  treeErrorIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.errorLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.sm,
  },
  treeErrorTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text.primary,
    textAlign: 'center',
  },
  treeErrorDesc: {
    fontSize: 12,
    lineHeight: 18,
    color: COLORS.text.muted,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: SPACING.md,
  },
  treeRetryBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.lg,
    paddingVertical: 10,
  },
  treeRetryBtnText: { fontSize: 13, fontWeight: '700', color: COLORS.white },
  treeSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: SPACING.sm,
  },
  treeSectionTitle: { flex: 1, fontSize: 14, fontWeight: '700', color: COLORS.text.primary },
  treeHeaderAction: {
    borderWidth: 1,
    borderColor: COLORS.border.medium,
    borderRadius: RADIUS.full,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: COLORS.background.secondary,
  },
  treeHeaderActionPressed: { opacity: 0.75 },
  treeHeaderActionText: { fontSize: 12, fontWeight: '700', color: COLORS.text.secondary },
  treeCountBadge: {
    backgroundColor: COLORS.primaryPale,
    borderRadius: RADIUS.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  treeCountBadgeText: { fontSize: 12, fontWeight: '700', color: COLORS.primary },
  treeSectionCard: {
    backgroundColor: COLORS.background.primary,
    borderRadius: RADIUS.xl,
    padding: SPACING.sm,
    ...SHADOWS.sm,
  },
  treeEmptyState: {
    alignItems: 'center',
    paddingVertical: SPACING['2xl'],
    gap: SPACING.sm,
  },
  treeEmptyTitle: { fontSize: 14, fontWeight: '600', color: COLORS.text.secondary },
  treeEmptyDesc: { fontSize: 12, color: COLORS.text.muted, textAlign: 'center' },
  treeTruncatedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: SPACING.sm,
    padding: SPACING.sm,
    backgroundColor: COLORS.infoLight,
    borderRadius: RADIUS.md,
  },
  treeTruncatedText: { flex: 1, fontSize: 12, color: COLORS.info },

  // 추천인 카드
  recommenderCard: { backgroundColor: COLORS.background.primary, borderRadius: RADIUS.xl, padding: SPACING.base, marginBottom: SPACING.base, ...SHADOWS.sm },
  recommenderHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: SPACING.md },
  recommenderIconWrap: { width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.primaryPale, alignItems: 'center', justifyContent: 'center' },
  recommenderTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text.primary },
  cancelBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: COLORS.border.medium, borderRadius: RADIUS.md, height: 42, marginTop: SPACING.md, backgroundColor: COLORS.background.secondary },
  cancelBtnText: { fontSize: 14, fontWeight: '600', color: COLORS.text.secondary },
  currentRecommenderError: { fontSize: 13, color: COLORS.error, marginBottom: SPACING.md },
  divider: { height: 1, backgroundColor: COLORS.border.light, marginBottom: SPACING.md },
  inputLabel: { fontSize: 13, fontWeight: '600', color: COLORS.text.secondary, marginBottom: 8 },
  treeFallbackHint: {
    fontSize: 12,
    lineHeight: 18,
    color: COLORS.text.muted,
    marginBottom: SPACING.sm,
  },
  currentRecommenderFallbackCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: COLORS.background.secondary,
    borderRadius: RADIUS.md,
    padding: 12,
    marginBottom: 10,
  },
  currentRecommenderFallbackAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primaryPale,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  currentRecommenderFallbackInfo: { flex: 1, minWidth: 0 },
  currentRecommenderFallbackName: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text.primary,
  },
  currentRecommenderFallbackAffiliation: {
    fontSize: 12,
    color: COLORS.text.secondary,
    marginTop: 1,
  },
  currentRecommenderFallbackCode: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primary,
    marginTop: 3,
    letterSpacing: 1,
  },
  fallbackChangeBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 42,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border.medium,
    backgroundColor: COLORS.background.secondary,
  },
  fallbackChangeBtnPressed: { opacity: 0.75 },
  fallbackChangeBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text.secondary,
  },

  // 검색 입력
  searchInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.background.secondary,
    paddingHorizontal: 12,
    height: 46,
    marginBottom: 6,
  },
  searchInputField: { flex: 1, fontSize: 14, color: COLORS.text.primary },

  // 검색 결과
  resultsList: {
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    marginBottom: 8,
  },
  resultItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: COLORS.border.light },
  resultItemPressed: { backgroundColor: COLORS.background.secondary },
  resultAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.gray[100], alignItems: 'center', justifyContent: 'center' },
  resultInfo: { flex: 1 },
  resultName: { fontSize: 14, fontWeight: '600', color: COLORS.text.primary },
  resultAffiliation: { fontSize: 12, color: COLORS.text.muted, marginTop: 1 },
  resultCodeBadge: { backgroundColor: COLORS.primaryPale, paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.sm },
  resultCodeText: { fontSize: 11, fontWeight: '700', color: COLORS.primary, letterSpacing: 1 },
  resultNoCode: { fontSize: 11, color: COLORS.text.muted },

  // 힌트
  searchHint: { fontSize: 12, color: COLORS.text.muted, marginBottom: SPACING.sm, marginTop: 2 },

  // 선택된 항목
  selectedWrap: { marginTop: 4 },
  selectedInfo: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.background.secondary, borderRadius: RADIUS.md, padding: 12, marginBottom: 10 },
  selectedAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.primaryPale, alignItems: 'center', justifyContent: 'center' },
  selectedText: { flex: 1 },
  selectedName: { fontSize: 15, fontWeight: '700', color: COLORS.text.primary },
  selectedAffiliation: { fontSize: 12, color: COLORS.text.secondary, marginTop: 1 },
  selectedCode: { fontSize: 12, fontWeight: '700', color: COLORS.primary, marginTop: 3, letterSpacing: 1 },
  clearBtn: { padding: 4 },
  noCodeWarning: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.warning.light, borderRadius: RADIUS.sm, padding: 8, marginBottom: 10 },
  noCodeWarningText: { flex: 1, fontSize: 12, color: COLORS.warning.dark },

  saveBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS.md, height: 46, alignItems: 'center', justifyContent: 'center' },
  saveBtnDisabled: { backgroundColor: COLORS.gray[200] },
  saveBtnPressed: { opacity: 0.85 },
  saveBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },

  // 관리자 웹 추천 관계 링크
  graphLinkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    backgroundColor: COLORS.background.primary,
    borderRadius: RADIUS.xl,
    padding: SPACING.base,
    marginTop: 0,
    marginBottom: SPACING.base,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    ...SHADOWS.sm,
  },
  graphLinkIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primaryPale,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  graphLinkTextWrap: { flex: 1, minWidth: 0 },
  graphLinkTitle: { fontSize: 14, fontWeight: '700', color: COLORS.text.primary },
  graphLinkDesc: { fontSize: 11, color: COLORS.text.muted, marginTop: 2 },
  revenueGraphLinkCard: {
    marginTop: -SPACING.sm,
    borderColor: '#fed7aa',
    backgroundColor: '#fffaf5',
  },
  revenueGraphLinkIconWrap: { backgroundColor: '#ffedd5' },
  revenueGraphTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  sampleBadge: {
    borderRadius: RADIUS.full,
    backgroundColor: '#ffedd5',
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  sampleBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#c2410c',
  },
  bottomContentSpacer: { height: SPACING['4xl'] },

  blockedState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING['4xl'],
    minHeight: 320,
  },
  blockedIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  blockedTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text.primary,
    textAlign: 'center',
    marginBottom: 8,
  },
  blockedDescription: {
    fontSize: 13,
    lineHeight: 20,
    color: COLORS.text.muted,
    textAlign: 'center',
  },
});
