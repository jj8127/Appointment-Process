import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KeyboardAwareWrapper, useKeyboardAware } from '@/components/KeyboardAwareWrapper';
import { Skeleton } from '@/components/LoadingSkeleton';
import { ReferralAncestorsChain } from '@/components/ReferralAncestorsChain';
import { ReferralTreeNode, type DescendantNode } from '@/components/ReferralTreeNode';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useMyReferralCode } from '@/hooks/use-my-referral-code';
import { useReferralTree } from '@/hooks/use-referral-tree';
import { useSession } from '@/hooks/use-session';
import { consumePendingReferralCode } from '@/lib/referral-deeplink';
import { supabase } from '@/lib/supabase';
import { COLORS, RADIUS, SHADOWS, SPACING } from '@/lib/theme';

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.jj8127.Garam_in';
const APP_STORE_URL = (process.env.EXPO_PUBLIC_APP_STORE_URL ?? '').trim();
const INVITE_BASE_URL = process.env.EXPO_PUBLIC_INVITE_BASE_URL ?? '';
const ADMIN_WEB_URL = (process.env.EXPO_PUBLIC_ADMIN_WEB_URL ?? '').replace(/\/$/, '');

function buildShareText(code: string): string {
  const iosInstallLine = APP_STORE_URL
    ? `iOS: ${APP_STORE_URL}`
    : 'iOS: App Store에서 "가람in" 검색';

  if (INVITE_BASE_URL) {
    const inviteUrl = `${INVITE_BASE_URL}/invite?code=${code}`;
    return [
      '가람in에서 보험 위촉을 함께 시작해요!',
      '',
      '아래 링크를 눌러 가입하세요 (추천 코드 자동 입력):',
      inviteUrl,
      '',
      '앱이 없으시면:',
      `Android: ${PLAY_STORE_URL}`,
      iosInstallLine,
    ].join('\n');
  }
  // INVITE_BASE_URL 미설정 시: 커스텀 스킴은 메신저에서 링크로 인식되지 않으므로
  // 스토어 링크(HTTPS)를 사용하고 코드를 텍스트로 안내
  return [
    '가람in에서 보험 위촉을 함께 시작해요!',
    '',
    `추천 코드: ${code}`,
    '',
    '가입 시 위 코드를 입력하면 추천인으로 연결됩니다.',
    '',
    `Android: ${PLAY_STORE_URL}`,
    iosInstallLine,
  ].join('\n');
}

type FcSearchResult = {
  fcId: string;
  name: string;
  affiliation: string;
  code: string | null;
};

type ReferralSearchFieldProps = {
  searchQuery: string;
  searching: boolean;
  onChangeText: (text: string) => void;
  onClear: () => void;
};

function ReferralSearchField({
  searchQuery,
  searching,
  onChangeText,
  onClear,
}: ReferralSearchFieldProps) {
  const { scrollToInput } = useKeyboardAware();

  const handleFocusTarget = (target?: number | null) => {
    if (!target) return;
    scrollToInput(target);
    setTimeout(() => scrollToInput(target), 80);
    setTimeout(() => scrollToInput(target), 220);
  };

  return (
    <View style={styles.searchInputWrap}>
      <Feather name="search" size={16} color={COLORS.text.muted} />
      <TextInput
        style={styles.searchInputField}
        placeholder="이름, 소속 또는 추천 코드 입력"
        placeholderTextColor={COLORS.text.muted}
        value={searchQuery}
        onChangeText={onChangeText}
        onFocus={(e) => handleFocusTarget(e.nativeEvent.target)}
        autoCapitalize="none"
        returnKeyType="search"
      />
      {searching && (
        <ActivityIndicator size="small" color={COLORS.primary} style={{ marginLeft: 4 }} />
      )}
      {searchQuery.length > 0 && !searching && (
        <Pressable onPress={onClear} hitSlop={8}>
          <Feather name="x" size={16} color={COLORS.text.muted} />
        </Pressable>
      )}
    </View>
  );
}

