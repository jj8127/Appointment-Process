import Postcode from '@actbase/react-daum-postcode';
import { Feather } from '@expo/vector-icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';

import { KeyboardAwareWrapper } from '@/components/KeyboardAwareWrapper';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';

const HANWHA_ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const TEXT_MUTED = '#6b7280';
const BORDER = '#e5e7eb';
const PLACEHOLDER = '#9ca3af';

const isValidResidentChecksum = (front: string, back: string) => {
  const digits = `${front}${back}`;
  if (!/^\d{13}$/.test(digits)) return false;
  const weights = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5];
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(digits[i]) * weights[i];
  }
  const check = (11 - (sum % 11)) % 10;
  return check === Number(digits[12]);
};

const schema = z.object({
  residentFront: z.string().regex(/^[0-9]{6}$/, '앞 6자리를 숫자로 입력해주세요.'),
  residentBack: z.string().regex(/^[0-9]{7}$/, '뒷 7자리를 숫자로 입력해주세요.'),
  address: z.string().min(1, '주소를 입력해주세요.'),
  addressDetail: z.string().min(1, '상세주소를 입력해주세요.'),
});

type FormValues = z.infer<typeof schema>;

export default function IdentityScreen() {
  const { next } = useLocalSearchParams<{ next?: string }>();
  const { role, residentId, hydrated } = useSession();
  const [submitting, setSubmitting] = useState(false);
  const [showAddressSearch, setShowAddressSearch] = useState(false);
  const [addressHeight, setAddressHeight] = useState(90);
  const keyboardPadding = useKeyboardPadding();

  const residentFrontRef = useRef<TextInput>(null);
  const residentBackRef = useRef<TextInput>(null);
  const addressDetailRef = useRef<TextInput>(null);

  const { control, handleSubmit, formState, setError, setValue } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      residentFront: '',
      residentBack: '',
      address: '',
      addressDetail: '',
    },
    mode: 'onBlur',
  });

  useEffect(() => {
    if (!hydrated) return;
    if (!role) {
      router.replace('/login');
      return;
    }
    if (role === 'admin') {
      router.replace('/');
    }
  }, [hydrated, role]);

  const onSubmit = async (values: FormValues) => {
    if (!residentId) {
      Alert.alert('오류', '로그인 정보를 확인할 수 없습니다.');
      return;
    }
    setSubmitting(true);
    try {
      const front = values.residentFront.trim();
      const back = values.residentBack.trim();
      const address = values.address.trim();
      const addressDetail = values.addressDetail.trim();

      if (!/^[0-9]{6}$/.test(front)) {
        setError('residentFront', { type: 'manual', message: '앞 6자리를 숫자로 입력해주세요.' });
        return;
      }
      if (!/^[0-9]{7}$/.test(back)) {
        setError('residentBack', { type: 'manual', message: '뒷 7자리를 숫자로 입력해주세요.' });
        return;
      }
      if (!isValidResidentChecksum(front, back)) {
        setError('residentBack', { type: 'manual', message: '주민등록번호를 다시 확인해주세요.' });
        return;
      }
      if (!address) {
        setError('address', { type: 'manual', message: '주소를 입력해주세요.' });
        return;
      }
      if (!addressDetail) {
        setError('addressDetail', { type: 'manual', message: '상세주소를 입력해주세요.' });
        return;
      }

      const payload = {
        residentId,
        residentFront: front,
        residentBack: back,
        address,
        addressDetail,
      };
      const { error } = await supabase.functions.invoke('store-identity', { body: payload });
      if (error) throw error;
      Alert.alert('등록 완료', '신원 정보가 저장되었습니다.');
      router.replace((next as string) || '/');
    } catch (err: any) {
      Alert.alert('저장 실패', err?.message ?? '신원 정보 저장 중 문제가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <KeyboardAwareWrapper
        contentContainerStyle={[styles.container, { paddingBottom: Math.max(80, keyboardPadding + 40) }]}
        extraScrollHeight={140}
        keyboardShouldPersistTaps="always"
      >
        <View style={styles.noticeBox}>
          <Text style={styles.noticeTitle}>본 단계는 위촉(등록) 신청을 위한 법정 절차 단계입니다.</Text>
          <Text style={styles.noticeText}>수집 목적: 임시사번 발급 및 등록/위촉 처리</Text>
          <Text style={styles.noticeText}>보관/파기: 중단 시 파기, 완료 후 법정 보관기간 준수</Text>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>신원 확인</Text>
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
                    testID="identity-resident-front"
                    accessibilityLabel="주민등록번호 앞 6자리"
                    onChangeText={(txt) => {
                      const cleaned = txt.replace(/[^0-9]/g, '').slice(0, 6);
                      onChange(cleaned);
                      if (cleaned.length === 6) residentBackRef.current?.focus();
                    }}
                    keyboardType="number-pad"
                    maxLength={6}
                    returnKeyType="next"
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
                    testID="identity-resident-back"
                    accessibilityLabel="주민등록번호 뒤 7자리"
                    onChangeText={(txt) => {
                      const cleaned = txt.replace(/[^0-9]/g, '').slice(0, 7);
                      onChange(cleaned);
                    }}
                    keyboardType="number-pad"
                    maxLength={7}
                    secureTextEntry
                    returnKeyType="next"
                  />
                )}
              />
            </View>
          </View>

          <View style={styles.field}>
            <View style={styles.fieldLabelRow}>
              <Text style={styles.label}>주소</Text>
              {formState.errors.address?.message ? <Text style={styles.error}>{formState.errors.address?.message}</Text> : null}
            </View>
            <Pressable
              style={styles.searchButton}
              onPress={() => setShowAddressSearch(true)}
              testID="identity-address-search"
              accessibilityLabel="주소 검색"
            >
              <Text style={styles.searchButtonText}>주소 검색</Text>
            </Pressable>
            <Controller
              control={control}
              name="address"
              render={({ field: { onChange, value } }) => (
                <TextInput
                  style={[styles.input, styles.inputMultiline, { height: addressHeight }]}
                  placeholder="도로명 또는 지번 주소"
                  placeholderTextColor={PLACEHOLDER}
                  value={value}
                  testID="identity-address"
                  accessibilityLabel="주소"
                  onChangeText={onChange}
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

          <View style={styles.field}>
            <View style={styles.fieldLabelRow}>
              <Text style={styles.label}>상세주소</Text>
              {formState.errors.addressDetail?.message ? (
                <Text style={styles.error}>{formState.errors.addressDetail?.message}</Text>
              ) : null}
            </View>
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
                  testID="identity-address-detail"
                  accessibilityLabel="상세주소"
                  onChangeText={onChange}
                />
              )}
            />
          </View>
        </View>

        <Pressable
          style={[styles.primaryButton, submitting && styles.primaryButtonDisabled]}
          onPress={handleSubmit(onSubmit)}
          disabled={submitting}
        >
          <Text style={styles.primaryButtonText}>{submitting ? '저장 중...' : '확인 및 저장'}</Text>
        </Pressable>
      </KeyboardAwareWrapper>

      <Modal visible={showAddressSearch} animationType="slide">
        <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
          <View style={styles.searchHeader}>
            <Text style={styles.searchTitle}>주소 검색</Text>
            <Pressable onPress={() => setShowAddressSearch(false)}>
              <Text style={styles.searchClose}>닫기</Text>
            </Pressable>
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
            onError={() => {
              Alert.alert('주소 검색 실패', '주소 검색 중 오류가 발생했습니다. 다시 시도해주세요.');
            }}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  container: { padding: 20, gap: 18, paddingBottom: 80 },
  noticeBox: {
    backgroundColor: '#fff7f0',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#fed7aa',
    gap: 6,
  },
  noticeTitle: { fontSize: 15, fontWeight: '800', color: CHARCOAL },
  noticeText: { fontSize: 13, color: TEXT_MUTED },
  sectionCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 12,
  },
  sectionTitle: { fontWeight: '800', fontSize: 18, color: CHARCOAL },
  field: { gap: 6 },
  fieldLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontWeight: '700', color: CHARCOAL, fontSize: 14 },
  error: { color: '#dc2626', fontSize: 12 },
  input: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#fff',
    fontSize: 15,
    color: CHARCOAL,
  },
  residentRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  residentHyphen: { fontWeight: '800', color: CHARCOAL },
  residentInput: { flex: 1, minWidth: 0 },
  inputMultiline: { minHeight: 90, textAlignVertical: 'top' },
  searchButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#f7b182',
    borderRadius: 10,
    backgroundColor: '#fff7f0',
    alignItems: 'center',
  },
  searchButtonText: { color: HANWHA_ORANGE, fontWeight: '700' },
  primaryButton: {
    backgroundColor: HANWHA_ORANGE,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  primaryButtonDisabled: { opacity: 0.7 },
  primaryButtonText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  searchHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  searchTitle: { fontWeight: '800', color: CHARCOAL },
  searchClose: { color: HANWHA_ORANGE, fontWeight: '700' },
});
