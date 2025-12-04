import Postcode from '@actbase/react-daum-postcode';
import { zodResolver } from '@hookform/resolvers/zod';
import { Picker } from '@react-native-picker/picker';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Controller, useForm, type Control } from 'react-hook-form';
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ReturnKeyTypeOptions,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';

import { KeyboardAwareWrapper } from '@/components/KeyboardAwareWrapper';
import { RefreshButton } from '@/components/RefreshButton';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';
import { CareerType } from '@/types/fc';

const ORANGE = '#f36f21';
const ORANGE_LIGHT = '#f7b182';
const CHARCOAL = '#111827';
const TEXT_MUTED = '#6b7280';
const BORDER = '#e5e7eb';
const PLACEHOLDER = '#9ca3af';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

const schema = z.object({
  affiliation: z.string().min(1, '소속을 선택해주세요.'),
  name: z.string().min(1, '이름을 입력해주세요.'),
  phone: z.string().min(8, '휴대폰 번호를 입력해주세요.'),
  residentFront: z.string().regex(/^[0-9]{6}$/, '앞 6자리를 숫자로 입력해주세요.'),
  residentBack: z.string().regex(/^[0-9]{7}$/, '뒷 7자리를 숫자로 입력해주세요.'),
  recommender: z.string().optional(),
  email: z.string().email('유효한 이메일을 입력해주세요.').optional(),
  address: z.string().optional(),
  addressDetail: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

const AFFILIATION_OPTIONS = [
  '1지점 [본부장: 서선미]',
  '2지점 [본부장: 박성훈]',
  '3지점 [본부장: 현경숙]',
  '4지점 [본부장: 최철준]',
  '5지점 [본부장: 박선희]',
  '6지점 [본부장: 김태희]',
  '7지점 [본부장: 김동훈]',
  '8지점 [본부장: 정승철]',
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
    await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }
}

export default function FcNewScreen() {
  const [submitting, setSubmitting] = useState(false);
  const { residentId: phoneFromSession, loginAs } = useSession();
  const [existingTempId, setExistingTempId] = useState<string | null>(null);
  const [selectedAffiliation, setSelectedAffiliation] = useState('');
  const [showAddressSearch, setShowAddressSearch] = useState(false);
  const [emailLocal, setEmailLocal] = useState('');
  const [emailDomain, setEmailDomain] = useState('');
  const [customDomain, setCustomDomain] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const phoneRef = useRef<TextInput>(null);
  const residentFrontRef = useRef<TextInput>(null);
  const residentBackRef = useRef<TextInput>(null);
  const recommenderRef = useRef<TextInput>(null);
  const emailLocalRef = useRef<TextInput>(null);
  const customDomainRef = useRef<TextInput>(null);
  const addressDetailRef = useRef<TextInput>(null);

  const { control, handleSubmit, setValue, formState, watch } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      affiliation: '',
      name: '',
      phone: phoneFromSession,
      residentFront: '',
      residentBack: '',
      address: '',
      addressDetail: '',
    },
    mode: 'onBlur',
  });
  const addressValue = watch('address');
  const addressDetailValue = watch('addressDetail');

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
      .select(
        'affiliation,name,phone,recommender,email,address,address_detail,career_type,temp_id,resident_number',
      )
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
      setValue('address', data.address ?? '');
      setValue('addressDetail', data.address_detail ?? '');
      if (data.email && data.email.includes('@')) {
        const [local, domainPart] = data.email.split('@');
        setEmailLocal(local ?? '');
        setEmailDomain(domainPart ?? '');
        setCustomDomain(domainPart ?? '');
      }
      setExistingTempId(data.temp_id);
      if (data.resident_number) {
        const digits = String(data.resident_number).replace(/[^0-9]/g, '');
        setValue('residentFront', digits.slice(0, 6));
        setValue('residentBack', digits.slice(6, 13));
      }
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
    const residentFront = values.residentFront.replace(/[^0-9]/g, '').slice(0, 6);
    const residentBack = values.residentBack.replace(/[^0-9]/g, '').slice(0, 7);
    const residentNumber = `${residentFront}${residentBack}`;
    const residentMasked = `${residentFront}-${residentBack}`;

    const basePayload = {
      name: values.name,
      affiliation: values.affiliation,
      phone: phoneDigits,
      resident_number: residentNumber,
      resident_id_masked: residentMasked,
      recommender: values.recommender,
      email: values.email,
      address: (values.address ?? '').trim(),
      address_detail: (values.addressDetail ?? '').trim(),
      career_type: '경력' as CareerType,
      status: 'draft',
    };

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

    if (data?.id) {
      await sendNotificationAndPush(
        'admin',
        phoneDigits,
        `${values.name}이/가 기본정보를 등록했습니다.`,
        `${values.name}님이 기본정보를 생성/수정했습니다.`,
      );
    }

    loginAs('fc', phoneDigits, values.name);
    Alert.alert('저장 완료', '기본정보가 저장되었습니다. FC 홈 화면으로 이동합니다.', [
      { text: '확인', onPress: () => router.replace('/') },
    ]);
  };

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
      <KeyboardAwareWrapper
        contentContainerStyle={[styles.container, { paddingBottom: 120 }]}
        extraScrollHeight={140}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
          <RefreshButton />

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
              errors={formState.errors}
              returnKeyType="next"
              onSubmitEditing={() => phoneRef.current?.focus()}
              blurOnSubmit={false}
            />
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>연락처 및 주소</Text>
            <FormField
              control={control}
              label="휴대폰 번호"
              placeholder="010-1234-5678"
              name="phone"
              errors={formState.errors}
              inputRef={phoneRef}
              returnKeyType="next"
              onSubmitEditing={() => residentFrontRef.current?.focus()}
              blurOnSubmit={false}
            />
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
                      onChangeText={(txt) => {
                        const cleaned = txt.replace(/[^0-9]/g, '').slice(0, 6);
                        onChange(cleaned);
                        if (cleaned.length === 6) residentBackRef.current?.focus();
                      }}
                      keyboardType="number-pad"
                      maxLength={6}
                      returnKeyType="next"
                      onSubmitEditing={() => residentBackRef.current?.focus()}
                      blurOnSubmit={false}
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
                      onChangeText={(txt) => {
                        const cleaned = txt.replace(/[^0-9]/g, '').slice(0, 7);
                        onChange(cleaned);
                        if (cleaned.length === 7) recommenderRef.current?.focus();
                      }}
                      keyboardType="number-pad"
                      maxLength={7}
                      returnKeyType="next"
                      onSubmitEditing={() => recommenderRef.current?.focus()}
                      blurOnSubmit={false}
                    />
                  )}
                />
              </View>
            </View>
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
                />
                <Text style={styles.emailAt}>@</Text>

                {/* 오른쪽 영역 */}
                <View style={{ flex: 1 }}>
                  {/* Picker만 감싸는 박스 */}
                  <View style={styles.emailDomainBox}>
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
                      returnKeyType="next"
                      onSubmitEditing={() => addressDetailRef.current?.focus()}
                      blurOnSubmit={false}
                    />
                  ) : null}
                </View>
              </View>

            </View>
            <View style={styles.field}>
              <View style={styles.fieldLabelRow}>
                <Text style={styles.label}>주소</Text>
                {formState.errors.address?.message ? <Text style={styles.error}>{formState.errors.address?.message}</Text> : null}
              </View>
              <View style={{ gap: 8 }}>
                <Pressable style={styles.searchButton} onPress={() => setShowAddressSearch(true)}><Text style={styles.searchButtonText}>주소 검색 (선택)</Text></Pressable>
                <Controller
                  control={control}
                  name="address"
                  render={({ field: { onChange, value } }) => (
                    <TextInput
                      style={[styles.input, styles.inputMultiline]}
                      placeholder="도로명 또는 지번 주소"
                      placeholderTextColor={PLACEHOLDER}
                      value={value}
                      onChangeText={onChange}
                      multiline
                    />
                  )}
                />
                <Controller
                  control={control}
                  name="addressDetail"
                  render={({ field: { onChange, value } }) => (
                    <TextInput
                      ref={addressDetailRef}
                      style={styles.input}
                      placeholder="상세 주소"
                      placeholderTextColor={PLACEHOLDER}
                      value={value}
                      onChangeText={onChange}
                      returnKeyType="done"
                      onSubmitEditing={handleSubmit(onSubmit)}
                    />
                  )}
                />
              </View>
            </View>
          </View>

          <Pressable
            style={[styles.primaryButton, submitting && styles.primaryButtonDisabled]}
            onPress={handleSubmit(onSubmit)}
            disabled={submitting}>
            <Text style={styles.primaryButtonText}>{submitting ? '저장 중...' : '저장하기'}</Text>
          </Pressable>
      </KeyboardAwareWrapper>
      <Modal visible={showAddressSearch} animationType="slide">
        <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 12, borderBottomWidth: 1, borderColor: BORDER }}>
            <Text style={{ fontWeight: '800', color: CHARCOAL }}>주소 검색</Text>
            <Pressable onPress={() => setShowAddressSearch(false)}><Text style={{ color: ORANGE, fontWeight: '700' }}>닫기</Text></Pressable>
          </View>
          <Postcode
            style={{ flex: 1 }}
            jsOptions={{ animation: true }}
            onSelected={(data: any) => {
              const base = data.address || '';
              const extra = data.buildingName ? ` (${data.buildingName})` : '';
              const full = `${data.zonecode ? `[${data.zonecode}] ` : ''}${base}${extra}`;
              setValue('address', full, { shouldValidate: true });
              setShowAddressSearch(false);
            }}
            onError={(error: any) => {
              console.log('Postcode error', error);
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
}: FormFieldProps) => (
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
        />
      )}
    />
  </View>
);

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#ffffff' },
  container: { padding: 20, gap: 18 },
  hero: { gap: 8, paddingVertical: 8 },
  heroEyebrow: { color: ORANGE, fontWeight: '700', fontSize: 13 },
  title: { fontSize: 24, fontWeight: '800', color: CHARCOAL, lineHeight: 30 },
  caption: { color: TEXT_MUTED, lineHeight: 20 },
  temp: { color: CHARCOAL, fontWeight: '700', marginTop: 4 },
  sectionCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  sectionTitle: { fontWeight: '800', fontSize: 16, color: CHARCOAL },
  affiliationBox: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  affiliationItem: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
  },
  affiliationActive: { borderColor: ORANGE, backgroundColor: '#fff1e6' },
  affiliationText: { color: CHARCOAL },
  affiliationTextActive: { color: ORANGE, fontWeight: '700' },
  field: { gap: 6 },
  fieldLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontWeight: '700', color: CHARCOAL },
  error: { color: '#dc2626', fontSize: 12 },
  input: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    padding: 12,
    backgroundColor: '#fff',
  },
  residentRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  residentHyphen: { fontWeight: '800', color: CHARCOAL },
  residentInput: { flex: 1 },
  inputMultiline: { height: 90, textAlignVertical: 'top' },
  searchButton: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: ORANGE_LIGHT,
    borderRadius: 10,
    backgroundColor: '#fff7f0',
    alignItems: 'center',
  },
  searchButtonText: { color: ORANGE, fontWeight: '700' },
  primaryButton: {
    marginTop: 8,
    backgroundColor: ORANGE,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 8,
    elevation: 3,
  },
  primaryButtonDisabled: { opacity: 0.7 },
  primaryButtonText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  emailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  emailLocal: {
    flex: 1.1,
  },
  emailAt: {
    fontWeight: '800',
    color: CHARCOAL,
  },
  emailDomainBox: {
    flex: 1,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    overflow: 'hidden',
    justifyContent: 'center',
    height: 50,
    backgroundColor: '#fff',
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
    fontSize: 12,
    height: 40,
  },
});
