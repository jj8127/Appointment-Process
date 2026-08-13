import { Feather } from '@expo/vector-icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Controller, useForm, type Control } from 'react-hook-form';
import {
  Alert,
  ActivityIndicator,
  BackHandler,
  findNodeHandle,
  InteractionManager,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ReturnKeyTypeOptions,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';

import { Button } from '@/components/Button';
import { DaumPostcode } from '@/components/DaumPostcode';
import { KeyboardAwareWrapper, useKeyboardAware } from '@/components/KeyboardAwareWrapper';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useSession } from '@/hooks/use-session';
import { invokeAdminAction } from '@/lib/admin-action-api';
import {
  buildFcBasicInformationFormValues,
  buildFcBasicInformationPatch,
  type FcBasicInformationProfile,
} from '@/lib/fc-basic-information';
import { invokeFcNotifyForDelivery } from '@/lib/fc-notify-client';
import { presentPostCommitNotificationDelivery } from '@/lib/fc-notify-post-commit';
import { canOpenFcProfileRegistration } from '@/lib/fc-workflow';
import { logger } from '@/lib/logger';
import { extractFunctionErrorMessage, mapStoreIdentityErrorMessage, toResidentInputAlertMessage } from '@/lib/store-identity-error';
import { supabase } from '@/lib/supabase';
import { COLORS, RADIUS, SHADOWS, SPACING, TYPOGRAPHY } from '@/lib/theme';
import { normalizePhone, validateResidentId } from '@/lib/validation';

const CHARCOAL = '#111827';
const TEXT_MUTED = '#6b7280';
const PLACEHOLDER = '#9ca3af';

const schema = z.object({
  affiliation: z.string(),
  name: z.string(),
  phone: z.string().min(8, '휴대폰 번호를 입력해주세요.'),
  email: z.string().refine(
    (value) => !value.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()),
    '유효한 이메일을 입력해주세요.',
  ),
  carrier: z.string(),
  address: z.string(),
  addressDetail: z.string(),
  residentFront: z.string().optional().or(z.literal('')),
  residentBack: z.string().optional().or(z.literal('')),
}).superRefine((values, ctx) => {
  const front = (values.residentFront ?? '').trim();
  const back = (values.residentBack ?? '').trim();
  const hasResidentInput = front.length > 0 || back.length > 0;
  if (!hasResidentInput) return;

  if (!/^\d{6}$/.test(front)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: '주민번호 앞 6자리를 숫자로 입력해주세요.',
      path: ['residentFront'],
    });
  }
  if (!/^\d{7}$/.test(back)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: '주민번호 뒤 7자리를 숫자로 입력해주세요.',
      path: ['residentBack'],
    });
  }
  if (/^\d{6}$/.test(front) && /^\d{7}$/.test(back)) {
    const residentValidation = validateResidentId(`${front}${back}`);
    if (!residentValidation.isValid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: residentValidation.error ?? '주민등록번호를 다시 확인해주세요.',
        path: ['residentBack'],
      });
    }
  }
});

type FormValues = z.infer<typeof schema>;

const AFFILIATION_OPTIONS = [
  '1본부 서선미',
  '2본부 박성훈',
  '3본부 김태희',
  '4본부 현경숙',
  '5본부 최철준',
  '6본부 김정수(박선희)',
  '7본부 이동훈',
  '8본부 정승철',
  '9본부 이현욱(김주용)',
  '10본부 한태균',
];

const LEGACY_AFFILIATION_TO_NEW: Record<string, string> = {
  '1본부 [본부장: 서선미]': '1본부 서선미',
  '2본부 [본부장: 박성훈]': '2본부 박성훈',
  '3본부 [본부장: 김태희]': '3본부 김태희',
  '4본부 [본부장: 현경숙]': '4본부 현경숙',
  '5본부 [본부장: 최철준]': '5본부 최철준',
  '6본부 [본부장: 김정수]': '6본부 김정수(박선희)',
  '6본부 [본부장: 박선희]': '6본부 김정수(박선희)',
  '7본부 [본부장: 김동훈]': '7본부 이동훈',
  '7본부 [본부장: 이동훈]': '7본부 이동훈',
  '8본부 [본부장: 정승철]': '8본부 정승철',
  '9본부 [본부장: 이현욱]': '9본부 이현욱(김주용)',
  '9본부 [본부장: 김주용]': '9본부 이현욱(김주용)',
  '10본부 [본부장: 한태균]': '10본부 한태균',
  '1팀(서울1) : 서선미 본부장님': '1본부 서선미',
  '2팀(서울2) : 박성훈 본부장님': '2본부 박성훈',
  '3팀(부산1) : 김태희 본부장님': '3본부 김태희',
  '4팀(대전1) : 현경숙 본부장님': '4본부 현경숙',
  '5팀(대전2) : 최철준 본부장님': '5본부 최철준',
  '6팀(전주1) : 김정수 본부장님': '6본부 김정수(박선희)',
  '6팀(전주1) : 박선희 본부장님': '6본부 김정수(박선희)',
  '7팀(청주1/직할) : 김동훈 본부장님': '7본부 이동훈',
  '7팀(청주1/직할) : 이동훈 본부장님': '7본부 이동훈',
  '8팀(서울3) : 정승철 본부장님': '8본부 정승철',
  '9팀(서울4) : 이현옥 본부장님': '9본부 이현욱(김주용)',
  '9팀(서울4) : 이현욱 본부장님': '9본부 이현욱(김주용)',
};

