import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  BackHandler,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { TextInput as TextInputType } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KeyboardAwareWrapper, useKeyboardAware } from '@/components/KeyboardAwareWrapper';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { consumePendingReferralCode } from '@/lib/referral-deeplink';
import { safeStorage } from '@/lib/safe-storage';
import { supabase } from '@/lib/supabase';
import { COLORS, TYPOGRAPHY, SPACING, RADIUS } from '@/lib/theme';
import { validatePhone, validateEmail, validateRequired, normalizePhone } from '@/lib/validation';
import type { CommissionCompletionStatus } from '@/types/fc';

const STORAGE_KEY = 'fc-onboarding/signup';

const AFFILIATION_OPTIONS = [
  '1본부 서선미',
  '2본부 박성훈',
  '3본부 김태희',
  '4본부 현경숙',
  '5본부 최철준',
  '6본부 김정수(박선희)',
  '7본부 김동훈',
  '8본부 정승철',
  '9본부 이현욱(김주용)',
];

const EMAIL_DOMAINS = [
  'naver.com',
  'gmail.com',
  'daum.net',
  'hanmail.net',
  'nate.com',
  '직접입력',
];
const CARRIER_OPTIONS = ['SKT', 'KT', 'LGU+', 'SKT 알뜰폰', 'KT 알뜰폰', 'LGU+ 알뜰폰'];

const COMMISSION_OPTIONS: { value: CommissionCompletionStatus; label: string; sub: string }[] = [
  { value: 'none', label: '미완료', sub: '생명/손해 위촉 모두 진행 예정' },
  { value: 'life_only', label: '생명 완료', sub: '생명 완료, 손해 위촉 진행 예정' },
  { value: 'nonlife_only', label: '손해 완료', sub: '손해 완료, 생명 위촉 진행 예정' },
  { value: 'both', label: '모두 완료', sub: '생명/손해 위촉 모두 완료' },
];

