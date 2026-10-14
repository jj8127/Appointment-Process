import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { FormInput } from '@/components/FormInput';
import { useSession } from '@/hooks/use-session';
import { platformRequest, type PlatformServiceReferral, type PlatformServiceReferralPreview } from '@/lib/platform-api';
import { normalizeReferralInviteCode } from '@/lib/referral-deeplink';
import { COLORS } from '@/lib/theme';
import { useReadAttempt } from '@/lib/use-read-attempt';

const failureMessage = (cause: unknown) => cause instanceof Error ? cause.message : '추천인 정보를 처리하지 못했어요. 다시 시도해 주세요.';

/**
 * Registers the signed member's family-care referrer, either from a care
 * invitation link (`inviteCode`) or by a code typed in 내 정보. The first
 * registration is final; the server refuses a different referrer later.
 */
export default function FamilyCareReferrer({ inviteCode }: { inviteCode?: string | null }) {
  const session = useSession();
  const token = session.platformSessionToken ?? session.appSessionToken;
  const invite = normalizeReferralInviteCode(inviteCode);
  const begin = useReadAttempt();
  const [state, setState] = useState<PlatformServiceReferral | null>(null);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState('');
  const [preview, setPreview] = useState<{ code: string; name: string } | null>(null);
  const [pending, setPending] = useState<'preview' | 'bind' | null>(null);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const owns = begin();
    pendingRef.current = false; setPending(null); setPreview(null); setError(null); setState(null);
    if (!token) { setLoading(false); return; }
    setLoading(true);
    try {
      const next = await platformRequest<PlatformServiceReferral>('get_service_referral', { serviceKey: 'care' }, token);
      if (!owns()) return;
      setState(next);
      if (!next.referrer && invite) {
        const found = await platformRequest<PlatformServiceReferralPreview>('preview_service_referral', { serviceKey: 'care', referralCode: invite }, token);
        if (owns()) setPreview({ code: invite, name: found.referrerName });
      }
    } catch (cause) {
      if (owns()) setError(failureMessage(cause));
    } finally {
      if (owns()) setLoading(false);
    }
  }, [begin, token, invite]);
  useEffect(() => { void load(); }, [load]);

  const check = async () => {
    if (!token || pendingRef.current) return;
    const code = normalizeReferralInviteCode(input);
    if (!code) { setError('추천 코드 8자리 또는 12자리를 확인해 주세요.'); return; }
    const owns = begin();
    pendingRef.current = true; setPending('preview'); setError(null);
    try {
      const found = await platformRequest<PlatformServiceReferralPreview>('preview_service_referral', { serviceKey: 'care', referralCode: code }, token);
      if (owns()) setPreview({ code, name: found.referrerName });
    } catch (cause) {
      if (owns()) setError(failureMessage(cause));
    } finally {
      if (owns()) { pendingRef.current = false; setPending(null); }
    }
  };

  const register = async () => {
    if (!token || !preview || pendingRef.current) return;
    const owns = begin();
    pendingRef.current = true; setPending('bind'); setError(null);
    try {
      await platformRequest('bind_service_referral', { serviceKey: 'care', referralCode: preview.code,
        source: preview.code === invite ? 'invite_confirmed' : 'manual' }, token);
      if (owns()) void load();
    } catch (cause) {
      if (owns()) { setError(failureMessage(cause)); pendingRef.current = false; setPending(null); }
    }
  };

  if (!token) return null;
  return <View style={styles.card}>
    <Text accessibilityRole="header" style={styles.title}>가족간병 추천인</Text>
    {loading ? <Text accessibilityLiveRegion="polite" style={styles.note}>가족간병 추천인을 확인하고 있어요.</Text>
      : state?.referrer ? <>
        <Text style={styles.body}>{state.referrer.name}님이 가족간병 추천인으로 등록되어 있어요.</Text>
        <Text style={styles.note}>등록한 추천인은 앱에서 바꿀 수 없어요. 추천인은 제휴 서비스마다 따로 등록해요.</Text>
      </> : !state ? <>
        {error ? <Text accessibilityRole="alert" style={styles.note}>{error}</Text> : null}
        <Button variant="outline" onPress={() => void load()} fullWidth>다시 확인</Button>
      </> : preview ? <>
        <Text style={styles.body}>{preview.name}님을 가족간병 추천인으로 등록할까요?</Text>
        <Text style={styles.note}>등록한 뒤에는 앱에서 바꿀 수 없어요.</Text>
        {error ? <Text accessibilityRole="alert" style={styles.note}>{error}</Text> : null}
        <Button loading={pending === 'bind'} disabled={pending !== null} onPress={() => void register()} fullWidth>추천인으로 등록</Button>
        <Button variant="ghost" disabled={pending !== null} onPress={() => { setPreview(null); setError(null); }} fullWidth>등록하지 않기</Button>
      </> : <>
        <Text style={styles.body}>가족간병을 소개받았다면 소개한 분의 추천 코드를 입력해 주세요.</Text>
        <FormInput label="가족간병 추천 코드" accessibilityLabel="가족간병 추천 코드" value={input} autoCapitalize="characters"
          onChangeText={value => { setInput(value); setError(null); }} editable={pending === null} maxLength={12} />
        {error ? <Text accessibilityRole="alert" style={styles.note}>{error}</Text> : null}
        <Button variant="outline" loading={pending === 'preview'} disabled={pending !== null} onPress={() => void check()} fullWidth>추천인 확인</Button>
      </>}
  </View>;
}

const styles = StyleSheet.create({
  card: { marginTop: 20, marginBottom: 8, padding: 18, borderRadius: 16, backgroundColor: COLORS.gray[50], gap: 12 },
  title: { fontSize: 17, lineHeight: 25, fontWeight: '700', color: COLORS.text.primary },
  body: { fontSize: 14, lineHeight: 23, color: COLORS.text.primary },
  note: { fontSize: 12, lineHeight: 20, color: COLORS.text.secondary },
});