const normalizeAffiliationLabel = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (AFFILIATION_OPTIONS.includes(trimmed)) return trimmed;

  const mapped = LEGACY_AFFILIATION_TO_NEW[trimmed];
  if (mapped) return mapped;

  const prefix = trimmed.match(/^(10|[1-9])\s*(본부|팀)/);
  if (prefix) {
    const index = Number(prefix[1]) - 1;
    return AFFILIATION_OPTIONS[index] ?? trimmed;
  }

  return trimmed;
};

const EMAIL_DOMAINS = [
  'naver.com',
  'gmail.com',
  'daum.net',
  'hanmail.net',
  'nate.com',
  '직접입력',
];
const CARRIER_OPTIONS = ['SKT', 'KT', 'LGU+', 'SKT 알뜰폰', 'KT 알뜰폰', 'LGU+ 알뜰폰'];
async function sendNotificationAndPush(
  role: 'admin' | 'fc',
  residentId: string | null,
  title: string,
  body: string,
  fcId: string,
) {
  return invokeFcNotifyForDelivery({
    type: 'notify',
    target_role: role,
    target_id: residentId,
    title,
    body,
    category: 'app_event',
    url: '/dashboard',
    target: {
      version: 1,
      kind: 'fc_profile',
      fcId,
    },
  });
}

