import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  BackHandler,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { TextInput as TextInputType } from 'react-native';
import { LayoutAnimationConfig } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KeyboardAwareWrapper, useKeyboardAware } from '@/components/KeyboardAwareWrapper';
import {
  REFERRAL_SEARCH_EMPTY_HINT,
  REFERRAL_SEARCH_MIN_CHARS_HINT,
  ReferralSearchField,
  ReferralSearchResultList,
  type ReferralSearchResult,
} from '@/components/ReferralSearchField';
import {
  StackButton,
  StackDockedNext,
  StackField,
  StackItem,
  StackLabel,
  StackSelectValue,
  StackSheet,
  StackSheetOption,
  StackSubmit,
  stackFormStyles,
} from '@/components/StackedForm';
import { useKeyboardPadding, useKeyboardVisible } from '@/hooks/use-keyboard-padding';
import { consumePendingReferralCode } from '@/lib/referral-deeplink';
import { parseSignupReferralSearchResponse } from '@/lib/referral-read-response';
import { useSession } from '@/hooks/use-session';
import { safeStorage } from '@/lib/safe-storage';
import {
  buildPendingSignupReferralSelection,
  buildStoredSignupReferral,
  getSignupReferralSelectionError,
  hasValidStoredSignupReferral,
  runSinglePendingReferralApply,
} from '@/lib/signup-referral';
import {
  LICENSE_STATUS_NONE,
  LICENSE_STATUS_LABELS,
  LICENSE_STATUS_OPTIONS,
  mapLicenseStatusesToCommissionStatus,
  normalizeLicenseStatuses,
  toggleLicenseStatus,
} from '@/lib/license-statuses';
import { supabase } from '@/lib/supabase';
import { signupClientHeaders } from '@/lib/signup-client-metadata';
import { SIGNUP_AFFILIATION_OPTIONS, SIGNUP_CARRIER_OPTIONS } from '@/lib/signup-profile-options';
import { advanceStackReveal, getStackOrder, SIGNUP_MOTION, SIGNUP_STEPS, type SignupStep } from '@/lib/signup-steps';
import { COLORS, TYPOGRAPHY, SPACING, RADIUS } from '@/lib/theme';
import { validatePhone, validateEmail, validateRequired, normalizePhone, isValidMobilePhone } from '@/lib/validation';
import type { LicenseStatus } from '@/types/fc';

const AUTH_SCREEN_BACKGROUND = COLORS.white;

const STORAGE_KEY = 'fc-onboarding/signup';

const EMAIL_DOMAINS = [
  'naver.com',
  'gmail.com',
  'daum.net',
  'hanmail.net',
  'nate.com',
  '직접입력',
];
const REFERRAL_SEARCH_ERROR_MESSAGE = '추천인 검색을 지금 사용할 수 없습니다. 잠시 후 다시 시도해주세요.';

type SignupSheet = 'carrier' | 'affiliation' | 'license' | 'domain';
type TextField = 'name' | 'phone' | 'emailLocal' | 'customDomain' | 'referral';

const SHEET_TITLES: Record<SignupSheet, string> = {
  carrier: '통신사를 선택해 주세요',
  affiliation: '소속을 선택해 주세요',
  license: '보유한 자격증을 선택해 주세요',
  domain: '이메일 주소를 선택해 주세요',
};

