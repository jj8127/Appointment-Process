import { Feather } from '@expo/vector-icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { Picker } from '@react-native-picker/picker';
import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Controller, useForm, type Control } from 'react-hook-form';
import {
  Alert,
  BackHandler,
  findNodeHandle,
  Modal,
  Platform,
  Pressable,
  ReturnKeyTypeOptions,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';

import { KeyboardAwareWrapper, useKeyboardAware } from '@/components/KeyboardAwareWrapper';
import { RefreshButton } from '@/components/RefreshButton';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';

const ORANGE = '#f36f21';
const ORANGE_LIGHT = '#f7b182';
const CHARCOAL = '#111827';
const TEXT_MUTED = '#6b7280';
const BORDER = '#e5e7eb';

const PLACEHOLDER = '#9ca3af';

const CARD_SHADOW =
  Platform.OS === 'web'
    ? { boxShadow: '0 2px 6px rgba(0,0,0,0.06)' }
    : {
        shadowColor: '#000',
        shadowOpacity: 0.03,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
        elevation: 2,
      };

const BUTTON_SHADOW =
  Platform.OS === 'web'
    ? { boxShadow: '0 3px 8px rgba(0,0,0,0.18)' }
    : {
        shadowColor: '#000',
        shadowOpacity: 0.08,
        shadowOffset: { width: 0, height: 3 },
        shadowRadius: 8,
        elevation: 3,
      };

const schema = z.object({
  affiliation: z.string().min(1, '소속을 선택해주세요.'),
  name: z.string().min(1, '이름을 입력해주세요.'),
  phone: z.string().min(8, '휴대폰 번호를 입력해주세요.'),
  recommender: z.string().min(1, '추천인을 입력해주세요.'),
  email: z.string().email('유효한 이메일을 입력해주세요.'),
});

type FormValues = z.infer<typeof schema>;

const AFFILIATION_OPTIONS = [
  '1본부 [본부장: 서선미]',
  '2본부 [본부장: 박성훈]',
  '3본부 [본부장: 현경숙]',
  '4본부 [본부장: 최철준]',
  '5본부 [본부장: 박선희]',
  '6본부 [본부장: 김태희]',
  '7본부 [본부장: 김동훈]',
  '8본부 [본부장: 정승철]',
];

const EMAIL_DOMAINS = [
  'naver.com',
  'gmail.com',
  'daum.net',
  'hanmail.net',
  'nate.com',
  '직접입력',
];

async function sendNotificationAndPush(
  role: 'admin' | 'fc',
  residentId: string | null,
  title: string,
  body: string,
) {
  try {
    await supabase.from('notifications').insert({
      title,
      body,
      category: 'app_event',
      recipient_role: role,
      resident_id: residentId,
    });

    const baseQuery = supabase.from('device_tokens').select('expo_push_token');
    const { data: tokens } =
      role === 'fc' && residentId
        ? await baseQuery.eq('role', 'fc').eq('resident_id', residentId)
        : await baseQuery.eq('role', 'admin');

    const payload =
      tokens?.map((t: any) => ({
        to: t.expo_push_token,
        title,
        body,
        data: { type: 'app_event', resident_id: residentId },
      })) ?? [];

    if (payload.length) {
      fetch('/api/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload[0]), // Send single payload or adjust API to handle array
      }).catch(() => {});
    }
  } catch (err) {
    console.warn('sendNotificationAndPush failed', err);
  }
}