export default function SignupScreen() {
  const [selectedAffiliation, setSelectedAffiliation] = useState('');
  const [commissionStatus, setCommissionStatus] = useState<CommissionCompletionStatus>('none');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [referralStatus, setReferralStatus] = useState<'idle' | 'validating' | 'valid' | 'invalid'>('idle');
  const [referralInviterName, setReferralInviterName] = useState('');
  const [referralInviterFcId, setReferralInviterFcId] = useState<string | null>(null);
  const [referralCodeSource, setReferralCodeSource] = useState<'none' | 'deeplink' | 'manual'>('none');
  const referralDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [emailLocal, setEmailLocal] = useState('');
  const [emailDomain, setEmailDomain] = useState('');
  const [customDomain, setCustomDomain] = useState('');
  const [carrier, setCarrier] = useState('');
  const [showDomainPicker, setShowDomainPicker] = useState(false);
  const [showCarrierPicker, setShowCarrierPicker] = useState(false);
  const [checking, setChecking] = useState(false);
  const keyboardPadding = useKeyboardPadding();
  const { referralNonce } = useLocalSearchParams<{ referralNonce?: string }>();

  // Refs for keyboard navigation
  const nameRef = useRef<TextInputType>(null);
  const phoneRef = useRef<TextInputType>(null);
  const recommenderRef = useRef<TextInputType>(null);
  const emailLocalRef = useRef<TextInputType>(null);
  const customDomainRef = useRef<TextInputType>(null);
  const referralCodeRef = useRef('');
  const referralCodeSourceRef = useRef<'none' | 'deeplink' | 'manual'>('none');
  const referralManualEditVersionRef = useRef(0);
  const pendingReferralApplyRef = useRef<Promise<void> | null>(null);
  const referralValidationRequestRef = useRef(0);

  const { scrollToInput } = useKeyboardAware();

  const handleFocusTarget = (target?: number) => {
    if (!target) return;
    // Android/Fabric에서 키보드 오픈 타이밍으로 첫 스크롤이 누락될 수 있어 짧게 재시도
    scrollToInput(target);
    setTimeout(() => scrollToInput(target), 80);
    setTimeout(() => scrollToInput(target), 220);
  };

  const emailValue = useMemo(() => {
    const domainToUse = emailDomain === '직접입력' ? customDomain : emailDomain;
    return emailLocal && domainToUse ? `${emailLocal}@${domainToUse}` : '';
  }, [emailLocal, emailDomain, customDomain]);

  const handleNext = async () => {
    const affiliationValidation = validateRequired(selectedAffiliation, '소속');
    if (!affiliationValidation.isValid) {
      Alert.alert('입력 확인', affiliationValidation.error);
      return;
    }

    const nameValidation = validateRequired(name, '이름');
    if (!nameValidation.isValid) {
      Alert.alert('입력 확인', nameValidation.error);
      return;
    }

    const phoneValidation = validatePhone(phone);
    if (!phoneValidation.isValid) {
      Alert.alert('입력 확인', phoneValidation.error);
      return;
    }

    const emailValidation = validateEmail(emailValue);
    if (!emailValidation.isValid) {
      Alert.alert('입력 확인', emailValidation.error);
      return;
    }

    const carrierValidation = validateRequired(carrier, '통신사');
    if (!carrierValidation.isValid) {
      Alert.alert('입력 확인', carrierValidation.error);
      return;
    }

    const commissionValidation = validateRequired(commissionStatus, '위촉 상태');
    if (!commissionValidation.isValid) {
      Alert.alert('입력 확인', commissionValidation.error);
      return;
    }

    const digits = normalizePhone(phone);

    // 중복 계정 체크 (OTP 발송 없이 확인만)
    setChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke('request-signup-otp', {
        body: { phone: digits, checkOnly: true },
      });
      if (error) throw error;
      if (!data?.ok) {
        Alert.alert('가입 불가', data?.message ?? '이미 가입된 번호입니다.');
        return;
      }
    } catch (err: any) {
      Alert.alert('오류', err?.message ?? '번호 확인 중 문제가 발생했습니다.');
      return;
    } finally {
      setChecking(false);
    }

    await safeStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        affiliation: selectedAffiliation,
        name: name.trim(),
        phone: digits,
        recommender: referralStatus === 'valid' ? referralInviterName : '',
        referralCode: referralCode.trim().toUpperCase() || undefined,
        referralInviterFcId: referralStatus === 'valid' ? referralInviterFcId ?? undefined : undefined,
        email: emailValue,
        carrier: carrier.trim(),
        commissionStatus,
      }),
    );
    router.push('/signup-verify');
  };

  const validateReferralCode = useCallback(async (
    code: string,
    source: 'none' | 'deeplink' | 'manual' = referralCodeSourceRef.current,
  ) => {
    const trimmed = code.trim().toUpperCase();
    const requestId = referralValidationRequestRef.current + 1;
    referralValidationRequestRef.current = requestId;
    if (!trimmed) {
      setReferralStatus('idle');
      setReferralInviterName('');
      setReferralInviterFcId(null);
      return;
    }
    setReferralStatus('validating');
    try {
      const { data, error } = await supabase.functions.invoke('validate-referral-code', {
        body: { code: trimmed },
      });
      if (
        referralValidationRequestRef.current !== requestId ||
        referralCodeRef.current.trim().toUpperCase() !== trimmed ||
        referralCodeSourceRef.current !== source
      ) {
        return;
      }
      if (error || !data?.valid) {
        setReferralStatus('invalid');
        setReferralInviterName('');
        setReferralInviterFcId(null);
      } else {
        setReferralStatus('valid');
        setReferralInviterName(data.inviterName ?? '');
        setReferralInviterFcId(typeof data.inviterFcId === 'string' ? data.inviterFcId : null);
      }
    } catch {
      if (
        referralValidationRequestRef.current !== requestId ||
        referralCodeRef.current.trim().toUpperCase() !== trimmed ||
        referralCodeSourceRef.current !== source
      ) {
        return;
      }
      setReferralStatus('idle');
      setReferralInviterName('');
      setReferralInviterFcId(null);
    }
  }, []);

  const handleReferralCodeChange = (text: string) => {
    const upper = text.toUpperCase();
    referralManualEditVersionRef.current += 1;
    referralCodeRef.current = upper;
    referralCodeSourceRef.current = 'manual';
    setReferralCode(upper);
    setReferralCodeSource('manual');
    setReferralStatus('idle');
    setReferralInviterName('');
    setReferralInviterFcId(null);
    if (referralDebounceRef.current) clearTimeout(referralDebounceRef.current);
    referralDebounceRef.current = setTimeout(() => validateReferralCode(upper, 'manual'), 400);
  };

  const handleReferralCodeBlur = () => {
    if (referralDebounceRef.current) clearTimeout(referralDebounceRef.current);
    validateReferralCode(referralCodeRef.current, referralCodeSourceRef.current);
  };

  useEffect(() => () => {
    if (referralDebounceRef.current) clearTimeout(referralDebounceRef.current);
  }, []);

  useEffect(() => {
    referralCodeRef.current = referralCode;
  }, [referralCode]);

  useEffect(() => {
    referralCodeSourceRef.current = referralCodeSource;
  }, [referralCodeSource]);

  const handleBack = useCallback(() => {
    router.replace('/login');
  }, []);

  const applyPendingReferralCode = useCallback(() => {
    if (pendingReferralApplyRef.current) {
      return pendingReferralApplyRef.current.finally(() => applyPendingReferralCode());
    }

    const applyPromise = (async () => {
      const manualEditVersionAtStart = referralManualEditVersionRef.current;
      const code = await consumePendingReferralCode();
      const normalizedCode = code?.trim().toUpperCase() ?? '';
      if (!normalizedCode) return;
      if (referralManualEditVersionRef.current !== manualEditVersionAtStart) return;
      if (
        referralCodeSourceRef.current === 'deeplink' &&
        referralCodeRef.current === normalizedCode
      ) {
        return;
      }

      if (referralDebounceRef.current) {
        clearTimeout(referralDebounceRef.current);
        referralDebounceRef.current = null;
      }
      referralCodeRef.current = normalizedCode;
      referralCodeSourceRef.current = 'deeplink';
      setReferralCode(normalizedCode);
      setReferralCodeSource('deeplink');
      setReferralInviterName('');
      setReferralInviterFcId(null);
      recommenderRef.current?.setNativeProps({ text: normalizedCode });
      await validateReferralCode(normalizedCode, 'deeplink');
    })();

    pendingReferralApplyRef.current = applyPromise.finally(() => {
      if (pendingReferralApplyRef.current === applyPromise) {
        pendingReferralApplyRef.current = null;
      }
    });

    return pendingReferralApplyRef.current;
  }, [validateReferralCode]);

  useFocusEffect(
    useCallback(() => {
      const onHardwareBack = () => {
        handleBack();
        return true;
      };
      const subscription = BackHandler.addEventListener('hardwareBackPress', onHardwareBack);
      return () => subscription.remove();
    }, [handleBack]),
  );

  useFocusEffect(
    useCallback(() => {
      void applyPendingReferralCode();
    }, [applyPendingReferralCode]),
  );

  useEffect(() => {
    if (!referralNonce) return;
    void applyPendingReferralCode();
  }, [applyPendingReferralCode, referralNonce]);

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <LinearGradient
        colors={['#ffffff', '#fff1e6']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
      <KeyboardAwareWrapper
        contentContainerStyle={[styles.container, { paddingBottom: Math.max(160, keyboardPadding + 120) }]}
        extraScrollHeight={220}
        keyboardDismissMode="on-drag"
      >
        <View style={styles.hero}>
          <Text style={styles.heroEyebrow}>회원가입</Text>
          <Text style={styles.title}>기본 정보를 입력해주세요</Text>
          <Text style={styles.caption}>입력 후 비밀번호 설정 단계로 이동합니다.</Text>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>기본 정보</Text>
          <View style={styles.affiliationBox}>
            {AFFILIATION_OPTIONS.map((opt) => {
              const active = selectedAffiliation === opt;
              return (
                <Pressable
                  key={opt}
                  style={[styles.affiliationItem, active && styles.affiliationActive]}
                  onPress={() => setSelectedAffiliation(opt)}
                >
                  <Text style={[styles.affiliationText, active && styles.affiliationTextActive]}>{opt}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>이름</Text>
            <TextInput
              ref={nameRef}
              style={styles.input}
              placeholder="홍길동"
              placeholderTextColor={COLORS.text.muted}
              value={name}
              onChangeText={setName}
              returnKeyType="next"
              onFocus={(e) => handleFocusTarget(e.nativeEvent.target)}
              onSubmitEditing={() => phoneRef.current?.focus()}
              blurOnSubmit={false}
              scrollEnabled={false}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>현재 위촉 상태</Text>
            <View style={styles.commissionBox}>
              {COMMISSION_OPTIONS.map((opt) => {
                const active = commissionStatus === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    style={[styles.commissionItem, active && styles.commissionItemActive]}
                    onPress={() => setCommissionStatus(opt.value)}
                  >
                    <Text style={[styles.commissionLabel, active && styles.commissionLabelActive]}>{opt.label}</Text>
                    <Text style={[styles.commissionSub, active && styles.commissionSubActive]}>{opt.sub}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>연락처 및 이메일</Text>
          <View style={styles.field}>
            <Text style={styles.label}>휴대폰 번호</Text>
            <TextInput
              ref={phoneRef}
              style={styles.input}
              placeholder="번호 입력 (- 없이 숫자만)"
              placeholderTextColor={COLORS.text.muted}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              returnKeyType="next"
              onFocus={(e) => handleFocusTarget(e.nativeEvent.target)}
              onSubmitEditing={() => {
                setShowCarrierPicker(true);
              }}
              blurOnSubmit={false}
              scrollEnabled={false}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>통신사</Text>
            <Pressable style={styles.selectBox} onPress={() => setShowCarrierPicker(true)}>
              <TextInput
                style={[styles.input, styles.inputWithIcon]}
                placeholder="통신사 선택"
                placeholderTextColor={COLORS.text.muted}
                value={carrier}
                editable={false}
                pointerEvents="none"
              />
              <View style={styles.selectOverlay}>
                <Feather name="chevron-down" size={20} color={COLORS.text.secondary} />
              </View>
            </Pressable>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>추천 코드 (선택)</Text>
            <TextInput
              ref={recommenderRef}
              style={styles.input}
              placeholder="8자리 추천 코드"
              placeholderTextColor={COLORS.text.muted}
              onChangeText={handleReferralCodeChange}
              onBlur={handleReferralCodeBlur}
              autoCapitalize="none"
              maxLength={8}
              returnKeyType="next"
              onFocus={(e) => handleFocusTarget(e.nativeEvent.target)}
              onSubmitEditing={() => emailLocalRef.current?.focus()}
              blurOnSubmit={false}
              scrollEnabled={false}
            />
            {referralStatus === 'validating' && (
              <Text style={{ fontSize: 12, color: COLORS.text.muted, marginTop: 4 }}>
                확인 중...
              </Text>
            )}
            {referralStatus === 'valid' && (
              <Text style={{ fontSize: 12, color: '#16a34a', marginTop: 4 }}>
                ✓ {referralInviterName}님이 추천하셨어요
              </Text>
            )}
            {referralStatus === 'invalid' && referralCode.length > 0 && (
              <Text style={{ fontSize: 12, color: COLORS.error, marginTop: 4 }}>
                유효하지 않은 추천 코드입니다
              </Text>
            )}
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>이메일</Text>
            <View style={styles.emailRow}>
              <TextInput
                ref={emailLocalRef}
                style={[styles.input, styles.emailLocal]}
                placeholder="이메일 아이디"
                placeholderTextColor={COLORS.text.muted}
                value={emailLocal}
                onChangeText={(txt) => setEmailLocal(txt.trim())}
                autoCapitalize="none"
                keyboardType="email-address"
                returnKeyType="next"
                onFocus={(e) => handleFocusTarget(e.nativeEvent.target)}
                onSubmitEditing={() => {
                  if (emailDomain === '직접입력') {
                    customDomainRef.current?.focus();
                  } else {
                    setShowDomainPicker(true);
                  }
                }}
                blurOnSubmit={false}
                scrollEnabled={false}
              />
              <Text style={styles.emailAt}>@</Text>
              <View style={{ flex: 1 }}>
                <Pressable style={styles.emailDomainBox} onPress={() => setShowDomainPicker(true)}>
                  <TextInput
                    style={[styles.input, styles.inputWithIcon]}
                    placeholder="도메인 선택"
                    placeholderTextColor={COLORS.text.muted}
                    value={emailDomain}
                    editable={false}
                    pointerEvents="none"
                  />
                  <View style={styles.selectOverlay}>
                    <Feather name="chevron-down" size={20} color={COLORS.text.secondary} />
                  </View>
                </Pressable>

                {emailDomain === '직접입력' ? (
                  <TextInput
                    ref={customDomainRef}
                    style={[styles.input, styles.customDomainInput]}
                    placeholder="직접 입력"
                    placeholderTextColor={COLORS.text.muted}
                    value={customDomain}
                    onChangeText={(txt) => setCustomDomain(txt.trim())}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    returnKeyType="done"
                    onFocus={(e) => handleFocusTarget(e.nativeEvent.target)}
                    onSubmitEditing={handleNext}
                    scrollEnabled={false}
                  />
                ) : null}
              </View>
            </View>
          </View>

        </View>

        <Pressable style={[styles.primaryButton, checking && { opacity: 0.6 }]} onPress={handleNext} disabled={checking}>
          <Text style={styles.primaryButtonText}>{checking ? '확인 중...' : '비밀번호 설정으로 이동'}</Text>
        </Pressable>

        <Pressable style={styles.linkButton} onPress={() => router.replace('/login')}>
          <Text style={styles.linkButtonText}>이미 계정이 있어요</Text>
        </Pressable>
      </KeyboardAwareWrapper>

      <Modal visible={showDomainPicker} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setShowDomainPicker(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>도메인 선택</Text>
            <View style={styles.modalOptions}>
              {EMAIL_DOMAINS.map((domain) => (
                <Pressable
                  key={domain}
                  style={styles.modalOption}
                  onPress={() => {
                    setEmailDomain(domain);
                    if (domain !== '직접입력') setCustomDomain('');
                    setShowDomainPicker(false);
                    if (domain === '직접입력') {
                      setTimeout(() => customDomainRef.current?.focus(), 100);
                    }
                  }}
                >
                  <Text style={styles.modalOptionText}>{domain}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable style={styles.modalCancel} onPress={() => setShowDomainPicker(false)}>
              <Text style={styles.modalCancelText}>취소</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal visible={showCarrierPicker} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setShowCarrierPicker(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>통신사 선택</Text>
            <View style={styles.modalOptions}>
              {CARRIER_OPTIONS.map((value) => (
                <Pressable
                  key={value}
                  style={styles.modalOption}
                  onPress={() => {
                    setCarrier(value);
                    setShowCarrierPicker(false);
                    setTimeout(() => recommenderRef.current?.focus(), 100);
                  }}
                >
                  <Text style={styles.modalOptionText}>{value}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable style={styles.modalCancel} onPress={() => setShowCarrierPicker(false)}>
              <Text style={styles.modalCancelText}>취소</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.white },
  container: { padding: SPACING.lg, gap: SPACING.lg },
  hero: { gap: SPACING.sm, paddingVertical: SPACING.sm },
  heroEyebrow: { color: COLORS.primary, fontWeight: TYPOGRAPHY.fontWeight.bold, fontSize: TYPOGRAPHY.fontSize.base },
  title: { fontSize: TYPOGRAPHY.fontSize['3xl'], fontWeight: TYPOGRAPHY.fontWeight.extrabold, color: COLORS.text.primary, lineHeight: 34 },
  caption: { color: COLORS.text.secondary, lineHeight: TYPOGRAPHY.lineHeight.relaxed * TYPOGRAPHY.fontSize.md, fontSize: TYPOGRAPHY.fontSize.md },
  sectionCard: {
    backgroundColor: COLORS.white,
    padding: SPACING.base,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    gap: SPACING.md,
  },
  sectionTitle: { fontWeight: TYPOGRAPHY.fontWeight.extrabold, fontSize: TYPOGRAPHY.fontSize.xl, color: COLORS.text.primary },
  affiliationBox: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  affiliationItem: {
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.md,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: COLORS.white,
  },
  affiliationActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryPale },
  affiliationText: { color: COLORS.text.primary, fontSize: TYPOGRAPHY.fontSize.md },
  affiliationTextActive: { color: COLORS.primary, fontWeight: TYPOGRAPHY.fontWeight.bold },
  commissionBox: {
    gap: SPACING.xs,
  },
  commissionItem: {
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.base,
    backgroundColor: COLORS.white,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 2,
  },
  commissionItemActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryPale,
  },
  commissionLabel: {
    color: COLORS.text.primary,
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
  },
  commissionLabelActive: {
    color: COLORS.primary,
  },
  commissionSub: {
    color: COLORS.text.secondary,
    fontSize: TYPOGRAPHY.fontSize.xs,
  },
  commissionSubActive: {
    color: COLORS.primary,
  },
  field: { gap: 6 },
  label: { fontWeight: TYPOGRAPHY.fontWeight.bold, color: COLORS.text.primary, fontSize: TYPOGRAPHY.fontSize.md },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.base,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: COLORS.white,
    fontSize: TYPOGRAPHY.fontSize.md,
    color: COLORS.text.primary,
    height: 52,
    lineHeight: 20,
    textAlignVertical: 'center',
  },
  inputWithIcon: {
    paddingRight: 44,
  },
  selectBox: {
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.base,
    overflow: 'hidden',
    justifyContent: 'center',
    height: 52,
    backgroundColor: COLORS.white,
  },
  selectPicker: {
    color: COLORS.text.primary,
    marginLeft: -10,
    marginRight: -10,
    paddingLeft: SPACING.md,
    fontSize: TYPOGRAPHY.fontSize.md,
  },
  primaryButton: {
    marginTop: SPACING.sm,
    marginBottom: SPACING.xl,
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.lg,
    borderRadius: RADIUS.md,
    alignItems: 'center',
  },
  primaryButtonText: { color: COLORS.white, fontWeight: TYPOGRAPHY.fontWeight.extrabold, fontSize: TYPOGRAPHY.fontSize.lg },
  linkButton: {
    alignItems: 'center',
    paddingVertical: SPACING.sm,
  },
  linkButtonText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.text.secondary,
    fontWeight: TYPOGRAPHY.fontWeight.semibold,
    textDecorationLine: 'underline',
  },
  emailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
  },
  emailLocal: {
    flex: 0.9,
    minWidth: 0,
  },
  emailAt: {
    fontWeight: TYPOGRAPHY.fontWeight.extrabold,
    color: COLORS.text.primary,
    fontSize: TYPOGRAPHY.fontSize.md,
    marginTop: SPACING.md,
  },
  emailDomainBox: {
    flex: 1.1,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.base,
    overflow: 'hidden',
    justifyContent: 'center',
    height: 54,
    backgroundColor: COLORS.white,
  },
  selectOverlay: {
    position: 'absolute',
    right: SPACING.md,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    width: SPACING['2xl'],
  },
  emailPicker: {
    color: COLORS.text.primary,
    marginLeft: -10,
    marginRight: -10,
    paddingLeft: SPACING.md,
    fontSize: TYPOGRAPHY.fontSize.md,
  },
  customDomainInput: {
    marginTop: SPACING.xs,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.base,
    padding: SPACING.sm,
    backgroundColor: COLORS.white,
    fontSize: TYPOGRAPHY.fontSize.md,
    height: 44,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: COLORS.background.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    padding: SPACING.base,
  },
  modalTitle: { fontSize: TYPOGRAPHY.fontSize.md, fontWeight: TYPOGRAPHY.fontWeight.extrabold, color: COLORS.text.primary, marginBottom: SPACING.md },
  modalOptions: { gap: SPACING.sm },
  modalOption: {
    paddingVertical: 10,
    paddingHorizontal: SPACING.sm,
    borderRadius: RADIUS.base,
    backgroundColor: COLORS.background.secondary,
  },
  modalOptionText: { fontSize: TYPOGRAPHY.fontSize.sm, fontWeight: TYPOGRAPHY.fontWeight.semibold, color: COLORS.text.primary },
  modalCancel: {
    marginTop: SPACING.md,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: RADIUS.base,
    backgroundColor: COLORS.gray[100],
  },
  modalCancelText: { fontSize: TYPOGRAPHY.fontSize.sm, fontWeight: TYPOGRAPHY.fontWeight.bold, color: COLORS.gray[600] },
});
