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
import {
  REFERRAL_SEARCH_EMPTY_HINT,
  REFERRAL_SEARCH_MIN_CHARS_HINT,
  ReferralSearchField,
  ReferralSearchResultList,
  type ReferralSearchResult,
} from '@/components/ReferralSearchField';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { consumePendingReferralCode, savePendingReferralCode } from '@/lib/referral-deeplink';
import { useSession } from '@/hooks/use-session';
import { safeStorage } from '@/lib/safe-storage';
import {
  buildStoredSignupReferral,
  getSignupReferralSelectionError,
  runSinglePendingReferralApply,
} from '@/lib/signup-referral';
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
const REFERRAL_SEARCH_ERROR_MESSAGE = '추천인 검색을 지금 사용할 수 없습니다. 잠시 후 다시 시도해주세요.';

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
  const [referralStatus, setReferralStatus] = useState<'idle' | 'validating' | 'valid' | 'invalid'>('idle');
  const [referralInviterName, setReferralInviterName] = useState('');
  const [referralInviterFcId, setReferralInviterFcId] = useState<string | null>(null);
  const [referralSearchQuery, setReferralSearchQuery] = useState('');
  const [referralSearchResults, setReferralSearchResults] = useState<ReferralSearchResult[]>([]);
  const [referralSearching, setReferralSearching] = useState(false);
  const [referralSearchError, setReferralSearchError] = useState<string | null>(null);
  const [selectedReferral, setSelectedReferral] = useState<ReferralSearchResult | null>(null);
  const referralSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [emailLocal, setEmailLocal] = useState('');
  const [emailDomain, setEmailDomain] = useState('');
  const [customDomain, setCustomDomain] = useState('');
  const [carrier, setCarrier] = useState('');
  const [showDomainPicker, setShowDomainPicker] = useState(false);
  const [showCarrierPicker, setShowCarrierPicker] = useState(false);
  const [checking, setChecking] = useState(false);
  const keyboardPadding = useKeyboardPadding();
  const { referralNonce } = useLocalSearchParams<{ referralNonce?: string }>();
  const { role, hydrated } = useSession();

  // Refs for keyboard navigation
  const nameRef = useRef<TextInputType>(null);
  const phoneRef = useRef<TextInputType>(null);
  const referralSearchInputRef = useRef<TextInputType>(null);
  const emailLocalRef = useRef<TextInputType>(null);
  const customDomainRef = useRef<TextInputType>(null);
  const referralEditVersionRef = useRef(0);
  const pendingReferralApplyStateRef = useRef<{ promise: Promise<void> | null }>({ promise: null });
  const referralValidationRequestRef = useRef(0);
  const referralSearchRequestRef = useRef(0);
  const selectedReferralCodeRef = useRef('');

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

    const referralSelectionError = getSignupReferralSelectionError(
      referralSearchQuery,
      selectedReferral,
    );
    if (referralSelectionError) {
      Alert.alert('입력 확인', referralSelectionError);
      return;
    }
    if (selectedReferral && referralStatus === 'validating') {
      Alert.alert('입력 확인', '선택한 추천인을 확인 중입니다. 잠시 후 다시 시도해주세요.');
      return;
    }
    if (selectedReferral && referralStatus !== 'valid') {
      Alert.alert(
        '입력 확인',
        '선택한 추천인을 확인하지 못했습니다. 다시 검색해 선택하거나 입력값을 지워주세요.',
      );
      return;
    }

    const digits = normalizePhone(phone);
    const storedReferral = buildStoredSignupReferral({
      selectedReferral,
      referralStatus,
      referralInviterName,
      referralInviterFcId,
    });

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
        ...storedReferral,
        email: emailValue,
        carrier: carrier.trim(),
        commissionStatus,
      }),
    );
    router.push('/signup-verify');
  };

  const resetSelectedReferral = useCallback(() => {
    referralValidationRequestRef.current += 1;
    selectedReferralCodeRef.current = '';
    setSelectedReferral(null);
    setReferralStatus('idle');
    setReferralInviterName('');
    setReferralInviterFcId(null);
  }, []);

  const validateReferralCode = useCallback(async (code: string) => {
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
        selectedReferralCodeRef.current !== trimmed
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
        selectedReferralCodeRef.current !== trimmed
      ) {
        return;
      }
      setReferralStatus('invalid');
      setReferralInviterName('');
      setReferralInviterFcId(null);
    }
  }, []);

  const clearReferralSearchResults = useCallback(() => {
    referralSearchRequestRef.current += 1;
    if (referralSearchTimerRef.current) {
      clearTimeout(referralSearchTimerRef.current);
      referralSearchTimerRef.current = null;
    }
    setReferralSearchResults([]);
    setReferralSearching(false);
    setReferralSearchError(null);
  }, []);

  const clearReferralSearchInput = useCallback(() => {
    clearReferralSearchResults();
    setReferralSearchQuery('');
  }, [clearReferralSearchResults]);

  const runReferralSearch = useCallback(async (query: string) => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      clearReferralSearchResults();
      return;
    }

    const requestId = referralSearchRequestRef.current + 1;
    referralSearchRequestRef.current = requestId;
    setReferralSearching(true);
    setReferralSearchError(null);

    try {
      const { data, error } = await supabase.functions.invoke<{
        ok: boolean;
        results?: ReferralSearchResult[];
        message?: string;
      }>('search-signup-referral', {
        body: { query: trimmed },
      });

      if (requestId !== referralSearchRequestRef.current) return;

      if (!error && data?.ok) {
        setReferralSearchResults(data.results ?? []);
      } else {
        setReferralSearchResults([]);
        setReferralSearchError(data?.message ?? REFERRAL_SEARCH_ERROR_MESSAGE);
      }
    } catch {
      if (requestId === referralSearchRequestRef.current) {
        setReferralSearchResults([]);
        setReferralSearchError(REFERRAL_SEARCH_ERROR_MESSAGE);
      }
    } finally {
      if (requestId === referralSearchRequestRef.current) {
        setReferralSearching(false);
      }
    }
  }, [clearReferralSearchResults]);

  const handleReferralSearchChange = (text: string) => {
    referralEditVersionRef.current += 1;
    setReferralSearchQuery(text);
    resetSelectedReferral();
    setReferralSearchError(null);

    clearReferralSearchResults();

    if (text.trim().length < 2) {
      return;
    }

    referralSearchTimerRef.current = setTimeout(() => {
      void runReferralSearch(text);
    }, 350);
  };

  const handleReferralSearchSelect = (item: ReferralSearchResult) => {
    const nextCode = String(item.code ?? '').trim().toUpperCase();
    if (!nextCode) return;

    referralEditVersionRef.current += 1;
    clearReferralSearchResults();
    selectedReferralCodeRef.current = nextCode;
    setReferralSearchQuery('');
    setReferralSearchError(null);
    setReferralStatus('idle');
    setReferralInviterName('');
    setReferralInviterFcId(null);
    setSelectedReferral({ ...item, code: nextCode });
    void validateReferralCode(nextCode);
  };

  const handleClearSelectedReferral = useCallback(() => {
    referralEditVersionRef.current += 1;
    clearReferralSearchInput();
    resetSelectedReferral();
  }, [clearReferralSearchInput, resetSelectedReferral]);

  useEffect(() => () => {
    if (referralSearchTimerRef.current) clearTimeout(referralSearchTimerRef.current);
  }, []);

  const handleBack = useCallback(() => {
    router.replace('/login');
  }, []);

  const applyPendingReferralCode = useCallback(() => {
    return runSinglePendingReferralApply(pendingReferralApplyStateRef.current, async () => {
      const editVersionAtStart = referralEditVersionRef.current;
      const code = await consumePendingReferralCode();
      const normalizedCode = code?.trim().toUpperCase() ?? '';
      if (!normalizedCode) return;
      if (referralEditVersionRef.current !== editVersionAtStart) return;

      clearReferralSearchResults();
      resetSelectedReferral();
      setReferralSearchQuery(normalizedCode);
      await runReferralSearch(normalizedCode);
    });
  }, [clearReferralSearchResults, resetSelectedReferral, runReferralSearch]);

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
      if (!hydrated) return;
      if (role) {
        // 로그인 상태: 대기 중인 추천 코드가 있으면 추천인 코드 페이지로 이동
        (async () => {
          const code = await consumePendingReferralCode();
          if (!code) return;
          await savePendingReferralCode(code);
          router.replace({ pathname: '/referral', params: { referralNonce: Date.now().toString() } });
        })();
        return;
      }
      void applyPendingReferralCode();
    }, [applyPendingReferralCode, hydrated, role]),
  );

  useEffect(() => {
    if (!referralNonce || !hydrated) return;
    if (role) {
      // 로그인 상태: 추천인 코드 페이지로 리다이렉트 (코드는 storage에 유지)
      router.replace({ pathname: '/referral', params: { referralNonce } });
      return;
    }
    void applyPendingReferralCode();
  }, [applyPendingReferralCode, referralNonce, hydrated, role]);

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
            <Text style={styles.label}>추천인 (선택)</Text>
            <ReferralSearchField
              inputRef={referralSearchInputRef}
              searchQuery={referralSearchQuery}
              searching={referralSearching}
              onChangeText={handleReferralSearchChange}
              onClear={clearReferralSearchInput}
              returnKeyType="next"
              textInputProps={{
                onFocus: (e) => handleFocusTarget(e.nativeEvent.target),
                onSubmitEditing: () => emailLocalRef.current?.focus(),
                blurOnSubmit: false,
                scrollEnabled: false,
              }}
            />
            <Text style={styles.referralHelperText}>
              추천인 이름, 소속 또는 8자리 추천 코드를 입력한 뒤 검색 결과에서 한 명을 선택해주세요.
            </Text>
            {referralSearchQuery.trim().length > 0 && referralSearchQuery.trim().length < 2 && (
              <Text style={styles.referralSearchHint}>{REFERRAL_SEARCH_MIN_CHARS_HINT}</Text>
            )}
            {referralSearchError && (
              <Text style={styles.referralSearchError}>{referralSearchError}</Text>
            )}
            {referralSearchQuery.trim().length >= 2 &&
              !referralSearching &&
              !referralSearchError &&
              referralSearchResults.length === 0 && (
                <Text style={styles.referralSearchHint}>{REFERRAL_SEARCH_EMPTY_HINT}</Text>
              )}
            {referralSearchResults.length > 0 && (
              <ReferralSearchResultList
                results={referralSearchResults}
                onSelect={handleReferralSearchSelect}
              />
            )}
            {selectedReferral && (
              <View style={styles.selectedReferralWrap}>
                <View style={styles.selectedReferralInfo}>
                  <View style={styles.selectedReferralText}>
                    <Text style={styles.selectedReferralName} numberOfLines={1}>
                      {selectedReferral.name}
                    </Text>
                    <Text style={styles.selectedReferralAffiliation} numberOfLines={1}>
                      {selectedReferral.affiliation}
                    </Text>
                  </View>
                  <View style={styles.selectedReferralCodeBadge}>
                    <Text style={styles.selectedReferralCode}>
                      {selectedReferral.code}
                    </Text>
                  </View>
                </View>
                <Pressable onPress={handleClearSelectedReferral} hitSlop={8}>
                  <Text style={styles.selectedReferralClear}>선택 해제</Text>
                </Pressable>
                {referralStatus === 'validating' && (
                  <Text style={styles.referralStatusHint}>추천인 정보를 확인 중입니다...</Text>
                )}
                {referralStatus === 'valid' && (
                  <Text style={styles.referralStatusSuccess}>
                    ✓ {referralInviterName}님이 추천인으로 적용됩니다
                  </Text>
                )}
                {referralStatus === 'invalid' && (
                  <Text style={styles.referralStatusError}>
                    선택한 추천인을 확인하지 못했습니다. 다시 검색해 선택해주세요.
                  </Text>
                )}
              </View>
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
                    setTimeout(() => referralSearchInputRef.current?.focus(), 100);
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
  referralHelperText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.text.secondary,
    lineHeight: TYPOGRAPHY.lineHeight.relaxed * TYPOGRAPHY.fontSize.sm,
    marginTop: 2,
  },
  referralSearchSection: {
    marginTop: SPACING.sm,
  },
  referralSearchLabel: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
    color: COLORS.text.primary,
    marginBottom: 6,
  },
  referralSearchHint: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    color: COLORS.text.muted,
    marginTop: 2,
    marginBottom: SPACING.xs,
  },
  referralSearchError: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    color: COLORS.error,
    marginTop: 2,
    marginBottom: SPACING.xs,
  },
  selectedReferralWrap: {
    marginTop: SPACING.xs,
    gap: 6,
  },
  selectedReferralInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.background.secondary,
    borderWidth: 1,
    borderColor: COLORS.border.light,
  },
  selectedReferralText: {
    flex: 1,
  },
  selectedReferralName: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
    color: COLORS.text.primary,
  },
  selectedReferralAffiliation: {
    marginTop: 2,
    fontSize: TYPOGRAPHY.fontSize.xs,
    color: COLORS.text.secondary,
  },
  selectedReferralCodeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.primaryPale,
  },
  selectedReferralCode: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontWeight: TYPOGRAPHY.fontWeight.extrabold,
    color: COLORS.primary,
    letterSpacing: 1,
  },
  selectedReferralClear: {
    alignSelf: 'flex-end',
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
    color: COLORS.primary,
  },
  referralStatusHint: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    color: COLORS.text.muted,
  },
  referralStatusSuccess: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    color: '#16a34a',
  },
  referralStatusError: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    color: COLORS.error,
    lineHeight: TYPOGRAPHY.lineHeight.relaxed * TYPOGRAPHY.fontSize.xs,
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