export default function ReferralPage() {
  const { appSessionToken, role, readOnly, isRequestBoardDesigner } = useSession();
  const isManager = role === 'admin' && readOnly === true;
  const canUseReferralSelfService =
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
    refetch: refetchReferralTree,
    loadChildrenOf,
  } = useReferralTree({ depth: 2 });
  const keyboardPadding = useKeyboardPadding();

  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [editMode, setEditMode] = useState(false);

  // 검색 상태
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FcSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<FcSearchResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchReqRef = useRef(0);
  const { referralNonce } = useLocalSearchParams<{ referralNonce?: string }>();
  const referralCode = referralInfo?.code ?? null;
  const currentRecommender = referralInfo?.recommender ?? null;
  const currentRecommenderAffiliation = referralInfo?.recommenderAffiliation ?? null;
  const currentRecommenderCode = referralInfo?.recommenderCode ?? null;
  const referralInfoErrorMessage =
    referralInfoError instanceof Error
      ? referralInfoError.message
      : '추천인 정보를 불러오지 못했습니다.';
  const showRecommenderCard =
    !currentRecommender || editMode || referralLoading || referralInfoError || referralTreeError;
  const showRecommenderEditor =
    !referralLoading && !referralInfoError && (!currentRecommender || editMode);
  const showRecommenderFallbackSummary =
    !referralLoading && !referralInfoError && Boolean(currentRecommender) && referralTreeError && !editMode;

  // 검색
  const runSearch = useCallback(async (q: string) => {
    if (!canUseReferralSelfService || !appSessionToken || q.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    const reqId = ++searchReqRef.current;
    setSearching(true);
    try {
      const { data, error } = await supabase.functions.invoke<{
        ok: boolean; results?: FcSearchResult[];
      }>('search-fc-for-referral', {
        body: { query: q },
        headers: { 'x-app-session-token': appSessionToken },
      });
      if (reqId !== searchReqRef.current) return;
      if (!error && data?.ok) setSearchResults(data.results ?? []);
      else setSearchResults([]);
    } catch {
      if (reqId === searchReqRef.current) setSearchResults([]);
    } finally {
      if (reqId === searchReqRef.current) setSearching(false);
    }
  }, [appSessionToken, canUseReferralSelfService]);

  // 딥링크로 전달된 추천 코드: 편집 모드 진입 후 코드로 자동 검색
  useEffect(() => {
    if (!referralNonce || !canUseReferralSelfService) return;
    (async () => {
      const code = await consumePendingReferralCode();
      if (!code) return;
      setEditMode(true);
      setSearchQuery(code);
      void runSearch(code);
    })();
  }, [referralNonce, canUseReferralSelfService, runSearch]);

  const handleSearchChange = (text: string) => {
    setSearchQuery(text);
    setSelected(null);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (text.length < 2) { setSearchResults([]); return; }
    searchTimerRef.current = setTimeout(() => runSearch(text), 350);
  };

  const handleSelect = (item: FcSearchResult) => {
    setSelected(item);
    setSearchQuery('');
    setSearchResults([]);
    Haptics.selectionAsync();
  };

  const handleClearSelected = () => {
    setSelected(null);
    setSearchQuery('');
    setSearchResults([]);
  };

  // 저장
  const handleSave = async () => {
    if (!canUseReferralSelfService || !selected?.code || !appSessionToken) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke<{
        ok: boolean; inviterName?: string; message?: string;
      }>('update-my-recommender', {
        body: { code: selected.code },
        headers: { 'x-app-session-token': appSessionToken },
      });
      if (error || !data?.ok) {
        Alert.alert('저장 실패', data?.message ?? '추천인 저장에 실패했습니다.');
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const savedName = selected.name;
      setSelected(null);
      setSearchQuery('');
      setEditMode(false);
      await Promise.all([refetchReferralInfo(), refetchReferralTree()]);
      Alert.alert('저장 완료', `추천인이 '${data.inviterName ?? savedName}'(으)로 저장됐습니다.`);
    } catch {
      Alert.alert('오류', '저장 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  };

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

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      if (!canUseReferralSelfService || !appSessionToken) {
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

      const alreadyLoaded = referralTree?.descendants?.some((node) => node.parentFcId === fcId);
      if (alreadyLoaded) {
        setExpandedIds((prev) => new Set([...prev, fcId]));
        return;
      }

      setLoadingIds((prev) => new Set([...prev, fcId]));
      try {
        await loadChildrenOf(fcId);
        setExpandedIds((prev) => new Set([...prev, fcId]));
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
    [expandedIds, loadChildrenOf, referralTree],
  );

  const rootDescendants: DescendantNode[] =
    referralTree?.descendants?.filter((node) => referralTree.root && node.parentFcId === referralTree.root.fcId) ?? [];
  const totalTreeDescendants = referralTree?.root.totalDescendantCount ?? 0;
  const showResults = searchResults.length > 0 && !selected;
  const blockedContent = !canUseReferralSelfService;

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <KeyboardAwareWrapper
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(SPACING['5xl'], keyboardPadding + 200) },
        ]}
        extraScrollHeight={180}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.primary} />
        }
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
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
        <LinearGradient
          colors={['#f36f21', '#fabc3c']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.codeCard}
        >
          <View style={styles.deco1} />
          <View style={styles.deco2} />
          <View style={styles.codeCardInner}>
            <Text style={styles.codeCardLabel}>내 추천 코드</Text>
            {referralLoading ? (
              <View style={{ marginVertical: 12 }}>
                <Skeleton width={180} height={40} borderRadius={8} />
              </View>
            ) : referralInfoError ? (
              <Text style={styles.codeEmpty}>{referralInfoErrorMessage}</Text>
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
        </LinearGradient>

        {/* ── 추천인 등록/변경 카드 ── */}
        {showRecommenderCard && (
        <View style={styles.recommenderCard}>
          <View style={styles.recommenderHeader}>
            <View style={styles.recommenderIconWrap}>
              <Feather name="heart" size={16} color={COLORS.primary} />
            </View>
            <Text style={styles.recommenderTitle}>
              {currentRecommender ? '추천인 변경' : '추천인 등록'}
            </Text>
          </View>

          {/* 로딩 중 */}
          {referralLoading && (
            <Skeleton width="60%" height={20} borderRadius={4} style={{ marginBottom: SPACING.md }} />
          )}

          {/* 오류 */}
          {!referralLoading && referralInfoError && (
            <Text style={styles.currentRecommenderError}>{referralInfoErrorMessage}</Text>
          )}

          {showRecommenderFallbackSummary && (
            <>
              <View style={styles.divider} />
              <Text style={styles.treeFallbackHint}>
                관계 구조를 잠시 못 불러와도 추천인은 여기서 계속 변경할 수 있어요.
              </Text>
              <View style={styles.currentRecommenderFallbackCard}>
                <View style={styles.currentRecommenderFallbackAvatar}>
                  <Feather name="user-check" size={16} color={COLORS.primary} />
                </View>
                <View style={styles.currentRecommenderFallbackInfo}>
                  <Text style={styles.currentRecommenderFallbackName} numberOfLines={1}>
                    {currentRecommender}
                  </Text>
                  {currentRecommenderAffiliation ? (
                    <Text style={styles.currentRecommenderFallbackAffiliation} numberOfLines={1}>
                      {currentRecommenderAffiliation}
                    </Text>
                  ) : null}
                  {currentRecommenderCode ? (
                    <Text style={styles.currentRecommenderFallbackCode} numberOfLines={1}>
                      {currentRecommenderCode}
                    </Text>
                  ) : null}
                </View>
              </View>
              <Pressable
                style={({ pressed }) => [styles.fallbackChangeBtn, pressed && styles.fallbackChangeBtnPressed]}
                onPress={() => setEditMode(true)}
              >
                <Text style={styles.fallbackChangeBtnText}>추천인 변경하기</Text>
              </Pressable>
            </>
          )}

          {/* 미등록 또는 editMode */}
          {showRecommenderEditor && (
            <>
              <View style={styles.divider} />

              {/* 검색 입력 */}
              <Text style={styles.inputLabel}>
                이름, 소속 또는 추천 코드로 {currentRecommender ? '변경' : '등록'}
              </Text>

              {/* 선택된 항목이 없을 때 → 검색 입력창 */}
              {!selected && (
                <ReferralSearchField
                  searchQuery={searchQuery}
                  searching={searching}
                  onChangeText={handleSearchChange}
                  onClear={() => {
                    setSearchQuery('');
                    setSearchResults([]);
                  }}
                />
              )}

              {/* 검색 결과 목록 */}
              {showResults && (
                <View style={styles.resultsList}>
                  {searchResults.map((item) => (
                    <Pressable
                      key={item.fcId}
                      style={({ pressed }) => [styles.resultItem, pressed && styles.resultItemPressed]}
                      onPress={() => handleSelect(item)}
                    >
                      <View style={styles.resultAvatar}>
                        <Feather name="user" size={14} color={COLORS.gray[500]} />
                      </View>
                      <View style={styles.resultInfo}>
                        <Text style={styles.resultName} numberOfLines={1}>{item.name}</Text>
                        <Text style={styles.resultAffiliation} numberOfLines={1}>{item.affiliation}</Text>
                      </View>
                      {item.code ? (
                        <View style={styles.resultCodeBadge}>
                          <Text style={styles.resultCodeText}>{item.code}</Text>
                        </View>
                      ) : (
                        <Text style={styles.resultNoCode}>코드 없음</Text>
                      )}
                    </Pressable>
                  ))}
                </View>
              )}

              {/* 검색어 2글자 미만 안내 */}
              {searchQuery.length > 0 && searchQuery.length < 2 && !selected && (
                <Text style={styles.searchHint}>2글자 이상 입력하면 검색돼요</Text>
              )}

              {/* 검색 결과 없음 */}
              {searchQuery.length >= 2 && !searching && searchResults.length === 0 && !selected && (
                <Text style={styles.searchHint}>검색 결과가 없어요</Text>
              )}

              {/* 선택된 항목 표시 */}
              {selected && (
                <View style={styles.selectedWrap}>
                  <View style={styles.selectedInfo}>
                    <View style={styles.selectedAvatar}>
                      <Feather name="user-check" size={16} color={COLORS.primary} />
                    </View>
                    <View style={styles.selectedText}>
                      <Text style={styles.selectedName}>{selected.name}</Text>
                      <Text style={styles.selectedAffiliation}>{selected.affiliation}</Text>
                      {selected.code && (
                        <Text style={styles.selectedCode}>{selected.code}</Text>
                      )}
                    </View>
                    <Pressable onPress={handleClearSelected} hitSlop={8} style={styles.clearBtn}>
                      <Feather name="x" size={18} color={COLORS.text.muted} />
                    </Pressable>
                  </View>

                  {!selected.code && (
                    <View style={styles.noCodeWarning}>
                      <Feather name="alert-circle" size={13} color={COLORS.warning.dark} />
                      <Text style={styles.noCodeWarningText}>이 분의 추천 코드가 없어 저장할 수 없습니다.</Text>
                    </View>
                  )}

                  <Pressable
                    style={({ pressed }) => [
                      styles.saveBtn,
                      (!selected.code || saving) && styles.saveBtnDisabled,
                      pressed && selected.code && styles.saveBtnPressed,
                    ]}
                    onPress={handleSave}
                    disabled={!selected.code || saving}
                  >
                    {saving
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Text style={styles.saveBtnText}>저장</Text>
                    }
                  </Pressable>
                </View>
              )}

              {/* 취소하기 버튼 (editMode일 때만) */}
              {editMode && (
                <Pressable
                  style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.7 }]}
                  onPress={() => {
                    setEditMode(false);
                    setSelected(null);
                    setSearchQuery('');
                    setSearchResults([]);
                  }}
                >
                  <Feather name="x" size={14} color={COLORS.text.secondary} />
                  <Text style={styles.cancelBtnText}>취소하기</Text>
                </Pressable>
              )}
            </>
          )}
        </View>
        )}

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
            <Text style={styles.treeErrorTitle}>추천 관계 정보를 가져오지 못했어요</Text>
            <Text style={styles.treeErrorDesc}>추천인 코드와 추천인 변경은 계속 사용할 수 있고, 관계 구조만 다시 불러오면 됩니다.</Text>
            <Pressable
              style={({ pressed }) => [styles.treeRetryBtn, pressed && { opacity: 0.85 }]}
              onPress={() => refetchReferralTree()}
            >
              <Text style={styles.treeRetryBtnText}>관계 구조 다시 불러오기</Text>
            </Pressable>
          </View>
        ) : referralTree ? (
          <>
            <View style={styles.treeSectionHeader}>
              <Feather name="arrow-up-circle" size={15} color={COLORS.primary} />
              <Text style={styles.treeSectionTitle}>나를 추천한 경로</Text>
              {!!currentRecommender && !editMode && !referralLoading && !referralInfoError && (
                <Pressable
                  style={({ pressed }) => [styles.treeHeaderAction, pressed && styles.treeHeaderActionPressed]}
                  onPress={() => setEditMode(true)}
                >
                  <Text style={styles.treeHeaderActionText}>변경하기</Text>
                </Pressable>
              )}
            </View>
            <View style={styles.treeSectionCard}>
              <ReferralAncestorsChain ancestors={referralTree.ancestors} self={referralTree.root} />
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

            {isManager && !!ADMIN_WEB_URL && (
              <Pressable
                style={({ pressed }) => [styles.graphLinkCard, pressed && { opacity: 0.7 }]}
                onPress={() => Linking.openURL(`${ADMIN_WEB_URL}/dashboard/referrals/graph`)}
                accessibilityRole="link"
                accessibilityLabel="PC 브라우저에서 관리자 그래프 뷰 열기"
              >
                <View style={styles.graphLinkIconWrap}>
                  <Feather name="share-2" size={18} color={COLORS.primary} />
                </View>
                <View style={styles.graphLinkTextWrap}>
                  <Text style={styles.graphLinkTitle}>PC 브라우저에서 그래프 뷰로 보기</Text>
                  <Text style={styles.graphLinkDesc}>모바일에서는 표시가 다를 수 있습니다</Text>
                </View>
                <Feather name="external-link" size={15} color={COLORS.gray[400]} />
              </Pressable>
            )}
            <View style={styles.bottomContentSpacer} />
          </>
        ) : null}
          </>
        )}
      </KeyboardAwareWrapper>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background.secondary },
  scroll: { flex: 1 },
  scrollContent: { padding: SPACING.base, paddingBottom: SPACING['4xl'] },

  // 내 코드 카드
  codeCard: { borderRadius: RADIUS.xl, padding: SPACING.lg, marginBottom: SPACING.base, overflow: 'hidden', position: 'relative', ...SHADOWS.lg },
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

  // 본부장 그래프 링크
  graphLinkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    backgroundColor: COLORS.background.primary,
    borderRadius: RADIUS.xl,
    padding: SPACING.base,
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
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
