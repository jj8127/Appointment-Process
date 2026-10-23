import { randomUUID } from 'expo-crypto';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';

import { ActionRows, type ActionRow } from '@/components/SelectionControls';
import ServiceInformation, { ServiceAction, informationStyles as styles } from '@/components/ServiceInformation';
import { Button } from '@/components/Button';
import { usePlatformAccount } from '@/hooks/use-platform-account';
import { useAppLogout } from '@/hooks/use-app-logout';
import { PARTNER_ADMIN_IN_APP, PLATFORM_CONSENT_TEXT, PLATFORM_PRIVACY_POLICY_URL, PLATFORM_SERVICES, PLATFORM_TERMS_VERSION, PLATFORM_WITHDRAWAL_VERSION, platformRequest, type PlatformWithdrawal, type PlatformWithdrawalStatus } from '@/lib/platform-api';
import { openExternalUrl } from '@/lib/open-external-url';
import { captureAppSessionOwner } from '@/lib/request-board-api';
import { useReadAttempt } from '@/lib/use-read-attempt';
import { COLORS, SPACING } from '@/lib/theme';
import { resetTo } from '@/lib/back-navigation';

export default function ServiceAccount() {
  const { data, error, signedOut, needsConsent, canWithdraw, loading, refresh, session, token } = usePlatformAccount();
  const logoutAll = useAppLogout('/', 'service-hub');
  const logoutRef = useRef(logoutAll);
  logoutRef.current = logoutAll;
  const deleting = useRef(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [deletionCheckFailed, setDeletionCheckFailed] = useState(false);
  const deletionRequest = useRef<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [consenting, setConsenting] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const consentPending = useRef(false);
  const beginDelete = useReadAttempt();
  const applyWithdrawal = useCallback((receipt: PlatformWithdrawal) => {
    deletionRequest.current = receipt.operationId;
    if (receipt.status === 'pending') {
      setDeletePending(true);
      setDeleteError(receipt.reason === 'affiliate_identity_unbound'
        ? '제휴 계정 연결 확인이 필요해 탈퇴가 아직 완료되지 않았습니다. 회사에 연결 확인을 요청해 주세요.'
        : '일부 제휴 계정 또는 첨부자료 정리가 아직 완료되지 않았습니다. 같은 요청으로 다시 확인해 주세요.');
    } else {
      deletionRequest.current = null;
      logoutRef.current();
    }
  }, []);
  const checkWithdrawal = useCallback(async () => {
    if (!token || deleting.current) return;
    const owns = captureAppSessionOwner();
    const mounted = beginDelete();
    deleting.current = true; setDeleteLoading(true); setDeletionCheckFailed(false);
    try {
      const result = await platformRequest<PlatformWithdrawalStatus>('get_withdrawal', {}, token);
      if (!owns() || !mounted()) return;
      if (result.withdrawal) applyWithdrawal(result.withdrawal);
      else { deletionRequest.current = null; setDeletePending(false); setDeleteError(null); }
    } catch {
      if (owns() && mounted()) {
        setDeletionCheckFailed(true);
        setDeleteError('이전 탈퇴 요청을 확인하지 못했습니다. 다시 확인한 뒤 진행해 주세요.');
      }
    } finally {
      if (owns() && mounted()) { deleting.current = false; setDeleteLoading(false); }
    }
  }, [token, beginDelete, applyWithdrawal]);
  useEffect(() => {
    beginDelete(); deleting.current = false; setDeleteError(null);
    setDeleteLoading(false); setDeletePending(false); setDeletionCheckFailed(false); deletionRequest.current = null;
    consentPending.current = false; setConsenting(false); setTermsAccepted(false); setConsentError(null);
    void checkWithdrawal();
  }, [token, beginDelete, checkWithdrawal]);
  const acceptTerms = async () => {
    if (!token || !termsAccepted || consentPending.current || deleting.current) return;
    consentPending.current = true; setConsenting(true); setConsentError(null);
    const owns = beginDelete();
    try {
      await platformRequest('accept_terms', { termsAccepted: true, termsVersion: PLATFORM_TERMS_VERSION }, token);
      if (owns()) await refresh();
    } catch (cause) {
      if (owns()) setConsentError(cause instanceof Error ? cause.message : '동의를 저장하지 못했습니다. 다시 시도해주세요.');
    } finally {
      if (owns()) { consentPending.current = false; setConsenting(false); }
    }
  };
  const requestDeletion = () => {
    if (deleting.current || consentPending.current || !token) return;
    if (deletionCheckFailed) { void checkWithdrawal(); return; }
    const owns = captureAppSessionOwner();
    const mounted = beginDelete();
    Alert.alert('모두온·제휴 계정 탈퇴', `모두온 계정과 가족간병·보험(가람in)·통신·렌탈·자동차·제휴병원 등 모든 서비스의 개인정보와 로그인 정보, 가람링크 계정을 삭제하고 접속을 종료합니다. 가람in만 탈퇴하려면 보험 계정 설정의 가람in 탈퇴를 이용하세요. 관리자·본부장 등 회사 업무 계정은 유지됩니다. 거래·정산 기록과 추천 관계를 연결하는 식별자는 남습니다.${deletePending ? '\n아직 완료되지 않은 탈퇴 요청을 이어서 확인합니다.' : ''}\n진행할까요?`, [
      { text: '취소', style: 'cancel' },
      { text: '탈퇴', style: 'destructive', onPress: () => {
        if (!owns() || !mounted() || deleting.current || consentPending.current) return; deleting.current = true; setDeleteLoading(true); setDeleteError(null);
        const idempotencyKey = deletionRequest.current ?? (deletionRequest.current = randomUUID());
        void platformRequest<PlatformWithdrawal>('withdraw_member', { confirmed: true, scope: 'all_affiliates', policyVersion: PLATFORM_WITHDRAWAL_VERSION, idempotencyKey }, token).then((receipt) => {
          if (!owns() || !mounted()) return;
          applyWithdrawal(receipt);
        })
          .catch((cause) => { if (owns() && mounted()) {
            setDeletePending(true);
            setDeleteError(cause instanceof Error ? cause.message : '탈퇴 처리 결과를 확인하지 못했습니다. 같은 요청으로 다시 시도해 주세요.');
          } })
          .finally(() => { if (owns() && mounted()) { deleting.current = false; setDeleteLoading(false); } });
      } },
    ]);
  };
  const insuranceSettings: ActionRow = { label: '보험 계정 설정', icon: 'manage-accounts', tone: 'violet', onPress: () => router.push('/settings?surface=service-hub') };
  // Settings-style rows; the account screen keeps one filled button only where a step needs it.
  const actions: ActionRow[] = [
    ...(data && !needsConsent ? [
      { label: '서비스 이용내역', icon: 'receipt-long', tone: 'blue', onPress: () => router.navigate('/services/activity') } as ActionRow,
      ...(session.role ? [insuranceSettings] : []),
      ...(PARTNER_ADMIN_IN_APP && session.role === 'admin' && !session.readOnly && session.staffType === 'admin'
        ? [{ label: '제휴·정산 관리', icon: 'handshake', tone: 'orange', onPress: () => router.navigate('/services/manage') } as ActionRow] : []),
    ] : []),
    ...(needsConsent && session.role ? [insuranceSettings] : []),
    ...(session.isPlatformSignedIn ? [{ label: '로그아웃', icon: 'logout', tone: 'slate', onPress: () => session.logout() } as ActionRow] : []),
  ];
  const relogin = () => { session.logout(); resetTo(router, '/services/login'); };
  return <ServiceInformation title="내 정보" account>
    <Text accessibilityRole="header" style={styles.title}>{data ? `${data.member.name}님` : '모두온 계정'}</Text>
    {loading && <Text accessibilityLiveRegion="polite" style={styles.body}>내 정보를 확인하고 있습니다.</Text>}
    {!loading && !session.isPlatformSignedIn && <>
      <Text style={styles.body}>한 번 가입하고 여러 서비스를 이용하세요. 서비스에 필요한 추가 정보는 신청할 때 입력합니다.</Text>
      <ServiceAction label="로그인" onPress={() => router.navigate('/services/login')} />
      <ServiceAction label="회원가입" onPress={() => router.navigate('/services/signup')} />
    </>}
    {needsConsent && <View>
      <Text style={styles.sectionTitle}>공통 서비스 이용 동의</Text>
      <Text style={styles.body}>{PLATFORM_CONSENT_TEXT}</Text>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: termsAccepted, disabled: consenting }} disabled={consenting}
        onPress={() => setTermsAccepted(value => !value)} style={[styles.list, { flexDirection: 'row', alignItems: 'center' }]}>
        <Feather accessible={false} name={termsAccepted ? 'check-square' : 'square'} size={22} color={termsAccepted ? COLORS.primary : COLORS.gray[500]} />
        <Text style={[styles.item, { flex: 1 }]}>[필수] 위 개인정보 수집·이용에 동의합니다.</Text>
      </Pressable>
      {consentError && <Text accessibilityRole="alert" style={styles.body}>{consentError}</Text>}
      <Button loading={consenting} disabled={!termsAccepted || consenting || deleteLoading} onPress={acceptTerms} fullWidth>동의하고 계속하기</Button>
    </View>}
    {error && !needsConsent && <View><Text accessibilityRole="alert" style={styles.body}>{error}</Text>
      {/* One filled action: signing in when the session was rejected, otherwise reading again. */}
      {signedOut ? <ServiceAction label="다시 로그인" onPress={relogin} /> : <>
        <ServiceAction label="다시 확인" onPress={() => void refresh()} />
        {session.isPlatformSignedIn && <Button variant="ghost" onPress={relogin}>다시 로그인</Button>}
      </>}</View>}
    {data && !needsConsent && <>
      <Text style={styles.sectionTitle}>제휴 서비스 혜택</Text>
      <Text style={styles.body}>각 제휴사의 정산이 끝난 뒤 7일 이내에 회사가 정한 비율로 지급합니다. 거래와 정산이 확인된 내역만 표시합니다.</Text>
      {data.benefits.length === 0 && <Text style={styles.body}>확정된 혜택 내역이 없습니다.</Text>}
      {data.benefits.map((benefit) => <View style={styles.list} key={benefit.id}>
        <Text style={styles.sectionTitle}>{PLATFORM_SERVICES[benefit.serviceKey]} · {benefit.amount.toLocaleString('ko-KR')}원</Text>
        <Text style={styles.item}>지급 기한 {new Date(benefit.dueAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</Text>
        <Text style={styles.item}>{benefit.status === 'paid' ? '지급 기록 완료' : benefit.status === 'void' ? '취소됨' : '지급 예정'}</Text>
      </View>)}
    </>}
    <View style={accountStyles.actions}>
      {actions.length > 0 && <ActionRows items={actions} />}
      {session.isPlatformSignedIn && (canWithdraw || deletePending || deletionCheckFailed) && token && <Button variant="ghost" size="sm" loading={deleteLoading} disabled={deleteLoading || consenting} onPress={requestDeletion} textStyle={accountStyles.withdraw}>{deletionCheckFailed ? '탈퇴 요청 다시 확인' : deletePending ? '탈퇴 처리 재시도' : '공통 회원 탈퇴'}</Button>}
      {deleteError && <Text accessibilityRole="alert" style={styles.body}>{deleteError}</Text>}
      <Pressable accessibilityRole="link" style={{ minHeight: 44, justifyContent: 'center' }} onPress={() => {
        void openExternalUrl(PLATFORM_PRIVACY_POLICY_URL).catch(() => setConsentError('개인정보처리방침을 열지 못했습니다. 다시 시도해주세요.'));
      }}><Text style={[styles.item, { textDecorationLine: 'underline' }]}>개인정보처리방침</Text></Pressable>
      {!needsConsent && consentError && <Text accessibilityRole="alert" style={styles.body}>{consentError}</Text>}
    </View>
  </ServiceInformation>;
}

const accountStyles = {
  actions: { gap: SPACING.md, marginTop: SPACING.sm },
  withdraw: { color: COLORS.gray[500], fontWeight: '500' as const },
};
