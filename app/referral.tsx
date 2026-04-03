import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useMyInvitees } from '@/hooks/use-my-invitees';
import { useMyReferralCode } from '@/hooks/use-my-referral-code';
import { useSession } from '@/hooks/use-session';
import { COLORS, RADIUS, SHADOWS, SPACING } from '@/lib/theme';

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.jj8127.Garam_in';

function buildShareText(code: string): string {
  const deeplink = `hanwhafcpass://signup?code=${code}`;
  return [
    '가람in에서 보험 위촉을 함께 시작해요!',
    '',
    '앱이 있으시면 아래 링크로 가입하세요 (추천 코드 자동 입력):',
    deeplink,
    '',
    '앱이 없으시면:',
    `Android: ${PLAY_STORE_URL}`,
    'iOS: App Store에서 "가람in" 검색',
  ].join('\n');
}

type StatusInfo = { label: string; color: string; bg: string };

function getStatusInfo(status: string): StatusInfo {
  switch (status) {
    case 'confirmed':
      return { label: '연결됨', color: COLORS.success, bg: COLORS.successLight };
    case 'captured':
    case 'pending_signup':
      return { label: '대기중', color: COLORS.gray[500], bg: COLORS.gray[100] };
    default:
      return { label: '미연결', color: COLORS.error, bg: COLORS.errorLight };
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
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
  const canUseReferralSelfService =
    !isRequestBoardDesigner && (role === 'fc' || (role === 'admin' && readOnly));
  const {
    data: referralInfo,
    isLoading: referralLoading,
    error: referralInfoError,
    refetch: refetchReferralInfo,
  } = useMyReferralCode();
  const { data: invitees, isLoading: inviteesLoading, refetch: refetchInvitees } = useMyInvitees();
  const keyboardPadding = useKeyboardPadding();

  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // 검색 상태
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FcSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<FcSearchResult | null>(null);
  const [saving, setSaving] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchReqRef = useRef(0);
  const referralCode = referralInfo?.code ?? null;
  const currentRecommender = referralInfo?.recommender ?? null;
  const referralInfoErrorMessage =
    referralInfoError instanceof Error
      ? referralInfoError.message
      : '추천인 정보를 불러오지 못했습니다.';

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
        headers: { Authorization: `Bearer ${appSessionToken}` },
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
        headers: { Authorization: `Bearer ${appSessionToken}` },
      });
      if (error || !data?.ok) {
        Alert.alert('저장 실패', data?.message ?? '추천인 저장에 실패했습니다.');
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSelected(null);
      setSearchQuery('');
      await refetchReferralInfo();
      Alert.alert('저장 완료', `추천인이 '${data.inviterName ?? selected.name}'(으)로 저장됐습니다.`);
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
      await Promise.all([refetchReferralInfo(), refetchInvitees()]);
    } finally {
      setRefreshing(false);
    }
  };

  const inviteeList = invitees ?? [];
  const showResults = searchResults.length > 0 && !selected;
  const blockedContent = !canUseReferralSelfService;

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <KeyboardAwareWrapper
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(SPACING['4xl'], keyboardPadding + 140) },
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
          </View>
        </LinearGradient>

        {/* 공유 안내 배너 */}
        <View style={styles.infoBanner}>
          <Feather name="info" size={14} color={COLORS.info} style={{ marginTop: 1 }} />
          <Text style={styles.infoBannerText}>
            링크를 공유하면 상대방이 가입할 때 추천 코드가 자동으로 입력돼요.{'\n'}앱이 없는 경우 Play Store / App Store에서 {'"'}가람in{'"'}을 설치한 뒤 코드를 직접 입력해 주세요.
          </Text>
        </View>

        {/* ── 내 추천인 카드 ── */}
        <View style={styles.recommenderCard}>
          <View style={styles.recommenderHeader}>
            <View style={styles.recommenderIconWrap}>
              <Feather name="heart" size={16} color={COLORS.primary} />
            </View>
            <Text style={styles.recommenderTitle}>내 추천인</Text>
          </View>

          {/* 현재 추천인 */}
          {referralLoading ? (
            <Skeleton width="60%" height={20} borderRadius={4} style={{ marginBottom: SPACING.md }} />
          ) : referralInfoError ? (
            <Text style={styles.currentRecommenderError}>{referralInfoErrorMessage}</Text>
          ) : (
            <View style={styles.currentRecommenderRow}>
              <Text style={styles.currentRecommenderLabel}>현재 추천인</Text>
              <Text style={[
                styles.currentRecommenderValue,
                !currentRecommender && styles.currentRecommenderEmpty,
              ]}>
                {currentRecommender ?? '등록된 추천인 없음'}
              </Text>
            </View>
          )}

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
        </View>

        {/* ── 내가 초대한 사람들 ── */}
        <View style={[styles.sectionHeader, { marginTop: SPACING.sm }]}>
          <Text style={styles.sectionTitle}>내가 초대한 사람들</Text>
          {!inviteesLoading && inviteeList.length > 0 && (
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{inviteeList.length}명</Text>
            </View>
          )}
        </View>

        {inviteesLoading ? (
          <View style={styles.skeletonList}>
            <Skeleton width="100%" height={72} borderRadius={RADIUS.lg} style={{ marginBottom: 10 }} />
            <Skeleton width="100%" height={72} borderRadius={RADIUS.lg} style={{ marginBottom: 10 }} />
            <Skeleton width="100%" height={72} borderRadius={RADIUS.lg} />
          </View>
        ) : inviteeList.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconWrap}>
              <Feather name="user-plus" size={32} color={COLORS.gray[300]} />
            </View>
            <Text style={styles.emptyTitle}>아직 초대한 사람이 없어요</Text>
            <Text style={styles.emptyDesc}>추천 코드를 공유하면 여기에 표시됩니다.</Text>
          </View>
        ) : (
          <View style={styles.inviteeList}>
            {inviteeList.map((item) => {
              const statusInfo = getStatusInfo(item.status);
              const name = item.inviteeName ?? item.inviteePhone ?? '알 수 없음';
              const dateStr = item.confirmedAt
                ? `연결 ${formatDate(item.confirmedAt)}`
                : `초대 ${formatDate(item.capturedAt)}`;
              return (
                <View key={item.id} style={styles.inviteeCard}>
                  <View style={styles.inviteeAvatar}>
                    <Feather name="user" size={18} color={COLORS.gray[400]} />
                  </View>
                  <View style={styles.inviteeInfo}>
                    <Text style={styles.inviteeName} numberOfLines={1}>{name}</Text>
                    <Text style={styles.inviteeDate}>{dateStr}</Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: statusInfo.bg }]}>
                    <Text style={[styles.statusText, { color: statusInfo.color }]}>{statusInfo.label}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        <Text style={styles.footerNote}>
          가입 완료 후 {'\''}연결됨{'\''}으로 표시됩니다.
        </Text>
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
  codeCard: { borderRadius: RADIUS.xl, padding: SPACING.xl, marginBottom: SPACING.base, overflow: 'hidden', position: 'relative', ...SHADOWS.lg },
  deco1: { position: 'absolute', top: -30, right: -30, width: 120, height: 120, borderRadius: 60, backgroundColor: 'rgba(255,255,255,0.1)' },
  deco2: { position: 'absolute', bottom: -20, left: -20, width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(255,255,255,0.08)' },
  codeCardInner: { zIndex: 1 },
  codeCardLabel: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.85)', marginBottom: 8, letterSpacing: 0.5 },
  codeText: { fontSize: 34, fontWeight: '800', color: '#fff', letterSpacing: 6, marginBottom: 20, ...Platform.select({ ios: { fontVariant: ['tabular-nums'] } }) },
  codeEmpty: { fontSize: 16, color: 'rgba(255,255,255,0.7)', marginBottom: 12, marginTop: 4 },
  codeActions: { flexDirection: 'row', gap: 10 },
  codeBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff', paddingHorizontal: 14, paddingVertical: 9, borderRadius: RADIUS.full },
  codeBtnPressed: { opacity: 0.8 },
  codeBtnText: { fontSize: 13, fontWeight: '700', color: COLORS.primary },

  // 배너
  infoBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: COLORS.infoLight, borderRadius: RADIUS.md, padding: SPACING.md, marginBottom: SPACING.base },
  infoBannerText: { flex: 1, fontSize: 12, color: COLORS.info, lineHeight: 18 },

  // 추천인 카드
  recommenderCard: { backgroundColor: COLORS.background.primary, borderRadius: RADIUS.xl, padding: SPACING.base, marginBottom: SPACING.base, ...SHADOWS.sm },
  recommenderHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: SPACING.md },
  recommenderIconWrap: { width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.primaryPale, alignItems: 'center', justifyContent: 'center' },
  recommenderTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text.primary },
  currentRecommenderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACING.md },
  currentRecommenderLabel: { fontSize: 13, color: COLORS.text.muted },
  currentRecommenderValue: { fontSize: 14, fontWeight: '600', color: COLORS.text.primary },
  currentRecommenderEmpty: { color: COLORS.text.muted, fontWeight: '400' },
  currentRecommenderError: { fontSize: 13, color: COLORS.error, marginBottom: SPACING.md },
  divider: { height: 1, backgroundColor: COLORS.border.light, marginBottom: SPACING.md },
  inputLabel: { fontSize: 13, fontWeight: '600', color: COLORS.text.secondary, marginBottom: 8 },

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

  // 섹션 헤더
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: SPACING.md },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text.primary },
  countBadge: { backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 2 },
  countBadgeText: { fontSize: 11, fontWeight: '700', color: '#fff' },

  // 스켈레톤
  skeletonList: { marginBottom: SPACING.base },

  // 빈 상태
  emptyState: { alignItems: 'center', paddingVertical: SPACING['3xl'], paddingHorizontal: SPACING.xl },
  emptyIconWrap: { width: 72, height: 72, borderRadius: 36, backgroundColor: COLORS.gray[100], alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.md },
  emptyTitle: { fontSize: 15, fontWeight: '600', color: COLORS.text.secondary, marginBottom: 6 },
  emptyDesc: { fontSize: 13, color: COLORS.text.muted, textAlign: 'center' },

  // 초대 목록
  inviteeList: { gap: 10, marginBottom: SPACING.base },
  inviteeCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.background.primary, borderRadius: RADIUS.lg, padding: SPACING.md, gap: 12, ...SHADOWS.sm },
  inviteeAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.gray[100], alignItems: 'center', justifyContent: 'center' },
  inviteeInfo: { flex: 1 },
  inviteeName: { fontSize: 14, fontWeight: '600', color: COLORS.text.primary, marginBottom: 3 },
  inviteeDate: { fontSize: 12, color: COLORS.text.muted },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADIUS.full },
  statusText: { fontSize: 12, fontWeight: '700' },

  // 하단 안내
  footerNote: { fontSize: 12, color: COLORS.text.muted, textAlign: 'center', marginTop: SPACING.md },
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
