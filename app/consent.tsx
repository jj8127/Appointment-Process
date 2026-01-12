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
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { FormInput } from '@/components/FormInput';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useSession } from '@/hooks/use-session';
import { useIdentityGate } from '@/hooks/use-identity-gate';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { COLORS, TYPOGRAPHY, SPACING, RADIUS } from '@/lib/theme';

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
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [careerType, setCareerType] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState<string | null>(null);
  const keyboardPadding = useKeyboardPadding();
  const [showPicker, setShowPicker] = useState(false);
  const [tempDate, setTempDate] = useState<Date | null>(null);
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
        .select('temp_id, allowance_date, career_type, allowance_reject_reason')
        .eq('phone', residentId)
        .maybeSingle();

      logger.debug('[DEBUG] Mobile: Fetched FC Profile in Consent:', { data: JSON.stringify(data, null, 2) });

      setTempId(data?.temp_id ?? '');
      if (data?.allowance_date) {
        setSelectedDate(new Date(data.allowance_date));
      } else {
        setSelectedDate(null);
      }
      setCareerType(data?.career_type ?? null);
      setRejectReason(data?.allowance_reject_reason ?? null);
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

  const ymd = useMemo(() => (selectedDate ? toYMD(selectedDate) : ''), [selectedDate]);

  const submit = async () => {
    if (!selectedDate) {
      Alert.alert('입력 확인', '수당 동의일을 선택해주세요.');
      return;
    }
    setLoading(true);
    const { error, data } = await supabase
      .from('fc_profiles')
      .update({ allowance_date: ymd, status: 'allowance-pending', allowance_reject_reason: null })
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
        .select('temp_id, allowance_date, career_type, allowance_reject_reason')
        .eq('phone', residentId)
        .maybeSingle();

      setTempId(data?.temp_id ?? '');
      if (data?.allowance_date) {
        setSelectedDate(new Date(data.allowance_date));
      } else {
        setSelectedDate(null);
      }
      setCareerType(data?.career_type ?? null);
      setRejectReason(data?.allowance_reject_reason ?? null);
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
          <ScreenHeader
            title="수당 동의 가이드"
            subtitle="서울보증보험 사이트에서 진행해주세요."
            showRefresh
            onRefresh={onRefresh}
          />

          <View style={{ paddingHorizontal: SPACING.xl, marginBottom: SPACING.xl }}>
            <Button
              onPress={openAllowanceSite}
              variant="outline"
              size="md"
              fullWidth
              rightIcon={<Feather name="external-link" size={16} color={COLORS.primary} />}
            >
              서울보증보험 바로가기
            </Button>
          </View>

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
            {!!rejectReason && (
              <View style={styles.rejectBox}>
                <Text style={styles.rejectTitle}>반려 사유</Text>
                <Text style={styles.rejectText}>{rejectReason}</Text>
              </View>
            )}

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

            <FormInput
              label="임시사번"
              placeholder="총무가 임시사번을 발급하는 중입니다."
              value={tempId}
              editable={false}
              selectTextOnFocus={false}
              containerStyle={styles.inputGroup}
            />

            <View style={styles.inputGroup}>
              <Text style={styles.label}>수당동의일</Text>
              <Pressable
                style={styles.dateInput}
                onPress={() => {
                  setTempDate(selectedDate ?? new Date());
                  setShowPicker(true);
                }}
              >
                <Text style={[styles.dateText, !selectedDate && styles.dateTextPlaceholder]}>
                  {selectedDate ? formatKoreanDate(selectedDate) : '날짜를 선택해주세요'}
                </Text>
                <Feather name="calendar" size={18} color={COLORS.text.secondary} />
              </Pressable>
              {showPicker && Platform.OS !== 'ios' && (
                <DateTimePicker
                  value={selectedDate ?? new Date()}
                  mode="date"
                  display="default"
                  locale="ko-KR"
                  onChange={(event, d) => {
                    setShowPicker(false);
                    if (event.type === 'dismissed') {
                      return;
                    }
                    if (d) setSelectedDate(d);
                  }}
                />
              )}
            </View>

            <Button
              onPress={submit}
              disabled={loading}
              loading={loading}
              variant="primary"
              size="lg"
              fullWidth
              style={{ marginTop: 8 }}
            >
              저장하기
            </Button>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {Platform.OS === 'ios' && (
        <Modal visible={showPicker} transparent animationType="fade">
          <View style={styles.pickerOverlay}>
            <View style={styles.pickerCard}>
              <DateTimePicker
                value={tempDate ?? selectedDate ?? new Date()}
                mode="date"
                display="spinner"
                locale="ko-KR"
                onChange={(_, d) => {
                  if (d) setTempDate(d);
                }}
              />
              <View style={styles.pickerActions}>
                <Button
                  variant="ghost"
                  size="md"
                  onPress={() => {
                    setShowPicker(false);
                    setTempDate(null);
                  }}
                >
                  취소
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  onPress={() => {
                    if (tempDate) setSelectedDate(tempDate);
                    setShowPicker(false);
                    setTempDate(null);
                  }}
                >
                  확인
                </Button>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.white },
  container: { paddingBottom: SPACING['2xl'] + 8 },

  sliderContainer: { marginBottom: SPACING.xl },
  imageFrame: {
    backgroundColor: COLORS.gray[100],
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border.light,
  },
  guideImage: { width: '100%', height: '100%' },
  pagination: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: SPACING.md,
    gap: SPACING.xs + 2
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.gray[300]
  },
  dotActive: {
    backgroundColor: COLORS.primary,
    width: 18
  },

  divider: {
    height: SPACING.sm,
    backgroundColor: COLORS.background.secondary,
    marginBottom: SPACING.xl
  },

  formSection: { paddingHorizontal: SPACING.xl },
  careerCard: {
    backgroundColor: '#FFF0E6',
    borderRadius: RADIUS.md,
    padding: SPACING.base,
    marginBottom: SPACING.xl,
    borderWidth: 1,
    borderColor: '#ffcca8',
    alignItems: 'center',
  },
  careerBadge: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.full,
    marginBottom: SPACING.sm,
  },
  careerBadgeLabel: {
    color: COLORS.white,
    fontSize: TYPOGRAPHY.fontSize.xs + 1,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
  },
  careerMainText: {
    fontSize: TYPOGRAPHY.fontSize['2xl'],
    fontWeight: TYPOGRAPHY.fontWeight.extrabold,
    color: COLORS.primary,
    marginBottom: SPACING.xs,
  },
  careerSubText: {
    fontSize: TYPOGRAPHY.fontSize.sm + 1,
    color: '#9a3412',
  },
  sectionTitle: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontWeight: TYPOGRAPHY.fontWeight.extrabold,
    color: COLORS.text.primary,
    marginBottom: SPACING.xs
  },
  sectionDesc: {
    fontSize: TYPOGRAPHY.fontSize.sm + 1,
    color: COLORS.text.muted,
    marginBottom: SPACING.lg
  },
  rejectBox: {
    backgroundColor: COLORS.errorLight,
    borderColor: '#FECACA',
    borderWidth: 1,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    marginBottom: SPACING.base,
  },
  rejectTitle: {
    fontSize: TYPOGRAPHY.fontSize.xs + 1,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
    color: '#B91C1C',
    marginBottom: SPACING.xs + 2,
  },
  rejectText: {
    fontSize: TYPOGRAPHY.fontSize.xs + 1,
    color: '#7F1D1D',
    lineHeight: 18,
  },

  inputGroup: { marginBottom: SPACING.base },
  label: {
    fontSize: TYPOGRAPHY.fontSize.sm + 1,
    fontWeight: TYPOGRAPHY.fontWeight.semibold,
    color: COLORS.text.primary,
    marginBottom: SPACING.sm
  },
  dateInput: {
    height: 48,
    backgroundColor: COLORS.background.secondary,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.base,
    paddingHorizontal: SPACING.sm + 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dateText: {
    fontSize: TYPOGRAPHY.fontSize.md,
    color: COLORS.text.primary
  },
  dateTextPlaceholder: { color: COLORS.text.disabled },

  buttonPressed: { opacity: 0.9 },
  buttonDisabled: { backgroundColor: COLORS.text.muted },
  pickerOverlay: {
    flex: 1,
    backgroundColor: COLORS.background.overlay,
    justifyContent: 'flex-end',
  },
  pickerCard: {
    backgroundColor: COLORS.white,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.lg,
    paddingHorizontal: SPACING.base,
    borderTopLeftRadius: RADIUS.lg,
    borderTopRightRadius: RADIUS.lg,
  },
  pickerActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: SPACING.md,
    marginTop: SPACING.sm,
  },
});