export default function FcNewScreen() {
  const { from } = useLocalSearchParams<{ from?: string }>();
  const fromParam = Array.isArray(from) ? from[0] : from;
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const {
    residentId: phoneFromSession,
    loginAs,
    displayName,
    role,
    appSessionToken,
  } = useSession();
  const [profileLoadState, setProfileLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [existingProfile, setExistingProfile] = useState<FcBasicInformationProfile | null>(null);
  const [existingTempId, setExistingTempId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedAffiliation, setSelectedAffiliation] = useState('');
  const [emailLocal, setEmailLocal] = useState('');
  const [emailDomain, setEmailDomain] = useState('');
  const [customDomain, setCustomDomain] = useState('');
  const [carrier, setCarrier] = useState('');
  const [showDomainPicker, setShowDomainPicker] = useState(false);
  const [showCarrierPicker, setShowCarrierPicker] = useState(false);
  const [showAddressSearch, setShowAddressSearch] = useState(false);
  const [pendingAddressDetailFocus, setPendingAddressDetailFocus] = useState(false);
  const keyboardPadding = useKeyboardPadding();
  const [existingResidentMasked, setExistingResidentMasked] = useState<string | null>(null);
  const [existingResidentNumberFull, setExistingResidentNumberFull] = useState<string | null>(null);
  const [existingRecommender, setExistingRecommender] = useState('');
  const [existingAddress, setExistingAddress] = useState('');
  const [existingAddressDetail, setExistingAddressDetail] = useState('');
  const [addressHeight, setAddressHeight] = useState(90);

  const phoneRef = useRef<TextInput>(null);
  const emailLocalRef = useRef<TextInput>(null);
  const customDomainRef = useRef<TextInput>(null);
  const nameRef = useRef<TextInput>(null); // Added
  const residentFrontRef = useRef<TextInput>(null);
  const residentBackRef = useRef<TextInput>(null);
  const addressDetailRef = useRef<TextInput>(null);
  const registrationGateAlertShown = useRef(false);

  const { control, handleSubmit, setValue, reset, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      affiliation: '',
      name: '',
      phone: phoneFromSession ?? '',
      email: '',
      carrier: '',
      address: '',
      addressDetail: '',
      residentFront: '',
      residentBack: '',
    },
    mode: 'onBlur',
  });

  const updateEmailValue = useCallback((local: string, domain: string, custom: string) => {
    const domainToUse = domain === '직접입력' ? custom : domain;
    const emailValue = local && domainToUse ? `${local}@${domainToUse}` : '';
    setValue('email', emailValue, { shouldValidate: true });
  }, [setValue]);

  useEffect(() => {
    if (showAddressSearch || !pendingAddressDetailFocus) {
      return;
    }

    let cancelled = false;
    let interactionHandle: { cancel?: () => void } | null = null;
    const timeoutId = setTimeout(() => {
      interactionHandle = InteractionManager.runAfterInteractions(() => {
        if (cancelled) {
          return;
        }
        addressDetailRef.current?.focus();
        setPendingAddressDetailFocus(false);
      });
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      interactionHandle?.cancel?.();
    };
  }, [pendingAddressDetailFocus, showAddressSearch]);

  const loadExisting = useCallback(async (phone?: string) => {
    const normalizedKey = normalizePhone(phone ?? phoneFromSession ?? '');
    setProfileLoadState('loading');
    setExistingProfile(null);
    setExistingResidentNumberFull(null);

    if (!normalizedKey) {
      setProfileLoadState('error');
      return;
    }

    try {
      const result = await invokeAdminAction<{ profile: FcBasicInformationProfile }>(
        normalizedKey,
        'getOwnProfile',
        {},
      );
      const profile = result.profile;

      if (role === 'fc' && !canOpenFcProfileRegistration(profile)) {
        if (!registrationGateAlertShown.current) {
          registrationGateAlertShown.current = true;
          Alert.alert('사전등록 필요', '본등록은 사전등록을 완료한 뒤 진행할 수 있습니다.');
        }
        router.replace('/signup');
        return;
      }

      const formValues = buildFcBasicInformationFormValues(profile);
      const matchedAffiliation = normalizeAffiliationLabel(formValues.affiliation);
      reset({ ...formValues, affiliation: matchedAffiliation });
      setSelectedAffiliation(matchedAffiliation);
      setCarrier(formValues.carrier);
      setExistingRecommender(String(profile.recommender ?? '').trim());
      setExistingAddress(formValues.address);
      setExistingAddressDetail(formValues.addressDetail);
      setExistingResidentMasked(profile.resident_id_masked ?? null);
      setExistingTempId(profile.temp_id ?? null);
      setExistingProfile({ ...profile, affiliation: matchedAffiliation });

      const [emailLocalPart = '', emailDomainPart = ''] = formValues.email.split('@');
      setEmailLocal(emailLocalPart);
      if (emailDomainPart && EMAIL_DOMAINS.includes(emailDomainPart)) {
        setEmailDomain(emailDomainPart);
        setCustomDomain('');
      } else {
        setEmailDomain(emailDomainPart ? '직접입력' : '');
        setCustomDomain(emailDomainPart);
      }

      setProfileLoadState('ready');

      try {
        const residentResult = await invokeAdminAction<{
          residentNumbers: Record<string, string | null>;
        }>(normalizedKey, 'getResidentNumbers', { fcIds: [profile.id] });
        const full = residentResult.residentNumbers?.[profile.id];
        setExistingResidentNumberFull(typeof full === 'string' && full ? full : null);
      } catch {
        logger.warn('[fc/new] resident number unavailable', { reason: 'resident_lookup_failed' });
      }
    } catch {
      logger.warn('[fc/new] basic information unavailable', { reason: 'profile_load_failed' });
      setProfileLoadState('error');
    }
  }, [phoneFromSession, reset, role]);

  useEffect(() => {
    loadExisting();
  }, [phoneFromSession, loadExisting]);

  useEffect(() => {
    updateEmailValue(emailLocal, emailDomain, customDomain);
  }, [emailLocal, emailDomain, customDomain, updateEmailValue]);

  const onSubmit = async (values: FormValues) => {
    if (profileLoadState !== 'ready' || !existingProfile) {
      Alert.alert('정보 확인 필요', '기본 정보를 다시 불러온 뒤 수정해주세요.');
      return;
    }

    setSubmitting(true);
    try {
      const phoneDigits = normalizePhone(phoneFromSession ?? '');
      if (!phoneDigits) {
        Alert.alert('저장 실패', '로그인 정보를 확인할 수 없습니다. 다시 로그인해주세요.');
        return;
      }
      if (role === 'fc' && !canOpenFcProfileRegistration(existingProfile)) {
        Alert.alert('사전등록 필요', '본등록은 사전등록을 완료한 뒤 진행할 수 있습니다.');
        router.replace('/signup');
        return;
      }

      const front = values.residentFront?.trim() ?? '';
      const back = values.residentBack?.trim() ?? '';
      const addressChanged =
        values.address.trim() !== existingAddress.trim() ||
        values.addressDetail.trim() !== existingAddressDetail.trim();
      const hasResidentInput = front.length > 0 || back.length > 0;
      const needsResidentForIdentity = hasResidentInput || (!existingResidentMasked && addressChanged);
      const patch = buildFcBasicInformationPatch(existingProfile, values);
      const clearedFields = (['affiliation', 'name', 'email', 'carrier'] as const)
        .filter((field) => String(existingProfile[field] ?? '').trim() && !values[field].trim());

      if (clearedFields.length > 0) {
        Alert.alert('입력 확인', '기존 기본 정보는 빈 값으로 변경할 수 없습니다.');
        return;
      }

      if (addressChanged && (!values.address.trim() || !values.addressDetail.trim())) {
        Alert.alert('입력 확인', '주소를 변경하려면 기본 주소와 상세주소를 모두 입력해주세요.');
        return;
      }

      if (Object.keys(patch).length === 0 && !addressChanged && !hasResidentInput) {
        Alert.alert('변경 없음', '변경된 기본 정보가 없습니다.');
        return;
      }

      if (addressChanged || hasResidentInput) {
        if (needsResidentForIdentity && (!front || !back)) {
          Alert.alert('입력 확인', '주민번호를 처음 저장할 때는 앞/뒤를 모두 입력해주세요.');
          return;
        }

        const identityPayload: {
          residentId: string;
          residentFront?: string;
          residentBack?: string;
          address: string;
          addressDetail: string;
        } = {
          residentId: phoneDigits,
          address: values.address.trim(),
          addressDetail: values.addressDetail.trim(),
        };

        if (hasResidentInput) {
          identityPayload.residentFront = front;
          identityPayload.residentBack = back;
        }

        const { error: identityErr } = await supabase.functions.invoke('store-identity', {
          body: identityPayload,
        });
        if (identityErr) {
          const rawMessage = await extractFunctionErrorMessage(identityErr, '신원 정보 저장에 실패했습니다.');
          logger.warn('[fc/new] store-identity failed', { reason: 'identity_save_failed' });
          Alert.alert('저장 실패', mapStoreIdentityErrorMessage(rawMessage));
          return;
        }
      }

      const updateResult = await invokeAdminAction<{ profile: { id: string } }>(
        phoneDigits,
        'updateOwnProfile',
        { patch },
      );
      const savedProfile = updateResult.profile;

      queryClient.invalidateQueries({ queryKey: ['my-fc-status'] });

      const notifyProfileSaved = () => sendNotificationAndPush(
        'admin',
        null,
        `${values.name}님이 기본정보를 등록했습니다.`,
        `${values.name}님이 기본정보를 생성/수정했습니다.`,
        savedProfile.id,
      );
      const notificationDelivery = await notifyProfileSaved();

      loginAs('fc', phoneDigits, values.name, null, false, false, null, appSessionToken);
      presentPostCommitNotificationDelivery({
        delivery: notificationDelivery,
        retryNotification: notifyProfileSaved,
        successTitle: '저장 완료',
        successMessage: '기본정보가 저장되었습니다. FC 홈 화면으로 이동합니다.',
        notificationLabel: '관리자',
        onDone: () => router.replace('/'),
      });
    } catch {
      logger.warn('[fc/new] basic information save failed', { reason: 'profile_save_failed' });
      Alert.alert('저장 실패', '기본 정보를 저장하지 못했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setSubmitting(false);
    }
  };

  const onError = (errors: any) => {
    const missing = Object.keys(errors);
    if (missing.length > 0) {
      const residentMessage = errors.residentBack?.message ?? errors.residentFront?.message;
      if (residentMessage) {
        const firstResidentField = errors.residentFront?.message ? 'residentFront' : 'residentBack';
        Alert.alert('입력 확인', toResidentInputAlertMessage(residentMessage));
        if (firstResidentField === 'residentFront') {
          residentFrontRef.current?.focus();
        } else {
          residentBackRef.current?.focus();
        }
        return;
      }

      const LABELS: Record<string, string> = {
        affiliation: '소속',
        name: '이름',
        phone: '휴대폰 번호',
        email: '이메일',
        carrier: '통신사',
        address: '주소',
        addressDetail: '상세주소',
        residentFront: '주민번호 앞자리',
        residentBack: '주민번호 뒷자리',
      };

      const missingFields = missing
        .map((key) => LABELS[key])
        .filter(Boolean)
        .join(', ');

      const first = missing[0];
      Alert.alert('입력 확인', `다음 정보를 입력해주세요:\n${missingFields}`);

      // Focus the first error field
      if (first === 'affiliation') {
        // Affiliation is at the top
      } else if (first === 'name') {
        nameRef.current?.focus();
      } else if (first === 'phone') {
        phoneRef.current?.focus();
      } else if (first === 'email') {
        emailLocalRef.current?.focus();
      } else if (first === 'carrier') {
        setShowCarrierPicker(true);
      } else if (first === 'address') {
        setShowAddressSearch(true);
      } else if (first === 'addressDetail') {
        addressDetailRef.current?.focus();
      } else if (first === 'residentFront') {
        residentFrontRef.current?.focus();
      } else if (first === 'residentBack') {
        residentBackRef.current?.focus();
      }
    }
  };

  const handleBack = useCallback(() => {
    logger.debug('[fc/new] handleBack called', { displayName, fromParam, role });

    // 로그인하지 않은 상태 (role 없음)
    const needsLogin = !role;
    if (needsLogin) {
      logger.debug('[fc/new] Not logged in (no role), going to login');
      router.replace({ pathname: '/login', params: { skipAuto: '1' } } as any);
      return;
    }

    // 로그인한 상태: from 파라미터에 따라 이동
    if (fromParam === 'home') {
      logger.debug('[fc/new] fromParam is home, going to /');
      router.replace('/');
      return;
    }
    if (fromParam === 'auth' || fromParam === 'login') {
      logger.debug('[fc/new] fromParam is auth/login, going to /');
      router.replace('/');
      return;
    }

    // fromParam이 없거나 다른 값일 때는 home으로 이동 (로그인 상태이므로)
    logger.debug('[fc/new] Default case, going to /', { fromParam });
    router.replace('/');
  }, [displayName, fromParam, role]);

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

  // Pull-to-refresh: 기존 loadExisting을 재호출
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadExisting();
    } finally {
      setRefreshing(false);
    }
  }, [loadExisting]);

  const retryBasicInformationLoad = useCallback(() => {
    void loadExisting();
  }, [loadExisting]);

  const screenRefreshControl = <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />;
  const screenContent = profileLoadState !== 'ready' ? (
    <>
      <ScreenHeader
        title="기본 정보"
        subtitle="현재 등록된 정보를 안전하게 불러옵니다."
      />
      <View style={styles.loadStateCard}>
        {profileLoadState === 'loading' ? (
          <>
            <ActivityIndicator size="small" color={COLORS.primary} />
            <Text style={styles.loadStateTitle}>기본 정보를 불러오고 있습니다.</Text>
          </>
        ) : (
          <>
            <Feather name="alert-circle" size={28} color={COLORS.error} />
            <Text style={styles.loadStateTitle}>기본 정보를 불러오지 못했습니다.</Text>
            <Text style={styles.loadStateDescription}>
              빈 화면에서 새로 입력하지 말고 다시 불러와 주세요.
            </Text>
            <Button onPress={retryBasicInformationLoad} variant="primary" size="md">
              다시 불러오기
            </Button>
          </>
        )}
      </View>
    </>
  ) : (
    <>
        <ScreenHeader
          title="기본 정보"
          subtitle="입력 후 저장하면 다음 단계로 이동합니다."
          badge={existingTempId ? `임시번호 ${existingTempId}` : undefined}
        />

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>기본 정보</Text>
          <View style={styles.affiliationBox}>
            {AFFILIATION_OPTIONS.map((opt) => {
              const active = selectedAffiliation === opt;
              return (
                <Pressable
                  key={opt}
                  style={[styles.affiliationItem, active && styles.affiliationActive]}
                  onPress={() => {
                    setSelectedAffiliation(opt);
                    setValue('affiliation', opt, { shouldValidate: true });
                  }}>
                  <Text style={[styles.affiliationText, active && styles.affiliationTextActive]}>{opt}</Text>
                </Pressable>
              );
            })}
          </View>
          {formState.errors.affiliation?.message ? (
            <Text style={styles.error}>{formState.errors.affiliation?.message}</Text>
          ) : null}

          <FormField
            control={control}
            label="이름"
            placeholder="홍길동"
            name="name"
            inputRef={nameRef} // Passed ref
            errors={formState.errors}
            returnKeyType="next"
            onSubmitEditing={() => phoneRef.current?.focus()}
            blurOnSubmit={false}
            scrollEnabled={false} // Added
          />
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>연락처 및 이메일</Text>
          <FormField
            control={control}
            label="휴대폰 번호"
            placeholder="번호 입력 (- 없이 숫자만)"
            name="phone"
            errors={formState.errors}
            inputRef={phoneRef}
            returnKeyType="next"
            onSubmitEditing={() => setShowCarrierPicker(true)}
            blurOnSubmit={false}
            scrollEnabled={false} // Added
            editable={false}
          />
          <View style={styles.field}>
            <View style={styles.fieldLabelRow}>
              <Text style={styles.label}>통신사</Text>
              {formState.errors.carrier?.message ? (
                <Text style={styles.error}>{formState.errors.carrier?.message}</Text>
              ) : null}
            </View>
            <Pressable style={styles.selectBox} onPress={() => setShowCarrierPicker(true)}>
              <TextInput
                style={[styles.input, styles.inputWithIcon]}
                placeholder="통신사 선택"
                placeholderTextColor={PLACEHOLDER}
                value={carrier}
                editable={false}
                pointerEvents="none"
              />
              <View style={styles.selectOverlay}>
                <Feather name="chevron-down" size={20} color={TEXT_MUTED} />
              </View>
            </Pressable>
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>가입 시 저장된 추천인</Text>
            <View style={styles.readonlyBox}>
              <Text style={styles.readonlyText}>{existingRecommender || '저장된 추천인 없음'}</Text>
            </View>
            <Text style={styles.helperText}>추천인은 가입 완료 후 일반 사용자 경로에서 수정할 수 없습니다.</Text>
          </View>
          <View style={styles.field}>
            <View style={styles.fieldLabelRow}>
              <Text style={styles.label}>이메일</Text>
              {formState.errors.email?.message ? <Text style={styles.error}>{formState.errors.email?.message}</Text> : null}
            </View>
            <View style={styles.emailRow}>
              <TextInput
                ref={emailLocalRef}
                style={[styles.input, styles.emailLocal]}
                placeholder="이메일 아이디"
                placeholderTextColor={PLACEHOLDER}
                value={emailLocal}
                onChangeText={(txt) => setEmailLocal(txt.trim())}
                autoCapitalize="none"
                keyboardType="email-address"
                returnKeyType="done"
                scrollEnabled={false} // Added
              />
              <Text style={styles.emailAt}>@</Text>

              {/* 오른쪽 영역 */}
              <View style={{ flex: 1 }}>
                <View style={styles.emailDomainBox}>
                  <Pressable
                    style={styles.emailDomainSelect}
                    onPress={() => setShowDomainPicker(true)}
                  >
                    <Text
                      style={[
                        styles.emailDomainSelectText,
                        !emailDomain && styles.emailDomainSelectPlaceholder,
                      ]}
                    >
                      {emailDomain || '도메인 선택'}
                    </Text>
                    <Feather name="chevron-down" size={16} color={TEXT_MUTED} />
                  </Pressable>
                </View>

                {/* 직접 입력창을 박스 밖으로 */}
                {emailDomain === '직접입력' ? (
                  <TextInput
                    ref={customDomainRef}
                    style={[styles.input, styles.customDomainInput]}
                    placeholder="직접 입력"
                    placeholderTextColor={PLACEHOLDER}
                    value={customDomain}
                    onChangeText={(txt) => setCustomDomain(txt.trim())}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    returnKeyType="done"
                    onSubmitEditing={handleSubmit(onSubmit, onError)}
                    blurOnSubmit={false}
                    scrollEnabled={false} // Added
                  />
                ) : null}
              </View>
            </View>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>신원 정보</Text>
          {existingResidentMasked ? (
            <Text style={styles.helperText}>
              {existingResidentNumberFull
                ? `현재 주민번호: ${existingResidentNumberFull}`
                : '현재 주민번호가 등록되어 있습니다.'}
            </Text>
          ) : (
            <Text style={styles.helperText}>변경이 필요할 때만 주민번호를 입력해주세요.</Text>
          )}

          <View style={styles.field}>
            <View style={styles.fieldLabelRow}>
              <Text style={styles.label}>주민등록번호</Text>
              {formState.errors.residentFront?.message || formState.errors.residentBack?.message ? (
                <Text style={styles.error}>
                  {formState.errors.residentFront?.message || formState.errors.residentBack?.message}
                </Text>
              ) : null}
            </View>
            <View style={styles.residentRow}>
              <Controller
                control={control}
                name="residentFront"
                render={({ field: { onChange, value } }) => (
                  <TextInput
                    ref={residentFrontRef}
                    style={[styles.input, styles.residentInput]}
                    placeholder="앞 6자리"
                    placeholderTextColor={PLACEHOLDER}
                    value={value}
                    onChangeText={(txt) => onChange(txt.replace(/[^0-9]/g, '').slice(0, 6))}
                    keyboardType="number-pad"
                    maxLength={6}
                    returnKeyType="next"
                    onSubmitEditing={() => residentBackRef.current?.focus()}
                    scrollEnabled={false}
                  />
                )}
              />
              <Text style={styles.residentHyphen}>-</Text>
              <Controller
                control={control}
                name="residentBack"
                render={({ field: { onChange, value } }) => (
                  <TextInput
                    ref={residentBackRef}
                    style={[styles.input, styles.residentInput]}
                    placeholder="뒷 7자리"
                    placeholderTextColor={PLACEHOLDER}
                    value={value}
                    onChangeText={(txt) => onChange(txt.replace(/[^0-9]/g, '').slice(0, 7))}
                    keyboardType="number-pad"
                    maxLength={7}
                    secureTextEntry
                    returnKeyType="next"
                    onSubmitEditing={() => addressDetailRef.current?.focus()}
                    scrollEnabled={false}
                  />
                )}
              />
            </View>
          </View>

          <View style={styles.field}>
            <View style={styles.fieldLabelRow}>
              <Text style={styles.label}>주소</Text>
              {formState.errors.address?.message ? (
                <Text style={styles.error}>{formState.errors.address?.message}</Text>
              ) : null}
            </View>
            <Text style={styles.helperText}>기본 주소는 주소 검색으로 입력해주세요.</Text>
            <Pressable style={styles.searchButton} onPress={() => setShowAddressSearch(true)}>
              <Text style={styles.searchButtonText}>주소 검색</Text>
            </Pressable>
            <Pressable
              onPress={() => setShowAddressSearch(true)}
              accessibilityRole="button"
              accessibilityLabel="주소 다시 검색"
            >
              <View pointerEvents="none">
                <Controller
                  control={control}
                  name="address"
                  render={({ field: { value } }) => (
                    <TextInput
                      style={[styles.input, styles.inputMultiline, styles.readOnlyInput, { height: Math.max(90, addressHeight) }]}
                      placeholder="주소 검색 버튼을 눌러 입력해주세요."
                      placeholderTextColor={PLACEHOLDER}
                      value={value}
                      editable={false}
                      multiline
                      scrollEnabled={false}
                      onContentSizeChange={(e) => {
                        const nextHeight = Math.max(90, e.nativeEvent.contentSize.height);
                        if (nextHeight !== addressHeight) setAddressHeight(nextHeight);
                      }}
                    />
                  )}
                />
              </View>
            </Pressable>
          </View>
          <FormField
            control={control}
            label="상세주소"
            placeholder="상세주소 입력"
            name="addressDetail"
            errors={formState.errors}
            inputRef={addressDetailRef}
            returnKeyType="done"
            onSubmitEditing={handleSubmit(onSubmit, onError)}
            blurOnSubmit={false}
            scrollEnabled={false}
          />
        </View>

        <Button
          onPress={handleSubmit(onSubmit, onError)}
          disabled={submitting || profileLoadState !== 'ready'}
          loading={submitting}
          variant="primary"
          size="lg"
          fullWidth
          style={{ marginTop: 8, marginBottom: 40 }}
        >
          {existingTempId ? '수정하기' : '저장하기'}
        </Button>
    </>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: '',
          headerShadowVisible: false,
          headerLeft: () => (
            <Pressable
              onPress={handleBack}
              style={{ padding: 8, marginLeft: -8 }}
            >
              <Feather name="arrow-left" size={24} color={CHARCOAL} />
            </Pressable>
          ),
        }}
      />
      <KeyboardAwareWrapper
        contentContainerStyle={[styles.container, { paddingBottom: Math.max(160, keyboardPadding + 120) }]}
        extraScrollHeight={Platform.OS === 'android' ? 220 : 140}
        refreshControl={screenRefreshControl}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="none"
      >
        {screenContent}
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
              {CARRIER_OPTIONS.map((option) => (
                <Pressable
                  key={option}
                  style={styles.modalOption}
                  onPress={() => {
                    setCarrier(option);
                    setValue('carrier', option, { shouldValidate: true });
                    setShowCarrierPicker(false);
                    setTimeout(() => emailLocalRef.current?.focus(), 100);
                  }}
                >
                  <Text style={styles.modalOptionText}>{option}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable style={styles.modalCancel} onPress={() => setShowCarrierPicker(false)}>
              <Text style={styles.modalCancelText}>취소</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal visible={showAddressSearch} animationType="slide">
        <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
          <View style={styles.searchHeader}>
            <Text style={styles.searchTitle}>주소 검색</Text>
            <Pressable onPress={() => setShowAddressSearch(false)}>
              <Text style={styles.searchClose}>닫기</Text>
            </Pressable>
          </View>
          <DaumPostcode
            style={{ flex: 1 }}
            jsOptions={{ animation: true }}
            onSelected={(data: any) => {
              const base = data.address || '';
              const extra = data.buildingName ? ` (${data.buildingName})` : '';
              const full = `${data.zonecode ? `[${data.zonecode}] ` : ''}${base}${extra}`;
              setValue('address', full, { shouldValidate: true, shouldDirty: true });
              setPendingAddressDetailFocus(true);
              setShowAddressSearch(false);
            }}
            onError={() => {
              Alert.alert('주소 검색 실패', '주소 검색 중 오류가 발생했습니다. 다시 시도해주세요.');
            }}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

type FormFieldProps = {
  control: Control<FormValues>;
  label: string;
  placeholder: string;
  name: keyof FormValues;
  errors: Record<string, { message?: string }>;
  multiline?: boolean;
  inputRef?: React.Ref<TextInput>;
  returnKeyType?: ReturnKeyTypeOptions;
  onSubmitEditing?: () => void;
  blurOnSubmit?: boolean;
  scrollEnabled?: boolean; // Added
  editable?: boolean;
};

const FormField = ({
  control,
  label,
  placeholder,
  name,
  errors,
  multiline,
  inputRef,
  returnKeyType,
  onSubmitEditing,
  blurOnSubmit,
  scrollEnabled, // Added
  editable = true,
}: FormFieldProps) => {
  const { scrollToInput } = useKeyboardAware();
  const [inputHeight, setInputHeight] = useState(multiline ? 80 : 0);
  const scrollFocusedInputIntoView = useCallback((target: any) => {
    const node = findNodeHandle(target);
    if (!node) return;

    scrollToInput(node);
    // Android/Fabric can miss the first request while the keyboard is opening.
    setTimeout(() => scrollToInput(node), 80);
    setTimeout(() => scrollToInput(node), 220);
  }, [scrollToInput]);

  return (
    <View style={styles.field}>
      <View style={styles.fieldLabelRow}>
        <Text style={styles.label}>{label}</Text>
        {errors[name]?.message ? <Text style={styles.error}>{errors[name]?.message}</Text> : null}
      </View>
      <Controller
        control={control}
        name={name as any}
        render={({ field: { onChange, value } }) => (
          <TextInput
            scrollEnabled={multiline ? false : (scrollEnabled ?? false)}
            ref={inputRef}
            style={[
              styles.input,
              multiline && styles.inputMultiline,
              multiline && { height: Math.max(80, inputHeight) },
            ]}
            placeholder={placeholder}
            placeholderTextColor={PLACEHOLDER}
            value={value}
            onChangeText={onChange}
            editable={editable}
            multiline={multiline}
            returnKeyType={returnKeyType}
            onSubmitEditing={onSubmitEditing}
            blurOnSubmit={blurOnSubmit}
            onFocus={(e) => {
              scrollFocusedInputIntoView(e.target as any);
            }}
            onContentSizeChange={(e) => {
              if (!multiline) return;
              const nextHeight = Math.max(80, e.nativeEvent.contentSize.height);
              if (nextHeight !== inputHeight) setInputHeight(nextHeight);
              scrollFocusedInputIntoView(e.target as any);
            }}
          />
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.white },
  container: { padding: SPACING.lg, gap: SPACING.lg - 2 },
  loadStateCard: {
    minHeight: 240,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.md,
    padding: SPACING.xl,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.white,
    ...SHADOWS.base,
  },
  loadStateTitle: {
    color: COLORS.text.primary,
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
    textAlign: 'center',
  },
  loadStateDescription: {
    color: COLORS.text.muted,
    fontSize: TYPOGRAPHY.fontSize.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
  sectionCard: {
    backgroundColor: COLORS.white,
    padding: SPACING.base,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    gap: SPACING.md,
    ...SHADOWS.base,
  },
  sectionTitle: {
    fontWeight: TYPOGRAPHY.fontWeight.extrabold,
    fontSize: TYPOGRAPHY.fontSize.xl,
    color: COLORS.text.primary
  },
  affiliationBox: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  affiliationItem: {
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.sm + 6,
    backgroundColor: COLORS.white,
  },
  affiliationActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryPale
  },
  affiliationText: {
    color: COLORS.text.primary,
    fontSize: TYPOGRAPHY.fontSize.md
  },
  affiliationTextActive: {
    color: COLORS.primary,
    fontWeight: TYPOGRAPHY.fontWeight.bold
  },
  field: { gap: SPACING.xs + 2 },
  fieldLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  label: {
    fontWeight: TYPOGRAPHY.fontWeight.bold,
    color: COLORS.text.primary,
    fontSize: TYPOGRAPHY.fontSize.md
  },
  error: {
    color: COLORS.error,
    fontSize: TYPOGRAPHY.fontSize.sm + 1
  },
  helperText: {
    color: COLORS.text.muted,
    fontSize: TYPOGRAPHY.fontSize.xs + 2,
    marginTop: SPACING.xs
  },
  readonlyBox: {
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.base + 2,
    paddingHorizontal: SPACING.sm + 6,
    paddingVertical: SPACING.sm + 2,
    backgroundColor: COLORS.gray[50],
    minHeight: 52,
    justifyContent: 'center',
  },
  readonlyText: {
    color: COLORS.text.secondary,
    fontSize: TYPOGRAPHY.fontSize.md,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.base + 2,
    paddingHorizontal: SPACING.sm + 6,
    paddingVertical: SPACING.sm + 2,
    backgroundColor: COLORS.white,
    fontSize: TYPOGRAPHY.fontSize.md,
    color: COLORS.text.primary,
    height: 52,
    lineHeight: 20,
    textAlignVertical: 'center',
  },
  inputMultiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  readOnlyInput: {
    color: COLORS.text.secondary,
  },
  inputWithIcon: {
    paddingRight: 44,
  },
  selectBox: {
    position: 'relative',
    justifyContent: 'center',
  },
  selectOverlay: {
    position: 'absolute',
    right: SPACING.md,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  residentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  residentInput: {
    flex: 1,
    textAlign: 'center',
  },
  residentHyphen: {
    fontWeight: TYPOGRAPHY.fontWeight.bold,
    color: COLORS.text.primary,
    fontSize: TYPOGRAPHY.fontSize.md,
  },
  searchButton: {
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.sm + 6,
    borderWidth: 1,
    borderColor: COLORS.primaryLight,
    borderRadius: RADIUS.base + 2,
    backgroundColor: '#fff7f0',
    alignItems: 'center',
  },
  searchButtonText: {
    color: COLORS.primary,
    fontWeight: TYPOGRAPHY.fontWeight.bold
  },
  searchHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
  },
  searchTitle: {
    fontWeight: TYPOGRAPHY.fontWeight.extrabold,
    color: COLORS.text.primary
  },
  searchClose: {
    color: COLORS.primary,
    fontWeight: TYPOGRAPHY.fontWeight.bold
  },
  emailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
  },
  emailLocal: {
    flex: 1.1,
    minWidth: 0,
  },
  emailAt: {
    fontWeight: TYPOGRAPHY.fontWeight.extrabold,
    color: COLORS.text.primary,
    fontSize: TYPOGRAPHY.fontSize.md,
    marginTop: SPACING.md,
  },
  emailDomainBox: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.base,
    overflow: 'hidden',
    justifyContent: 'center',
    height: 54,
    backgroundColor: COLORS.white,
  },
  emailDomainSelect: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
  },
  emailDomainSelectText: {
    color: COLORS.text.primary,
    fontSize: TYPOGRAPHY.fontSize.sm + 1,
    fontWeight: TYPOGRAPHY.fontWeight.semibold,
  },
  emailDomainSelectPlaceholder: {
    color: COLORS.text.muted,
    fontWeight: TYPOGRAPHY.fontWeight.medium,
  },
  emailPicker: {
    color: COLORS.text.primary,
    marginLeft: -SPACING.sm,
    marginRight: -SPACING.sm,
  },
  customDomainInput: {
    marginTop: SPACING.xs,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.base,
    padding: SPACING.sm,
    backgroundColor: COLORS.white,
    fontSize: TYPOGRAPHY.fontSize.sm + 1,
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
  modalTitle: {
    fontSize: TYPOGRAPHY.fontSize.md,
    fontWeight: TYPOGRAPHY.fontWeight.extrabold,
    color: COLORS.text.primary,
    marginBottom: SPACING.md
  },
  modalOptions: { gap: SPACING.sm },
  modalOption: {
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.sm,
    borderRadius: RADIUS.base + 2,
    backgroundColor: COLORS.gray[50],
  },
  modalOptionText: {
    fontSize: TYPOGRAPHY.fontSize.sm + 1,
    fontWeight: TYPOGRAPHY.fontWeight.semibold,
    color: COLORS.text.primary
  },
  modalCancel: {
    marginTop: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    alignItems: 'center',
    borderRadius: RADIUS.base + 2,
    backgroundColor: COLORS.gray[100],
  },
  modalCancelText: {
    fontSize: TYPOGRAPHY.fontSize.sm + 1,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
    color: COLORS.gray[600]
  },
});