export default function FcNewScreen() {
  const { from } = useLocalSearchParams<{ from?: string }>();
  const fromParam = Array.isArray(from) ? from[0] : from;
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const { residentId: phoneFromSession, loginAs, displayName } = useSession();
  const [existingTempId, setExistingTempId] = useState<string | null>(null);
  const [selectedAffiliation, setSelectedAffiliation] = useState('');
  const [emailLocal, setEmailLocal] = useState('');
  const [emailDomain, setEmailDomain] = useState('');
  const [customDomain, setCustomDomain] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [showDomainPicker, setShowDomainPicker] = useState(false);

  const phoneRef = useRef<TextInput>(null);
  const recommenderRef = useRef<TextInput>(null);
  const emailLocalRef = useRef<TextInput>(null);
  const customDomainRef = useRef<TextInput>(null);
  const nameRef = useRef<TextInput>(null); // Added

  const { control, handleSubmit, setValue, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      affiliation: '',
      name: '',
      phone: phoneFromSession ?? '',
      recommender: '',
      email: '',
    },
    mode: 'onBlur',
  });

  const updateEmailValue = (local: string, domain: string, custom: string) => {
    const domainToUse = domain === '직접입력' ? custom : domain;
    const emailValue = local && domainToUse ? `${local}@${domainToUse}` : '';
    setValue('email', emailValue, { shouldValidate: true });
  };

  const loadExisting = async (phone?: string) => {
    const key = phone ?? phoneFromSession;
    if (!key) return;
    const { data, error } = await supabase
      .from('fc_profiles')
      .select('affiliation,name,phone,recommender,email,career_type,temp_id')
      .eq('phone', key)
      .maybeSingle();
    if (error) {
      console.warn('FC load failed', error.message);
      return;
    }
    if (data) {
      setValue('affiliation', data.affiliation ?? '');
      setSelectedAffiliation(data.affiliation ?? '');
      setValue('name', data.name ?? '');
      setValue('phone', data.phone ?? key);
      setValue('recommender', data.recommender ?? '');
      setValue('email', data.email ?? '');
      if (data.email && data.email.includes('@')) {
        const [local, domainPart] = data.email.split('@');
        setEmailLocal(local ?? '');
        setEmailDomain(domainPart ?? '');
        setCustomDomain(domainPart ?? '');
      }
      setExistingTempId(data.temp_id);
    } else {
      setValue('phone', key);
    }
  };

  useEffect(() => {
    loadExisting();
  }, [phoneFromSession]);

  useEffect(() => {
    updateEmailValue(emailLocal, emailDomain, customDomain);
  }, [emailLocal, emailDomain, customDomain]);

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);

    const phoneDigits = values.phone.replace(/[^0-9]/g, '');
    const basePayload = {
      name: values.name,
      affiliation: values.affiliation,
      phone: phoneDigits,
      recommender: values.recommender,
      email: values.email,
      career_type: null,
      status: 'draft',
    };

    console.log('[DEBUG] Mobile: Creating FC Profile Payload:', JSON.stringify(basePayload, null, 2)); // Debug log

    const { data: existing } = await supabase
      .from('fc_profiles')
      .select('id')
      .eq('phone', phoneDigits)
      .maybeSingle();

    let data: { id: string } | null = null;
    let error: any = null;

    if (existing?.id) {
      const { error: updateErr } = await supabase.from('fc_profiles').update(basePayload).eq('id', existing.id);
      error = updateErr;
      data = existing as { id: string };
    } else {
      const { data: insertData, error: insertErr } = await supabase
        .from('fc_profiles')
        .insert(basePayload)
        .select('id')
        .single();
      data = insertData as any;
      error = insertErr;
    }

    setSubmitting(false);

    if (error) {
      Alert.alert('저장 실패', error.message);
      return;
    }

    // Invalidate queries to ensure Home gets fresh data
    queryClient.invalidateQueries({ queryKey: ['my-fc-status'] });

    loginAs('fc', phoneDigits, values.name);
    Alert.alert('저장 완료', '기본정보가 저장되었습니다. FC 홈 화면으로 이동합니다.');
    router.replace('/');

    if (data?.id) {
      void sendNotificationAndPush(
        'admin',
        phoneDigits,
        `${values.name}이/가 기본정보를 등록했습니다.`,
        `${values.name}님이 기본정보를 생성/수정했습니다.`,
      );
    }
  };

  const onError = (errors: any) => {
    const missing = Object.keys(errors);
    if (missing.length > 0) {
      const LABELS: Record<string, string> = {
        affiliation: '소속',
        name: '이름',
        phone: '휴대폰 번호',
        recommender: '추천인',
        email: '이메일',
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
      } else if (first === 'recommender') {
        recommenderRef.current?.focus();
      }
    }
  };

  const handleBack = useCallback(() => {
    const needsLogin = !displayName?.trim();
    if (needsLogin) {
      if (fromParam === 'login') {
        router.replace({ pathname: '/login', params: { skipAuto: '1' } } as any);
      } else {
        router.replace({ pathname: '/login', params: { skipAuto: '1' } } as any);
      }
      return;
    }
    if (fromParam === 'home') {
      router.replace('/');
      return;
    }
    if (fromParam === 'auth') {
      router.replace({ pathname: '/login', params: { skipAuto: '1' } } as any);
      return;
    }
    if (fromParam === 'login') {
      router.replace({ pathname: '/login', params: { skipAuto: '1' } } as any);
      return;
    }
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace({ pathname: '/login', params: { skipAuto: '1' } } as any);
  }, [displayName, fromParam]);

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
  }, []);

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
        contentContainerStyle={[styles.container, { paddingBottom: 120 }]}
        extraScrollHeight={140}>
        <RefreshButton onPress={onRefresh} />

        <View style={styles.hero}>
          <Text style={styles.heroEyebrow}>정보 확인</Text>
          <Text style={styles.title}>기본 정보를 입력해주세요</Text>
          <Text style={styles.caption}>입력 후 저장 버튼을 누르면 다음 단계로 이동합니다. 이미 입력된 정보는 불러옵니다.</Text>
          {existingTempId ? <Text style={styles.temp}>임시번호 {existingTempId}</Text> : null}
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
            onSubmitEditing={() => recommenderRef.current?.focus()}
            blurOnSubmit={false}
            scrollEnabled={false} // Added
          />
          <FormField
            control={control}
            label="추천인"
            placeholder="추천인 이름"
            name="recommender"
            errors={formState.errors}
            inputRef={recommenderRef}
            returnKeyType="next"
            onSubmitEditing={() => emailLocalRef.current?.focus()}
            blurOnSubmit={false}
            scrollEnabled={false} // Added
          />
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
                {/* Picker만 감싸는 박스 */}
                <View style={styles.emailDomainBox}>
                  {Platform.OS === 'ios' ? (
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
                  ) : (
                    <Picker
                      selectedValue={emailDomain || undefined}
                      onValueChange={(value) => {
                        setEmailDomain(value);
                        if (value !== '직접입력') setCustomDomain('');
                      }}
                      dropdownIconColor={CHARCOAL}
                      style={styles.emailPicker}
                      itemStyle={{ fontSize: 14, color: CHARCOAL, height: 40 }}
                    >
                      <Picker.Item label="도메인 선택" value="" color={TEXT_MUTED} style={{ fontSize: 14 }} />
                      {EMAIL_DOMAINS.map((d) => (
                        <Picker.Item key={d} label={d} value={d} style={{ fontSize: 14 }} />
                      ))}
                    </Picker>
                  )}
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

        <Pressable
          style={[styles.primaryButton, submitting && styles.primaryButtonDisabled]}
          onPress={handleSubmit(onSubmit, onError)}
          disabled={submitting}>
          <Text style={styles.primaryButtonText}>
            {submitting ? '저장 중...' : existingTempId ? '수정하기' : '저장하기'}
          </Text>
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
}: FormFieldProps) => {
  const { scrollToInput } = useKeyboardAware();

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
            scrollEnabled={scrollEnabled ?? false}
            ref={inputRef}
            style={[styles.input, multiline && styles.inputMultiline]}
            placeholder={placeholder}
            placeholderTextColor={PLACEHOLDER}
            value={value}
            onChangeText={onChange}
            multiline={multiline}
            returnKeyType={returnKeyType}
            onSubmitEditing={onSubmitEditing}
            blurOnSubmit={blurOnSubmit}
            onFocus={(e) => {
              scrollToInput(findNodeHandle(e.target as any));
            }}
            onContentSizeChange={(e) => {
              if (multiline) {
                scrollToInput(findNodeHandle(e.target as any));
              }
            }}
          />
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#ffffff' },
  container: { padding: 20, gap: 18 },
  hero: { gap: 8, paddingVertical: 8 },
  heroEyebrow: { color: ORANGE, fontWeight: '700', fontSize: 15 }, // 13 -> 15
  title: { fontSize: 28, fontWeight: '800', color: CHARCOAL, lineHeight: 34 }, // 24 -> 28
  caption: { color: TEXT_MUTED, lineHeight: 22, fontSize: 16 }, // default -> 16
  temp: { color: CHARCOAL, fontWeight: '700', marginTop: 4, fontSize: 16 }, // default -> 16
  sectionCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 12,
    ...CARD_SHADOW,
  },
  sectionTitle: { fontWeight: '800', fontSize: 20, color: CHARCOAL }, // 16 -> 20
  affiliationBox: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  affiliationItem: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    paddingVertical: 10, // 8 -> 10
    paddingHorizontal: 14, // 12 -> 14
    backgroundColor: '#fff',
  },
  affiliationActive: { borderColor: ORANGE, backgroundColor: '#fff1e6' },
  affiliationText: { color: CHARCOAL, fontSize: 16 }, // default -> 16
  affiliationTextActive: { color: ORANGE, fontWeight: '700' },
  field: { gap: 6 },
  fieldLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontWeight: '700', color: CHARCOAL, fontSize: 16 }, // default -> 16
  error: { color: '#dc2626', fontSize: 14 }, // 12 -> 14
  input: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#fff',
    fontSize: 16, // added explicit 16
    color: CHARCOAL,
    height: 52, // Fixed height to prevent internal scrolling
    lineHeight: 20,
    textAlignVertical: 'center',
  },
  primaryButton: {
    marginTop: 8,
    marginBottom: 40,
    backgroundColor: ORANGE,
    paddingVertical: 18, // 16 -> 18
    borderRadius: 14,
    alignItems: 'center',
    ...BUTTON_SHADOW,
  },
  primaryButtonDisabled: { opacity: 0.7 },
  primaryButtonText: { color: '#fff', fontWeight: '800', fontSize: 18 }, // 16 -> 18
  emailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  emailLocal: {
    flex: 1.1,
    minWidth: 0,
  },
  emailAt: {
    fontWeight: '800',
    color: CHARCOAL,
    fontSize: 16,
    marginTop: 12,
  },
  emailDomainBox: {
    flex: 1,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    overflow: 'hidden',
    justifyContent: 'center',
    height: 54, // 50 -> 54
    backgroundColor: '#fff',
  },
  emailDomainSelect: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  emailDomainSelectText: {
    color: CHARCOAL,
    fontSize: 14,
    fontWeight: '600',
  },
  emailDomainSelectPlaceholder: {
    color: TEXT_MUTED,
    fontWeight: '500',
  },
  emailPicker: {
    color: CHARCOAL,
    marginLeft: -8,
    marginRight: -8,
  },
  customDomainInput: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    padding: 8,
    backgroundColor: '#fff',
    fontSize: 14, // 12 -> 14
    height: 44, // 40 -> 44
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
  },
  modalTitle: { fontSize: 16, fontWeight: '800', color: CHARCOAL, marginBottom: 12 },
  modalOptions: { gap: 8 },
  modalOption: {
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: '#F9FAFB',
  },
  modalOptionText: { fontSize: 14, fontWeight: '600', color: CHARCOAL },
  modalCancel: {
    marginTop: 12,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
  },
  modalCancelText: { fontSize: 14, fontWeight: '700', color: '#4B5563' },
});
