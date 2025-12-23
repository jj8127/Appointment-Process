import { Feather } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RefreshButton } from '@/components/RefreshButton';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useSession } from '@/hooks/use-session';
import { useIdentityGate } from '@/hooks/use-identity-gate';
import { supabase } from '@/lib/supabase';

// Remove static Dimensions
const HANWHA_ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const MUTED = '#6b7280';
const BORDER = '#E5E7EB';
const BACKGROUND = '#ffffff';
const INPUT_BG = '#F9FAFB';

const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
const formatKoreanDate = (d: Date) =>
  `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${weekdays[d.getDay()]})`;

const toYMD = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const AGREEMENT_IMAGES = [
  require('../agreement_imag/01.jpg'),
  require('../agreement_imag/02.jpg'),
  require('../agreement_imag/03.jpg'),
  require('../agreement_imag/04.jpg'),
  require('../agreement_imag/05.jpg'),
  require('../agreement_imag/06.jpg'),
  require('../agreement_imag/07.jpg'),
  require('../agreement_imag/08.jpg'),
  require('../agreement_imag/09.jpg'),
];

export default function AllowanceConsentScreen() {
  const { residentId } = useSession();
  useIdentityGate({ nextPath: '/consent' });
  const [tempId, setTempId] = useState('');
  // TC007: Initialize validation state
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [loading, setLoading] = useState(false);
  const [careerType, setCareerType] = useState<string | null>(null);
  const keyboardPadding = useKeyboardPadding();
  const [showPicker, setShowPicker] = useState(Platform.OS === 'ios');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [imageRatio, setImageRatio] = useState(16 / 9);
  const [refreshing, setRefreshing] = useState(false);
  const sliderRef = useRef<FlatList>(null);

  const maxIndex = AGREEMENT_IMAGES.length - 1;

  useEffect(() => {
    const load = async () => {
      if (!residentId) return;
      const { data } = await supabase
        .from('fc_profiles')
        .select('temp_id, allowance_date, career_type')
        .eq('phone', residentId)
        .maybeSingle();

      console.log('[DEBUG] Mobile: Fetched FC Profile in Consent:', JSON.stringify(data, null, 2));

      setTempId(data?.temp_id ?? '');
      if (data?.allowance_date) setSelectedDate(new Date(data.allowance_date));
      setCareerType(data?.career_type ?? null);
    };
    load();
  }, [residentId]);

  useEffect(() => {
    if (AGREEMENT_IMAGES[0]) {
      // Web safety check
      if (typeof Image.resolveAssetSource === 'function') {
        const { width: iw, height: ih } = Image.resolveAssetSource(AGREEMENT_IMAGES[0]);
        if (iw && ih) setImageRatio(ih / iw);
      }
    }
  }, []);

  const ymd = useMemo(() => toYMD(selectedDate), [selectedDate]);

  const submit = async () => {
    setLoading(true);
    const { error, data } = await supabase
      .from('fc_profiles')
      .update({ allowance_date: ymd, status: 'allowance-pending' })
      .eq('phone', residentId ?? '')
      .select('id,name')
      .single();
    setLoading(false);

    if (error || !data) {
      Alert.alert('저장 실패', error?.message ?? '정보를 저장하지 못했습니다.');
      return;
    }

    supabase.functions
      .invoke('fc-notify', {
        body: { type: 'fc_update', fc_id: data.id, message: `${data.name}님이 수당동의일을 입력했습니다.` },
      })
      .catch(() => { });

    Alert.alert('저장 완료', '수당 동의일이 제출되었습니다. 총무 검토 후 다음 단계로 진행됩니다.');
    router.replace('/');
  };

  const openAllowanceSite = () => {
    Linking.openURL('https://www.sgic.co.kr').catch(() => Alert.alert('오류', '사이트를 열 수 없습니다.'));
  };

  const { width } = useWindowDimensions();
  const cardWidth = Math.min(width - 48, 480); // Constrain max width for desktop
  const cardHeight = cardWidth * imageRatio * 0.8;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (!residentId) return;
      const { data } = await supabase
        .from('fc_profiles')
        .select('temp_id, allowance_date, career_type')
        .eq('phone', residentId)
        .maybeSingle();

      setTempId(data?.temp_id ?? '');
      if (data?.allowance_date) setSelectedDate(new Date(data.allowance_date));
      setCareerType(data?.career_type ?? null);
    } finally {
      setRefreshing(false);
    }
  }, [residentId]);

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[styles.container, { paddingBottom: keyboardPadding + 40 }]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        >
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.pageTitle}>수당 동의 가이드</Text>
              <Text style={styles.pageSub}>서울보증보험 사이트에서 진행해주세요.</Text>
            </View>
            <RefreshButton />
          </View>

          <Pressable style={styles.linkButton} onPress={openAllowanceSite}>
            <Text style={styles.linkButtonText}>서울보증보험 바로가기</Text>
            <Feather name="external-link" size={16} color={HANWHA_ORANGE} />
          </Pressable>

          <View style={styles.sliderContainer}>
            <FlatList
              ref={sliderRef}
              data={AGREEMENT_IMAGES}
              keyExtractor={(_, i) => String(i)}
              horizontal
              showsHorizontalScrollIndicator={false}
              pagingEnabled={false} // pagingEnabled can be buggy on web with variable widths, handled by snapToInterval
              decelerationRate="fast"
              snapToInterval={width}
              snapToAlignment="center"
              disableIntervalMomentum
              getItemLayout={(_, index) => ({
                length: width,
                offset: width * index,
                index,
              })}
              onMomentumScrollEnd={(e) => {
                const idx = Math.round(e.nativeEvent.contentOffset.x / width);
                const nextIndex = Math.max(0, Math.min(maxIndex, idx));
                if (nextIndex !== currentIndex) {
                  setCurrentIndex(nextIndex);
                }
              }}
              renderItem={({ item }) => (
                <View style={{ width, alignItems: 'center', paddingHorizontal: 24 }}>
                  {/* Container width is full screen width, padding centers the card */}
                  <View style={[styles.imageFrame, { height: cardHeight, width: cardWidth }]}>
                    <Image source={item} style={styles.guideImage} resizeMode="contain" />
                  </View>
                </View>
              )}
            />
            <View style={styles.pagination}>
              {AGREEMENT_IMAGES.map((_, i) => (
                <View key={i} style={[styles.dot, currentIndex === i && styles.dotActive]} />
              ))}
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.formSection}>
            <Text style={styles.sectionTitle}>동의 정보 입력</Text>
            <Text style={styles.sectionDesc}>
              동의 완료 후 날짜를 입력해주세요. 총무 승인 후에는 수정할 수 없습니다.
            </Text>

            <View style={styles.careerCard}>
              <View style={styles.careerBadge}>
                <Text style={styles.careerBadgeLabel}>지원 유형</Text>
              </View>
              <Text style={styles.careerMainText}>{careerType || '조회중'}</Text>
              <Text style={styles.careerSubText}>
                {careerType === '신입'
                  ? '신입 유형으로 등록되었습니다.'
                  : careerType === '경력'
                    ? '경력 유형으로 등록되었습니다.'
                    : '총무가 경력 여부를 조회중입니다.'}
              </Text>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>임시사번</Text>
              <TextInput
                style={styles.input}
                placeholder="총무가 임시사번을 발급하는 중입니다."
                placeholderTextColor="#9CA3AF"
                value={tempId}
                editable={false}
                selectTextOnFocus={false}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>수당동의일</Text>
              {Platform.OS === 'ios' || Platform.OS === 'web' ? (
                <DateTimePicker
                  value={selectedDate}
                  mode="date"
                  display="default"
                  locale="ko-KR"
                  onChange={(_, d) => d && setSelectedDate(d)}
                  style={{ alignSelf: 'flex-start' }}
                />
              ) : (
                <Pressable style={styles.dateInput} onPress={() => setShowPicker(true)}>
                  <Text style={styles.dateText}>{formatKoreanDate(selectedDate)}</Text>
                  <Feather name="calendar" size={18} color={MUTED} />
                </Pressable>
              )}
              {showPicker && Platform.OS === 'android' && (
                <DateTimePicker
                  value={selectedDate}
                  mode="date"
                  onChange={(_, d) => {
                    setShowPicker(false);
                    if (d) setSelectedDate(d);
                  }}
                />
              )}
            </View>

            <Pressable
              style={({ pressed }) => [styles.submitButton, pressed && styles.buttonPressed, loading && styles.buttonDisabled]}
              onPress={submit}
              disabled={loading}
            >
              <Text style={styles.submitButtonText}>{loading ? '저장 중...' : '저장하기'}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BACKGROUND },
  container: { paddingBottom: 40 },

  headerRow: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  pageTitle: { fontSize: 22, fontWeight: '800', color: CHARCOAL },
  pageSub: { fontSize: 14, color: MUTED, marginTop: 4 },

  linkButton: {
    marginHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: HANWHA_ORANGE,
    borderRadius: 8,
    backgroundColor: '#fff7ed',
    marginBottom: 24,
  },
  linkButtonText: { color: HANWHA_ORANGE, fontWeight: '700', fontSize: 14 },

  sliderContainer: { marginBottom: 24 },
  imageFrame: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: BORDER,
  },
  guideImage: { width: '100%', height: '100%' },
  pagination: { flexDirection: 'row', justifyContent: 'center', marginTop: 12, gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#E5E7EB' },
  dotActive: { backgroundColor: HANWHA_ORANGE, width: 18 },

  divider: { height: 8, backgroundColor: '#F9FAFB', marginBottom: 24 },

  formSection: { paddingHorizontal: 24 },
  careerCard: {
    backgroundColor: '#FFF0E6', // Light Orange bg
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#ffcca8',
    alignItems: 'center',
  },
  careerBadge: {
    backgroundColor: HANWHA_ORANGE,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 99,
    marginBottom: 8,
  },
  careerBadgeLabel: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  careerMainText: {
    fontSize: 24,
    fontWeight: '800',
    color: HANWHA_ORANGE,
    marginBottom: 4,
  },
  careerSubText: {
    fontSize: 14,
    color: '#9a3412', // Darker orange text
  },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: CHARCOAL, marginBottom: 4 },
  sectionDesc: { fontSize: 14, color: MUTED, marginBottom: 20 },

  inputGroup: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '600', color: CHARCOAL, marginBottom: 8 },
  input: {
    height: 48,
    backgroundColor: INPUT_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    paddingHorizontal: 14,
    fontSize: 16,
    color: CHARCOAL,
  },
  dateInput: {
    height: 48,
    backgroundColor: INPUT_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dateText: { fontSize: 16, color: CHARCOAL },

  submitButton: {
    height: 52,
    backgroundColor: CHARCOAL,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  buttonPressed: { opacity: 0.9 },
  buttonDisabled: { backgroundColor: MUTED },
  submitButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
