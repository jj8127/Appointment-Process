import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { Controller, type Control, useForm } from 'react-hook-form';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';
import { router } from 'expo-router';

import { RefreshButton } from '@/components/RefreshButton';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';
import { CareerType } from '@/types/fc';

const ORANGE = '#f36f21';
const ORANGE_LIGHT = '#f7b182';
const CHARCOAL = '#111827';
const TEXT_MUTED = '#6b7280';
const BORDER = '#e5e7eb';
const PLACEHOLDER = '#9ca3af';

const schema = z.object({
  affiliation: z.string().min(1, '소속을 선택해주세요.'),
  name: z.string().min(1, '이름을 입력해주세요.'),
  residentId: z.string().min(6, '주민번호를 입력해주세요.'),
  phone: z.string().min(8, '휴대폰번호를 입력해주세요.'),
  recommender: z.string().optional(),
  email: z.string().email('올바른 이메일을 입력해주세요.').optional(),
  address: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

const AFFILIATION_OPTIONS = [
  '1본부 [본부장: 서선미]',
  '2본부 [본부장: 박성훈]',
  '3본부 [본부장: 현경숙]',
  '4본부 [본부장: 최철준]',
  '5본부 [본부장: 박선희]',
  '6본부 [본부장: 김태희]',
  '7본부 [본부장: 정승철]',
  '8본부 [본부장: 김주용]',
  '9본부 - 직할 3',
];

export default function FcNewScreen() {
  const [submitting, setSubmitting] = useState(false);
  const { residentId, loginAs } = useSession();
  const keyboardPadding = useKeyboardPadding();
  const [existingTempId, setExistingTempId] = useState<string | null>(null);
  const [selectedAffiliation, setSelectedAffiliation] = useState('');

  const { control, handleSubmit, setValue, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { affiliation: '', name: '', residentId: '', phone: '' },
    mode: 'onBlur',
  });

  const loadExisting = async (id?: string) => {
    const key = id ?? residentId;
    if (!key) return;
    const { data, error } = await supabase
      .from('fc_profiles')
      .select('affiliation,name,phone,recommender,email,address,career_type,temp_id,resident_id_masked')
      .eq('resident_id_masked', key)
      .maybeSingle();
    if (error) {
      console.warn('FC load failed', error.message);
      return;
    }
    if (data) {
      setValue('affiliation', data.affiliation ?? '');
      setSelectedAffiliation(data.affiliation ?? '');
      setValue('name', data.name ?? '');
      setValue('phone', data.phone ?? '');
      setValue('recommender', data.recommender ?? '');
      setValue('email', data.email ?? '');
      setValue('address', data.address ?? '');
      setExistingTempId(data.temp_id);
      setValue('residentId', data.resident_id_masked ?? '');
    }
  };

  useEffect(() => {
    loadExisting();
  }, [residentId]);

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);

    const payload = {
      name: values.name,
      affiliation: values.affiliation,
      resident_id_masked: values.residentId,
      phone: values.phone,
      recommender: values.recommender,
      email: values.email,
      address: values.address,
      career_type: '신입' as CareerType,
      status: 'draft',
    };

    const { data, error } = await supabase
      .from('fc_profiles')
      .upsert(payload, { onConflict: 'resident_id_masked' })
      .select('id')
      .single();

    setSubmitting(false);

    if (error) {
      Alert.alert('저장 실패', error.message);
      return;
    }

    if (data?.id) {
      await supabase.functions.invoke('fc-notify', {
        body: {
          type: 'fc_update',
          fc_id: data.id,
          message: `${values.name}님의 기본정보가 저장/업데이트되었습니다.`,
        },
      });
    }

    loginAs('fc', values.residentId, values.name);
    Alert.alert('저장 완료', '정보가 저장되었습니다. FC 홈 화면으로 이동합니다.', [
      { text: '확인', onPress: () => router.replace('/') },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[styles.container, { paddingBottom: keyboardPadding + 140 }]}
          keyboardShouldPersistTaps="handled">
          <RefreshButton />

          <View style={styles.hero}>
            <Text style={styles.heroEyebrow}>진행 확인</Text>
            <Text style={styles.title}>기본 정보를 입력해주세요</Text>
            <Text style={styles.caption}>입력 후 다음 단계로 이동합니다. 이미 입력한 정보는 불러와집니다.</Text>
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

            <FormField control={control} label="이름" placeholder="홍길동" name="name" errors={formState.errors} />
            <FormField control={control} label="주민등록번호" placeholder="901010-1234567" name="residentId" errors={formState.errors} />
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>연락처 및 주소</Text>
            <FormField control={control} label="휴대폰번호" placeholder="010-1234-5678" name="phone" errors={formState.errors} />
            <FormField control={control} label="추천인" placeholder="동료FC" name="recommender" errors={formState.errors} />
            <FormField control={control} label="이메일" placeholder="name@company.com" name="email" errors={formState.errors} />
            <FormField
              control={control}
              label="주소"
              placeholder="거주지 또는 주소"
              name="address"
              errors={formState.errors}
              multiline
            />
          </View>

          <Pressable
            style={[styles.primaryButton, submitting && styles.primaryButtonDisabled]}
            onPress={handleSubmit(onSubmit)}
            disabled={submitting}>
            <Text style={styles.primaryButtonText}>{submitting ? '저장 중...' : '저장하기'}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
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
};

const FormField = ({ control, label, placeholder, name, errors, multiline }: FormFieldProps) => (
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
          style={[styles.input, multiline && styles.inputMultiline]}
          placeholder={placeholder}
          placeholderTextColor={PLACEHOLDER}
          value={value}
          onChangeText={onChange}
          multiline={multiline}
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
  inputMultiline: { height: 90, textAlignVertical: 'top' },
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
});
