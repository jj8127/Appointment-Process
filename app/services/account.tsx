import * as Clipboard from 'expo-clipboard';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';

import ServiceInformation, { ServiceAction, informationStyles as styles } from '@/components/ServiceInformation';
import { Button } from '@/components/Button';
import { usePlatformAccount } from '@/hooks/use-platform-account';
import { PLATFORM_CONSENT_TEXT, PLATFORM_PRIVACY_POLICY_URL, PLATFORM_SERVICES, PLATFORM_TERMS_VERSION, platformRequest } from '@/lib/platform-api';
import { openExternalUrl } from '@/lib/open-external-url';
import { captureAppSessionOwner } from '@/lib/request-board-api';
import { useReadAttempt } from '@/lib/use-read-attempt';
import { COLORS } from '@/lib/theme';

export default function ServiceAccount() {
  const { data, error, needsConsent, canWithdraw, loading, refresh, session, token } = usePlatformAccount();
  const [copied, setCopied] = useState(false);
  const deleting = useRef(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [consenting, setConsenting] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const consentPending = useRef(false);
  const beginDelete = useReadAttempt();
  useEffect(() => {
    beginDelete(); deleting.current = false; setDeleteError(null); setCopied(false);
    setDeleteLoading(false);
    consentPending.current = false; setConsenting(false); setTermsAccepted(false); setConsentError(null);
  }, [token, beginDelete]);
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
    const owns = captureAppSessionOwner();
    Alert.alert('공통 회원 탈퇴', `공통 서비스 이용 동의를 철회하고 공통 회원 정보의 이름·휴대폰 번호 및 비밀번호를 삭제합니다. 거래·정산 기록과 추천 관계를 연결하는 식별자는 남습니다.${session.role ? '\n기존 보험·FC 업무 계정은 유지됩니다.' : ''}\n진행할까요?`, [
      { text: '취소', style: 'cancel' },
      { text: '탈퇴', style: 'destructive', onPress: () => {
        if (!owns() || deleting.current || consentPending.current) return; deleting.current = true; setDeleteLoading(true); setDeleteError(null);
        const mounted = beginDelete();
        void platformRequest('delete_member', { confirmed: true }, token).then(async () => {
          if (!owns() || !mounted()) return;
          if (session.role) await refresh();
          else { session.logout(); router.replace('/'); }
        })
          .catch((cause) => { if (owns() && mounted()) setDeleteError(cause instanceof Error ? cause.message : '탈퇴하지 못했습니다. 다시 시도해 주세요.'); })
          .finally(() => { if (owns() && mounted()) { deleting.current = false; setDeleteLoading(false); } });
      } },
    ]);
  };
  return <ServiceInformation title="내 정보" account>
    <Text accessibilityRole="header" style={styles.title}>{data ? `${data.member.name}님` : '모두온 계정'}</Text>
    {loading && <Text accessibilityLiveRegion="polite" style={styles.body}>내 정보를 확인하고 있습니다.</Text>}
    {!loading && !session.isPlatformSignedIn && <>
      <Text style={styles.body}>한 번 가입하고 여러 서비스를 이용하세요. 서비스에 필요한 추가 정보는 신청할 때 입력합니다.</Text>
      <ServiceAction label="로그인" onPress={() => router.push('/services/login')} />
      <ServiceAction label="회원가입" onPress={() => router.push('/services/signup')} />
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
    {error && !needsConsent && <View><Text accessibilityRole="alert" style={styles.body}>{error}</Text><ServiceAction label="다시 확인" onPress={() => void refresh()} />{session.isPlatformSignedIn && <ServiceAction label="다시 로그인" onPress={() => { session.logout(); router.replace('/services/login'); }} />}</View>}
    {data && !needsConsent && <>
      <Text style={styles.sectionTitle}>공통 추천 코드</Text>
      <View style={styles.list}>
        <Text selectable style={styles.sectionTitle}>{data.member.referralCode}</Text>
        <Text style={styles.item}>{data.member.referrerId ? '가입 때 연결한 추천 관계를 모든 제휴 서비스에 함께 사용합니다.' : '현재 연결된 추천인이 없습니다.'}</Text>
        <Text style={styles.item}>소개받은 분은 가입할 때 이 코드를 입력하면 됩니다. 보험 증원수당은 기존 업무 화면에서 확인하세요.</Text>
        <ServiceAction label={copied ? '코드를 복사했습니다' : '추천 코드 복사'} onPress={() => {
          void Clipboard.setStringAsync(data.member.referralCode).then(() => setCopied(true)).catch(() => setCopied(false));
        }} />
      </View>
      <Text style={styles.sectionTitle}>제휴 서비스 혜택</Text>
      <Text style={styles.body}>각 제휴사의 정산이 끝난 뒤 7일 이내에 회사가 정한 비율로 지급합니다. 거래와 정산이 확인된 내역만 표시합니다.</Text>
      {data.benefits.length === 0 && <Text style={styles.body}>확정된 혜택 내역이 없습니다.</Text>}
      {data.benefits.map((benefit) => <View style={styles.list} key={benefit.id}>
        <Text style={styles.sectionTitle}>{PLATFORM_SERVICES[benefit.serviceKey]} · {benefit.amount.toLocaleString('ko-KR')}원</Text>
        <Text style={styles.item}>지급 기한 {new Date(benefit.dueAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</Text>
        <Text style={styles.item}>{benefit.status === 'paid' ? '지급 기록 완료' : benefit.status === 'void' ? '취소됨' : '지급 예정'}</Text>
      </View>)}
      <ServiceAction label="서비스 이용내역" onPress={() => router.push('/services/activity')} />
      {session.role && <ServiceAction label="보험 계정 설정" onPress={() => router.push('/settings?surface=service-hub')} />}
      {session.role === 'admin' && !session.readOnly && session.staffType === 'admin' && <ServiceAction label="제휴·정산 관리" onPress={() => router.push('/services/manage')} />}
    </>}
    {session.isPlatformSignedIn && <ServiceAction label="로그아웃" onPress={() => session.logout()} />}
    {needsConsent && session.role && <ServiceAction label="보험 계정 설정" onPress={() => router.push('/settings?surface=service-hub')} />}
    {session.isPlatformSignedIn && canWithdraw && token && <Button variant="outline" loading={deleteLoading} disabled={deleteLoading || consenting} onPress={requestDeletion} fullWidth>공통 회원 탈퇴</Button>}
    {deleteError && <Text accessibilityRole="alert" style={styles.body}>{deleteError}</Text>}
    <Pressable accessibilityRole="link" style={{ minHeight: 44, justifyContent: 'center' }} onPress={() => {
      void openExternalUrl(PLATFORM_PRIVACY_POLICY_URL).catch(() => setConsentError('개인정보처리방침을 열지 못했습니다. 다시 시도해주세요.'));
    }}><Text style={[styles.item, { textDecorationLine: 'underline' }]}>개인정보처리방침</Text></Pressable>
    {!needsConsent && consentError && <Text accessibilityRole="alert" style={styles.body}>{consentError}</Text>}
  </ServiceInformation>;
}