export default function SignupScreen() {
  const [selectedAffiliation, setSelectedAffiliation] = useState('');
  const [licenseStatuses, setLicenseStatuses] = useState<LicenseStatus[]>([LICENSE_STATUS_NONE]);
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
  const [revealed, setRevealed] = useState(1);
  const [sheet, setSheet] = useState<SignupSheet | null>(null);
  const [focusedField, setFocusedField] = useState<TextField | null>('name');
  const [checking, setChecking] = useState(false);
  const keyboardPadding = useKeyboardPadding();
  const keyboardVisible = useKeyboardVisible();
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
  const revealedRef = useRef(1);
  const motionTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const { scrollToInput } = useKeyboardAware();

  const handleFocusTarget = (target?: number) => {
    if (!target) return;
    // Android/Fabric에서 키보드 오픈 타이밍으로 첫 스크롤이 누락될 수 있어 짧게 재시도
    scrollToInput(target);
    setTimeout(() => scrollToInput(target), 80);
    setTimeout(() => scrollToInput(target), 220);
  };

  const later = useCallback((ms: number, run: () => void) => {
    motionTimersRef.current.push(setTimeout(run, ms));
  }, []);

  useEffect(() => () => {
    motionTimersRef.current.forEach(clearTimeout);
  }, []);

  /** Reveals the next question when the newest one was answered; returns whether it did. */
  const advance = useCallback((answered: SignupStep) => {
    const next = advanceStackReveal(SIGNUP_STEPS, revealedRef.current, answered);
    revealedRef.current = next.revealed;
    setRevealed(next.revealed);
    return next.advanced;
  }, []);

  const focusAfterInsert = useCallback((ref: { current: TextInputType | null }) => {
    later(SIGNUP_MOTION.focusDelay, () => ref.current?.focus());
  }, [later]);

  const openSheet = useCallback((next: SignupSheet) => {
    Keyboard.dismiss();
    setFocusedField(null);
    setSheet(next);
  }, []);

  const closeSheet = useCallback(() => setSheet(null), []);

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
        '선택한 추천인을 확인하지 못했습니다. 다시 검색해 선택해주세요.',
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
    if (!hasValidStoredSignupReferral(storedReferral)) {
      Alert.alert('입력 확인', '유효한 추천인을 다시 검색해 선택해주세요.');
      return;
    }
    const normalizedLicenseStatuses = normalizeLicenseStatuses(licenseStatuses);
    const commissionStatus = mapLicenseStatusesToCommissionStatus(normalizedLicenseStatuses);

    // 중복 계정 체크 (OTP 발송 없이 확인만)
    setChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke('request-signup-otp', {
        body: { phone: digits, checkOnly: true },
        headers: signupClientHeaders(),
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
        license_statuses: normalizedLicenseStatuses,
        commissionStatus,
      }),
    );
    router.push('/signup-verify');
  };

  const handleLicenseStatusToggle = (status: LicenseStatus) => {
    setLicenseStatuses((current) => toggleLicenseStatus(current, status));
  };
  const normalizedLicenseStatusView = normalizeLicenseStatuses(licenseStatuses);
  const licenseStatusSummary = normalizedLicenseStatusView.map((status) => LICENSE_STATUS_LABELS[status]).join(', ');

  const handlePhoneChange = (text: string) => {
    const digits = normalizePhone(text).slice(0, 11);
    setPhone(digits);
    // Like the reference's resident number, a complete number moves on by itself.
    if (isValidMobilePhone(digits) && advance('phone')) {
      phoneRef.current?.blur();
      openSheet('carrier');
    }
  };

  const pickAndContinue = (answered: SignupStep, nextSheet: SignupSheet | null) => {
    later(SIGNUP_MOTION.pickHold, () => {
      setSheet(advance(answered) ? nextSheet : null);
    });
  };

  const handleCarrierPick = (value: string) => {
    setCarrier(value);
    pickAndContinue('carrier', 'affiliation');
  };

  const handleAffiliationPick = (value: string) => {
    setSelectedAffiliation(value);
    pickAndContinue('affiliation', 'license');
  };

  const handleLicenseDone = () => {
    closeSheet();
    if (advance('license')) focusAfterInsert(emailLocalRef);
  };

  const handleDomainPick = (domain: string) => {
    setEmailDomain(domain);
    if (domain !== '직접입력') setCustomDomain('');
    later(SIGNUP_MOTION.pickHold, () => {
      closeSheet();
      if (domain === '직접입력') {
        later(SIGNUP_MOTION.sheet, () => customDomainRef.current?.focus());
      } else if (advance('email')) {
        focusAfterInsert(referralSearchInputRef);
      }
    });
  };

  const handleNameNext = () => {
    if (advance('name')) focusAfterInsert(phoneRef);
    else Keyboard.dismiss();
  };

  const handleEmailLocalNext = () => {
    if (!emailDomain) {
      openSheet('domain');
    } else if (emailDomain === '직접입력') {
      customDomainRef.current?.focus();
    } else if (advance('email')) {
      focusAfterInsert(referralSearchInputRef);
    } else {
      Keyboard.dismiss();
    }
  };

  const handleCustomDomainNext = () => {
    if (advance('email')) focusAfterInsert(referralSearchInputRef);
    else Keyboard.dismiss();
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
        const inviterFcId = typeof data.inviterFcId === 'string' ? data.inviterFcId : null;
        setReferralInviterFcId(inviterFcId);
        setSelectedReferral((current) => {
          const currentCode = String(current?.code ?? '').trim().toUpperCase();
          if (!current || currentCode !== trimmed) {
            return current;
          }
          return {
            ...current,
            fcId: inviterFcId ?? current.fcId,
            name: data.inviterName ?? current.name,
            code: trimmed,
          };
        });
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
      const { data, error } = await supabase.functions.invoke<unknown>('search-signup-referral', {
        body: { query: trimmed },
      });

      if (requestId !== referralSearchRequestRef.current) return;

      if (!error) {
        setReferralSearchResults(parseSignupReferralSearchResponse(data));
      } else {
        setReferralSearchResults([]);
        setReferralSearchError(REFERRAL_SEARCH_ERROR_MESSAGE);
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
    Keyboard.dismiss();
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
      const pendingSelection = buildPendingSignupReferralSelection(normalizedCode);
      if (!pendingSelection) return;

      clearReferralSearchResults();
      resetSelectedReferral();
      selectedReferralCodeRef.current = pendingSelection.code ?? '';
      setReferralSearchQuery('');
      setReferralSearchError(null);
      setSelectedReferral(pendingSelection);
      await validateReferralCode(pendingSelection.code ?? normalizedCode);
    });
  }, [clearReferralSearchResults, resetSelectedReferral, validateReferralCode]);

  useFocusEffect(
    useCallback(() => {
      const onHardwareBack = () => {
        if (sheet) {
          closeSheet();
          return true;
        }
        handleBack();
        return true;
      };
      const subscription = BackHandler.addEventListener('hardwareBackPress', onHardwareBack);
      return () => subscription.remove();
    }, [closeSheet, handleBack, sheet]),
  );

  useFocusEffect(
    useCallback(() => {
      if (!hydrated) return;
      if (role) {
        // 로그인 상태에서는 가입용 추천 코드를 소비하고 폐기한다.
        void consumePendingReferralCode();
        return;
      }
      void applyPendingReferralCode();
    }, [applyPendingReferralCode, hydrated, role]),
  );

  useEffect(() => {
    if (!referralNonce || !hydrated) return;
    if (role) {
      void consumePendingReferralCode();
      return;
    }
    void applyPendingReferralCode();
  }, [applyPendingReferralCode, referralNonce, hydrated, role]);

  const textNextHandlers: Partial<Record<TextField, { value: string; onNext: () => void }>> = {
    name: { value: name.trim(), onNext: handleNameNext },
    emailLocal: { value: emailLocal, onNext: handleEmailLocalNext },
    customDomain: { value: customDomain, onNext: handleCustomDomainNext },
  };
  // Web reports no keyboard events, so the 다음 bar follows focus there.
  const dockedNext = (keyboardVisible || Platform.OS === 'web') && focusedField ? textNextHandlers[focusedField] : undefined;
  const showDockedNext = Boolean(dockedNext?.value) && !sheet;
  const allRevealed = revealed >= SIGNUP_STEPS.length;
  const showSubmit = allRevealed && !showDockedNext && !sheet && !keyboardVisible;
  const canSubmit = referralStatus === 'valid' && !checking;

  // Android can hand focus back to an input when a sheet changes; only a visible keyboard means typing.
  const isTyping = (field: TextField) => focusedField === field && (keyboardVisible || Platform.OS === 'web') && !sheet;

  const textFocus = (field: TextField) => ({
    onFocus: (e: { nativeEvent: { target?: number } }) => {
      setFocusedField(field);
      handleFocusTarget(e.nativeEvent.target);
    },
    // On web a press on the 다음 bar blurs the input first; keep the field so the press still lands.
    onBlur: () => {
      if (Platform.OS !== 'web') setFocusedField((current) => (current === field ? null : current));
    },
  });

  const renderStep = (step: SignupStep) => {
    switch (step) {
      case 'name':
        return (
          <StackField label="이름" active={isTyping('name')}>
            <TextInput
              ref={nameRef}
              style={stackFormStyles.input}
              placeholder="이름 입력"
              placeholderTextColor={COLORS.text.muted}
              value={name}
              onChangeText={setName}
              autoFocus
              returnKeyType="next"
              onSubmitEditing={handleNameNext}
              blurOnSubmit={false}
              scrollEnabled={false}
              {...textFocus('name')}
            />
          </StackField>
        );
      case 'phone': {
        const phoneError = phone.length === 11 && !isValidMobilePhone(phone) ? validatePhone(phone).error : null;
        return (
          <StackField label="휴대폰 번호" active={isTyping('phone')} error={phoneError}>
            <TextInput
              ref={phoneRef}
              style={stackFormStyles.input}
              placeholder="숫자만 입력"
              placeholderTextColor={COLORS.text.muted}
              value={phone}
              onChangeText={handlePhoneChange}
              keyboardType="number-pad"
              maxLength={11}
              scrollEnabled={false}
              {...textFocus('phone')}
            />
          </StackField>
        );
      }
      case 'carrier':
        return (
          <StackField label="통신사" active={sheet === 'carrier'}>
            <StackSelectValue value={carrier} placeholder="통신사 선택" accessibilityLabel={`통신사 선택, ${carrier || '미선택'}`} onPress={() => openSheet('carrier')} />
          </StackField>
        );
      case 'affiliation':
        return (
          <StackField label="소속" active={sheet === 'affiliation'}>
            <StackSelectValue value={selectedAffiliation} placeholder="소속 선택" accessibilityLabel={`소속 선택, ${selectedAffiliation || '미선택'}`} onPress={() => openSheet('affiliation')} />
          </StackField>
        );
      case 'license':
        return (
          <StackField label="자격증 보유 현황" active={sheet === 'license'}>
            <StackSelectValue value={licenseStatusSummary} placeholder="자격증 선택" accessibilityLabel={`자격증 보유 현황, ${licenseStatusSummary}`} onPress={() => openSheet('license')} />
          </StackField>
        );
      case 'email':
        return (
          <StackField label="이메일" active={isTyping('emailLocal') || isTyping('customDomain') || sheet === 'domain'}>
            <View style={styles.emailRow}>
              <TextInput
                ref={emailLocalRef}
                style={[stackFormStyles.input, styles.flex]}
                placeholder="이메일 아이디"
                placeholderTextColor={COLORS.text.muted}
                value={emailLocal}
                onChangeText={(txt) => setEmailLocal(txt.trim())}
                autoCapitalize="none"
                keyboardType="email-address"
                returnKeyType="next"
                onSubmitEditing={handleEmailLocalNext}
                blurOnSubmit={false}
                scrollEnabled={false}
                {...textFocus('emailLocal')}
              />
              <Text style={styles.emailAt}>@</Text>
              {emailDomain === '직접입력' ? (
                <TextInput
                  ref={customDomainRef}
                  style={[stackFormStyles.input, styles.flex]}
                  placeholder="직접 입력"
                  placeholderTextColor={COLORS.text.muted}
                  value={customDomain}
                  onChangeText={(txt) => setCustomDomain(txt.trim())}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  returnKeyType="next"
                  onSubmitEditing={handleCustomDomainNext}
                  blurOnSubmit={false}
                  scrollEnabled={false}
                  {...textFocus('customDomain')}
                />
              ) : (
                <View style={styles.flex}>
                  <StackSelectValue value={emailDomain} placeholder="선택" accessibilityLabel={`이메일 도메인 선택, ${emailDomain || '미선택'}`} onPress={() => openSheet('domain')} />
                </View>
              )}
            </View>
          </StackField>
        );
      case 'referral':
        return (
          <View style={styles.field}>
            <StackLabel>추천인 (필수)</StackLabel>
            <ReferralSearchField
              inputRef={referralSearchInputRef}
              searchQuery={referralSearchQuery}
              searching={referralSearching}
              onChangeText={handleReferralSearchChange}
              onClear={clearReferralSearchInput}
              returnKeyType="search"
              textInputProps={{
                ...textFocus('referral'),
                scrollEnabled: false,
              }}
            />
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
                {referralStatus === 'invalid' && (
                  <Text style={styles.referralStatusError}>
                    선택한 추천인을 확인하지 못했습니다. 다시 검색해 선택해주세요.
                  </Text>
                )}
              </View>
            )}
          </View>
        );
    }
  };

  const renderSheetContent = (current: SignupSheet) => {
    switch (current) {
      case 'carrier':
        return SIGNUP_CARRIER_OPTIONS.map((value) => (
          <StackSheetOption key={value} label={value} selected={carrier === value} onPress={() => handleCarrierPick(value)} />
        ));
      case 'affiliation':
        return SIGNUP_AFFILIATION_OPTIONS.map((value) => (
          <StackSheetOption key={value} label={value} selected={selectedAffiliation === value} onPress={() => handleAffiliationPick(value)} />
        ));
      case 'license':
        return LICENSE_STATUS_OPTIONS.map((status) => (
          <StackSheetOption
            key={status}
            label={LICENSE_STATUS_LABELS[status]}
            multiple
            selected={normalizedLicenseStatusView.includes(status)}
            onPress={() => handleLicenseStatusToggle(status)}
          />
        ));
      case 'domain':
        return EMAIL_DOMAINS.map((domain) => (
          <StackSheetOption key={domain} label={domain} selected={emailDomain === domain} onPress={() => handleDomainPick(domain)} />
        ));
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.authBackground} pointerEvents="none" />
      <SafeAreaView style={styles.safe} edges={['left', 'right']}>
        <Text style={stackFormStyles.title}>회원가입 정보를 입력해 주세요</Text>
        <KeyboardAwareWrapper
          contentContainerStyle={[stackFormStyles.content, { paddingBottom: Math.max(120, keyboardPadding + 96) }]}
          extraScrollHeight={220}
          keyboardDismissMode="none"
        >
          <LayoutAnimationConfig skipEntering>
            {getStackOrder(SIGNUP_STEPS, revealed).map((step) => (
              <StackItem key={step}>{renderStep(step)}</StackItem>
            ))}
          </LayoutAnimationConfig>
        </KeyboardAwareWrapper>

        {showDockedNext && dockedNext ? <StackDockedNext onPress={dockedNext.onNext} /> : null}
        {showSubmit ? <StackSubmit label={checking ? '확인 중...' : '다음'} disabled={!canSubmit} onPress={handleNext} /> : null}
      </SafeAreaView>

      <StackSheet
        contentKey={sheet}
        title={sheet ? SHEET_TITLES[sheet] : ''}
        onClose={closeSheet}
        footer={sheet === 'license' ? <StackButton label="선택 완료" onPress={handleLicenseDone} /> : null}
      >
        {sheet ? renderSheetContent(sheet) : null}
      </StackSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: AUTH_SCREEN_BACKGROUND },
  authBackground: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: AUTH_SCREEN_BACKGROUND,
  },
  safe: { flex: 1 },
  flex: { flex: 1 },
  field: { gap: 6 },
  emailRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  emailAt: { fontSize: TYPOGRAPHY.fontSize.lg, color: COLORS.text.secondary },
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
  referralStatusError: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    color: COLORS.error,
    lineHeight: TYPOGRAPHY.lineHeight.relaxed * TYPOGRAPHY.fontSize.xs,
  },
});
