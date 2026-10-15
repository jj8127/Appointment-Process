import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Share, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { Button } from '@/components/Button';
import { useToast } from '@/components/Toast';
import { usePlatformAccount } from '@/hooks/use-platform-account';
import { platformRequest, type PlatformServiceReferral } from '@/lib/platform-api';
import { buildReferralInviteUrl, buildReferralShareText } from '@/lib/referral-share';
import { normalizeReferralInviteCode } from '@/lib/referral-deeplink';
import { COLORS } from '@/lib/theme';
import { useReadAttempt } from '@/lib/use-read-attempt';

export default function FamilyCareInvitation() {
  const { data, error, needsConsent, loading, refresh, session, token } = usePlatformAccount();
  const { showToast } = useToast();
  const { width, fontScale } = useWindowDimensions();
  // Family care has its own referral code; the common member code is not shared.
  const memberId = data?.member.id;
  const [code, setCode] = useState<string | null>(null);
  const [codeState, setCodeState] = useState<'idle' | 'loading' | 'error'>('idle');
  const beginCode = useReadAttempt();
  const loadCode = useCallback(async () => {
    const owns = beginCode();
    setCode(null);
    if (!token || !memberId || needsConsent) { setCodeState('idle'); return; }
    setCodeState('loading');
    try {
      const result = await platformRequest<PlatformServiceReferral>('get_service_referral', { serviceKey: 'care', issueCode: true }, token);
      if (owns()) { setCode(normalizeReferralInviteCode(result.code)); setCodeState('idle'); }
    } catch {
      if (owns()) setCodeState('error');
    }
  }, [beginCode, token, memberId, needsConsent]);
  useEffect(() => { void loadCode(); }, [loadCode]);
  const retry = () => { if (error || !memberId) void refresh(); else void loadCode(); };
  const [pending, setPending] = useState<'copy' | 'share' | null>(null);
  const pendingRef = useRef(false);
  const owner = `${token ?? ''}:${memberId ?? ''}:${code}`;
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const available = useRef(false);
  available.current = Boolean(session.isPlatformSignedIn && token && !loading && !error && !needsConsent && codeState === 'idle' && code);
  const begin = useReadAttempt();
  useEffect(() => { begin(); pendingRef.current = false; setPending(null); }, [owner, begin]);

  const login = () => router.navigate({ pathname: '/services/login', params: { service: 'care' } });
  const invite = async (action: 'copy' | 'share') => {
    if (!available.current || !code || currentOwner.current !== owner || pendingRef.current) return;
    const actionOwner = owner;
    const current = begin();
    if (!current()) return;
    pendingRef.current = true; setPending(action);
    try {
      if (action === 'copy') {
        await Clipboard.setStringAsync(buildReferralInviteUrl(code, process.env.EXPO_PUBLIC_INVITE_BASE_URL, 'care'));
        if (current() && available.current && currentOwner.current === actionOwner) showToast({ message: '추천 주소를 복사했어요', variant: 'success' });
      } else {
        await Share.share({ title: '모두온 가족간병 소개', message: buildReferralShareText({
          code, service: 'care', inviteBaseUrl: process.env.EXPO_PUBLIC_INVITE_BASE_URL,
          appStoreUrl: process.env.EXPO_PUBLIC_APP_STORE_URL,
        }) });
      }
    } catch {
      if (current() && available.current && currentOwner.current === actionOwner) showToast({
        message: action === 'copy' ? '주소를 복사하지 못했어요. 다시 눌러 주세요.' : '공유창을 열지 못했어요. 추천 주소를 복사해 전달해 주세요.',
        variant: 'error',
      });
    } finally {
      if (current() && currentOwner.current === actionOwner) { pendingRef.current = false; setPending(null); }
    }
  };

  return <View style={styles.card}>
    <Text accessibilityRole="header" style={styles.title}>가족간병 소개하기</Text>
    <Text style={styles.body}>내 초대 링크로 가입하거나 링크에서 확인한 분은 나를 가족간병 추천인으로 등록해요.</Text>
    {loading || codeState === 'loading' ? <Text accessibilityLiveRegion="polite" style={styles.note}>추천 코드를 확인하고 있어요.</Text>
      : !session.isPlatformSignedIn ? <Button variant="outline" onPress={login} fullWidth>로그인하고 초대하기</Button>
      : needsConsent ? <>
        <Text style={styles.note}>공통 서비스 이용 동의 후 초대할 수 있어요.</Text>
        <Button variant="outline" onPress={() => router.navigate('/services/account')} fullWidth>동의하고 초대 준비하기</Button>
      </> : error || codeState === 'error' ? <>
        <Text accessibilityRole="alert" style={styles.note}>추천 코드를 불러오지 못했어요. 다시 확인하거나 로그인해 주세요.</Text>
        <Button variant="outline" onPress={retry} fullWidth>다시 확인</Button>
        <Button variant="ghost" onPress={() => { session.logout(); login(); }} fullWidth>다시 로그인</Button>
      </> : !code ? <>
        <Text accessibilityRole="alert" style={styles.note}>추천 코드를 확인할 수 없어요. 다시 확인해 주세요.</Text>
        <Button variant="outline" onPress={retry} fullWidth>다시 확인</Button>
      </> : <>
        <View style={styles.codeRow}>
          <Text style={styles.codeLabel}>내 가족간병 추천 코드</Text>
          <Text selectable style={styles.code}>{code}</Text>
        </View>
        <View style={[styles.actions, (width < 360 || fontScale > 1.15) && styles.stacked]}>
          <Button variant="outline" style={styles.button} textStyle={styles.buttonText} disabled={pending !== null} loading={pending === 'copy'}
            accessibilityLabel="추천 주소 복사" accessibilityHint="내 추천 코드가 포함된 가족간병 초대 주소를 복사합니다"
            leftIcon={<Feather accessible={false} name="copy" size={17} color={COLORS.warning.dark} />} onPress={() => void invite('copy')}>추천 주소 복사</Button>
          <Button variant="outline" style={[styles.button, styles.shareButton]} textStyle={styles.buttonText} disabled={pending !== null} loading={pending === 'share'}
            accessibilityLabel="공유하기" accessibilityHint="가족간병 소개 문구와 초대 주소를 휴대폰 공유창으로 전달합니다"
            leftIcon={<Feather accessible={false} name="share-2" size={17} color={COLORS.warning.dark} />} onPress={() => void invite('share')}>공유하기</Button>
        </View>
        <Text style={styles.note}>링크가 열리지 않으면 가족간병 안내의 가족간병 추천인에 이 코드를 입력하면 돼요. 이미 가족간병 추천인이 있는 분은 바뀌지 않아요.</Text>
      </>}
  </View>;
}

const styles = StyleSheet.create({
  card: { marginTop: 28, padding: 18, borderRadius: 16, backgroundColor: COLORS.warning.light, gap: 12 },
  title: { fontSize: 19, lineHeight: 27, fontWeight: '700', color: COLORS.text.primary },
  body: { fontSize: 14, lineHeight: 23, color: COLORS.text.secondary },
  codeRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingVertical: 12, borderTopWidth: 1, borderTopColor: COLORS.warning.border },
  codeLabel: { fontSize: 13, color: COLORS.text.secondary },
  code: { fontSize: 19, lineHeight: 27, fontWeight: '700', letterSpacing: 1, color: COLORS.text.primary },
  actions: { flexDirection: 'row', gap: 10 },
  stacked: { flexDirection: 'column' },
  button: { flex: 1, minHeight: 48, paddingHorizontal: 8, paddingVertical: 13, borderWidth: 1, borderColor: COLORS.warning.border },
  buttonText: { fontSize: 13, color: COLORS.warning.dark },
  shareButton: { backgroundColor: COLORS.primaryPale },
  note: { fontSize: 12, lineHeight: 20, color: COLORS.text.secondary },
});
