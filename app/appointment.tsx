import { Feather } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Dimensions,
    FlatList,
    Image,
    Modal,
    Platform,
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useIdentityGate } from '@/hooks/use-identity-gate';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';
import { COLORS, TYPOGRAPHY, SPACING, RADIUS, SHADOWS } from '@/lib/theme';
const { width } = Dimensions.get('window');

const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
const formatKoreanDate = (d: Date) =>
  `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${weekdays[d.getDay()]})`;

const toYMD = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const formatShortKoreanDate = (d: Date) => d.toLocaleDateString('ko-KR');

const APPOINTMENT_IMAGES = [
  require('../appointment_img/img2.jpg'),
  require('../appointment_img/img3.jpg'),
  require('../appointment_img/img4.jpg'),
  require('../appointment_img/img5.jpg'),
  require('../appointment_img/img6.jpg'),
  require('../appointment_img/img7.jpg'),
  require('../appointment_img/img8.jpg'),
  require('../appointment_img/img9.jpg'),
  require('../appointment_img/img10.jpg'),
  require('../appointment_img/img11.jpg'),
  require('../appointment_img/img12.jpg'),
  require('../appointment_img/img13.jpg'),
  require('../appointment_img/img14.jpg'),
  require('../appointment_img/img15.jpg'),
  require('../appointment_img/img16.jpg'),
  require('../appointment_img/img17.jpg'),
  require('../appointment_img/img18.jpg'),
  require('../appointment_img/img19.jpg'),
  require('../appointment_img/img20.jpg'),
  require('../appointment_img/img21.jpg'),
  require('../appointment_img/img22.jpg'),
  require('../appointment_img/img23.jpg'),
  require('../appointment_img/img24.jpg'),
  require('../appointment_img/img25.jpg'),
];

export default function AppointmentScreen() {
  const { role, residentId } = useSession();
  useIdentityGate({ nextPath: '/appointment' });
  const keyboardPadding = useKeyboardPadding();

  // 예정 월
  const [scheduleLife, setScheduleLife] = useState<string | null>(null);
  const [scheduleNonLife, setScheduleNonLife] = useState<string | null>(null);

  // 관리자 승인 날짜
  const [approvedLife, setApprovedLife] = useState<Date | null>(null);
  const [approvedNonLife, setApprovedNonLife] = useState<Date | null>(null);

  // FC 제출 날짜
  const [submittedLife, setSubmittedLife] = useState<Date | null>(null);
  const [submittedNonLife, setSubmittedNonLife] = useState<Date | null>(null);
  const [rejectReasonLife, setRejectReasonLife] = useState<string | null>(null);
  const [rejectReasonNonLife, setRejectReasonNonLife] = useState<string | null>(null);

  // 화면 입력 값
  const [displayLife, setDisplayLife] = useState<Date | null>(null);
  const [displayNonLife, setDisplayNonLife] = useState<Date | null>(null);

  const [loading, setLoading] = useState(false);
  const [savingLife, setSavingLife] = useState(false);
  const [savingNonLife, setSavingNonLife] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showPickerLife, setShowPickerLife] = useState(false);
  const [showPickerNonLife, setShowPickerNonLife] = useState(false);
  const [tempLife, setTempLife] = useState<Date | null>(null);
  const [tempNonLife, setTempNonLife] = useState<Date | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [imageRatio, setImageRatio] = useState(16 / 9);

  const load = useCallback(async () => {
    if (!residentId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('fc_profiles')
      .select(
        'appointment_schedule_life,appointment_schedule_nonlife,appointment_date_life,appointment_date_nonlife,appointment_date_life_sub,appointment_date_nonlife_sub,appointment_reject_reason_life,appointment_reject_reason_nonlife',
      )
      .eq('phone', residentId)
      .maybeSingle();
    setLoading(false);
    if (error) {
      Alert.alert('불러오기 실패', error.message ?? '정보를 불러오지 못했습니다.');
      return;
    }

    setScheduleLife(data?.appointment_schedule_life ?? null);
    setScheduleNonLife(data?.appointment_schedule_nonlife ?? null);

    const appLife = data?.appointment_date_life ? new Date(data.appointment_date_life) : null;
    const appNonLife = data?.appointment_date_nonlife ? new Date(data.appointment_date_nonlife) : null;
    const subLife = data?.appointment_date_life_sub ? new Date(data.appointment_date_life_sub) : null;
    const subNonLife = data?.appointment_date_nonlife_sub ? new Date(data.appointment_date_nonlife_sub) : null;

    setApprovedLife(appLife);
    setApprovedNonLife(appNonLife);
    setSubmittedLife(subLife);
    setSubmittedNonLife(subNonLife);
    setRejectReasonLife(data?.appointment_reject_reason_life ?? null);
    setRejectReasonNonLife(data?.appointment_reject_reason_nonlife ?? null);

    // 표시값: 승인>제출>없음
    setDisplayLife(appLife || subLife || null);
    setDisplayNonLife(appNonLife || subNonLife || null);
  }, [residentId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (APPOINTMENT_IMAGES[0]) {
      // Web safety check
      if (typeof Image.resolveAssetSource === 'function') {
        const src = Image.resolveAssetSource(APPOINTMENT_IMAGES[0]);
        if (src?.width && src?.height) setImageRatio(src.height / src.width);
      }
    }
  }, []);

  const frameWidth = width - 80;

  const handleDateChange = (type: 'life' | 'nonlife', event: DateTimePickerEvent, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      if (type === 'life') {
        setShowPickerLife(false);
      } else {
        setShowPickerNonLife(false);
      }
    }
    if (event.type !== 'set' || !selectedDate) return;
    (type === 'life' ? setDisplayLife : setDisplayNonLife)(selectedDate);
  };

  const submitDate = async (type: 'life' | 'nonlife') => {
    if (!residentId) return;
    const targetDate = type === 'life' ? displayLife : displayNonLife;
    if (!targetDate) {
      Alert.alert('날짜 선택', '완료일을 선택해주세요.');
      return;
    }
    const setSaving = type === 'life' ? setSavingLife : setSavingNonLife;
    setSaving(true);
    const ymd = toYMD(targetDate);
    const dateField = type === 'life' ? 'appointment_date_life_sub' : 'appointment_date_nonlife_sub';

    try {
      const { data, error } = await supabase
        .from('fc_profiles')
        .update({
          [dateField]: ymd,
          [type === 'life' ? 'appointment_reject_reason_life' : 'appointment_reject_reason_nonlife']: null,
        })
        .eq('phone', residentId)
        .select('id,name')
        .maybeSingle();

      if (error || !data) {
        throw error ?? new Error('정보를 저장하지 못했습니다.');
      }

      await supabase.functions
        .invoke('fc-notify', {
          body: {
            type: 'fc_update',
            fc_id: data.id,
            message: `${data.name}님이 ${type === 'life' ? '생명보험' : '손해보험'} 위촉 완료를 보고했습니다. (입력일: ${ymd})`,
            url: '/dashboard',
          },
        })
        .catch(() => undefined);

      Alert.alert(
        '제출 완료',
        `${type === 'life' ? '생명보험' : '손해보험'} 위촉 완료일이 제출되었습니다.\n총무 승인 후 최종 반영됩니다.`,
      );
      await load();
    } catch (err: any) {
      Alert.alert('저장 실패', err?.message ?? '정보를 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  if (role !== 'fc') {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
        <View style={[styles.container, { alignItems: 'center', justifyContent: 'center', flex: 1 }]}>
          <Text style={styles.infoText}>FC 계정으로 로그인하면 이용할 수 있습니다.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const renderCard = (type: 'life' | 'nonlife', scheduleMonth: string) => {
    const isLife = type === 'life';
    const approvedDate = isLife ? approvedLife : approvedNonLife;
    const submittedDate = isLife ? submittedLife : submittedNonLife;
    const displayDate = isLife ? displayLife : displayNonLife;
    const rejectReason = isLife ? rejectReasonLife : rejectReasonNonLife;
    const saving = isLife ? savingLife : savingNonLife;
    const showPicker = isLife ? showPickerLife : showPickerNonLife;

    const isApproved = !!approvedDate;
    const isPending = !isApproved && !!submittedDate;
    const isLocked = isApproved || isPending;

    return (
      <View style={styles.card}>
        <View style={styles.badgeRow}>
          <View style={[styles.badge, isLife ? styles.badgeLife : styles.badgeNonLife]}>
            <Text style={[styles.badgeText, isLife ? styles.badgeTextLife : styles.badgeTextNonLife]}>
              {isLife ? '생명보험' : '손해보험'}
            </Text>
          </View>
          <Text style={styles.sectionTitle}>{scheduleMonth}월 위촉 진행</Text>
        </View>
        <Text style={styles.sectionDesc}>
          {isApproved
            ? '위촉이 최종 승인되었습니다.'
            : isPending
              ? '위촉 완료일을 제출했습니다. 총무 승인을 기다려주세요.'
              : `현재 ${scheduleMonth}월 위촉이 진행 중입니다. 완료되면 날짜를 입력하세요.`}
        </Text>
        {!!rejectReason && (
          <View style={styles.rejectBox}>
            <Text style={styles.rejectTitle}>반려 사유</Text>
            <Text style={styles.rejectText}>{rejectReason}</Text>
          </View>
        )}

        <View style={styles.inputGroup}>
          <Text style={styles.label}>완료 날짜</Text>
          {Platform.OS === 'web' ? (
            <View style={styles.webDateWrapper}>
              <View style={[styles.dateInput, isLocked && styles.disabledInput]}>
                <Text style={[styles.dateText, !displayDate && styles.placeholderText]}>
                  {displayDate ? formatShortKoreanDate(displayDate) : '날짜를 선택하세요'}
                </Text>
                <Feather name="calendar" size={18} color={COLORS.text.secondary} />
              </View>
              {/* @ts-ignore */}
              <input
                type="date"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  width: '100%',
                  height: '100%',
                  opacity: 0,
                  cursor: isLocked ? 'not-allowed' : 'pointer',
                }}
                value={displayDate ? toYMD(displayDate) : ''}
                disabled={isLocked}
                onChange={(e: any) => {
                  if (!isLocked) {
                    const val = e.target.valueAsDate;
                    if (val) handleDateChange(type, { type: 'set' } as any, val);
                  }
                }}
              />
            </View>
          ) : (
            <Pressable
              style={[styles.dateInput, isLocked && styles.disabledInput]}
              onPress={() => {
                if (isLocked) return;
                if (type === 'life') {
                  setTempLife(displayDate ?? new Date());
                  setShowPickerLife(true);
                } else {
                  setTempNonLife(displayDate ?? new Date());
                  setShowPickerNonLife(true);
                }
              }}
            >
              <Text style={[styles.dateText, !displayDate && styles.placeholderText]}>
                {displayDate ? formatKoreanDate(displayDate) : '날짜를 선택하세요'}
              </Text>
              <Feather name="calendar" size={18} color={COLORS.text.secondary} />
            </Pressable>
          )}
          {showPicker && Platform.OS === 'android' && (
            <DateTimePicker
              value={displayDate ?? new Date()}
              mode="date"
              onChange={(e, d) => handleDateChange(type, e, d)}
            />
          )}
        </View>

        <Button
          onPress={() => submitDate(type)}
          disabled={isLocked || !displayDate || saving}
          loading={saving}
          variant="primary"
          size="lg"
          fullWidth
          style={{ marginTop: 8 }}
        >
          {isApproved ? '승인 완료' : isPending ? '승인 대기 중' : '완료 보고하기'}
        </Button>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView
        contentContainerStyle={[styles.container, { paddingBottom: keyboardPadding + 40 }]}
        contentInsetAdjustmentBehavior="never"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <ScreenHeader
          title="위촉 진행"
          subtitle="총무가 배정한 월 기준으로 진행 상황을 입력해주세요."
          showRefresh
          onRefresh={load}
        />

        {loading ? (
          <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />
        ) : (
          <>
            {!scheduleLife && !scheduleNonLife && (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>진행 중인 위촉이 없습니다</Text>
                <Text style={styles.sectionDesc}>총무가 위촉 월을 배정하면 이곳에 표시됩니다.</Text>
              </View>
            )}

            {scheduleLife && renderCard('life', scheduleLife)}
            {scheduleNonLife && renderCard('nonlife', scheduleNonLife)}

            {(scheduleLife || scheduleNonLife) && (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>위촉 진행 가이드</Text>
                <Text style={styles.sectionDesc}>아래 화면을 참고해 위촉 절차를 완료해주세요.</Text>
                <FlatList
                  data={APPOINTMENT_IMAGES}
                  keyExtractor={(_, i) => String(i)}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  pagingEnabled={false}
                  decelerationRate="fast"
                  snapToInterval={frameWidth}
                  snapToAlignment="center"
                  disableIntervalMomentum
                  getItemLayout={(_, index) => ({
                    length: frameWidth,
                    offset: frameWidth * index,
                    index,
                  })}
                  onMomentumScrollEnd={(e) => {
                    const idx = Math.round(e.nativeEvent.contentOffset.x / frameWidth);
                    setCurrentIndex(idx);
                  }}
                  renderItem={({ item }) => {
                    const imageInnerWidth = frameWidth - 48;
                    const frameHeight = imageRatio ? imageInnerWidth * imageRatio : imageInnerWidth;
                    return (
                      <View style={{ width: frameWidth, alignItems: 'center' }}>
                        <View style={[styles.imageFrame, { width: imageInnerWidth, height: frameHeight }]}>
                          <Image source={item} style={styles.guideImage} resizeMode="contain" />
                        </View>
                      </View>
                    );
                  }}
                />
                <View style={styles.pagination}>
                  {APPOINTMENT_IMAGES.map((_, i) => (
                    <View key={i} style={[styles.dot, currentIndex === i && styles.dotActive]} />
                  ))}
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>

      {Platform.OS === 'ios' && showPickerLife && (
        <Modal visible transparent animationType="fade">
          <View style={styles.pickerOverlay}>
            <View style={styles.pickerCard}>
              <DateTimePicker
                value={tempLife ?? displayLife ?? new Date()}
                mode="date"
                display="spinner"
                locale="ko-KR"
                onChange={(_, d) => {
                  if (d) setTempLife(d);
                }}
              />
              <View style={styles.pickerActions}>
                <Pressable
                  style={[styles.pickerBtn, styles.pickerBtnGhost]}
                  onPress={() => {
                    setShowPickerLife(false);
                    setTempLife(null);
                  }}
                >
                  <Text style={styles.pickerBtnGhostText}>취소</Text>
                </Pressable>
                <Pressable
                  style={[styles.pickerBtn, styles.pickerBtnPrimary]}
                  onPress={() => {
                    if (tempLife) setDisplayLife(tempLife);
                    setShowPickerLife(false);
                    setTempLife(null);
                  }}
                >
                  <Text style={styles.pickerBtnPrimaryText}>확인</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {Platform.OS === 'ios' && showPickerNonLife && (
        <Modal visible transparent animationType="fade">
          <View style={styles.pickerOverlay}>
            <View style={styles.pickerCard}>
              <DateTimePicker
                value={tempNonLife ?? displayNonLife ?? new Date()}
                mode="date"
                display="spinner"
                locale="ko-KR"
                onChange={(_, d) => {
                  if (d) setTempNonLife(d);
                }}
              />
              <View style={styles.pickerActions}>
                <Pressable
                  style={[styles.pickerBtn, styles.pickerBtnGhost]}
                  onPress={() => {
                    setShowPickerNonLife(false);
                    setTempNonLife(null);
                  }}
                >
                  <Text style={styles.pickerBtnGhostText}>취소</Text>
                </Pressable>
                <Pressable
                  style={[styles.pickerBtn, styles.pickerBtnPrimary]}
                  onPress={() => {
                    if (tempNonLife) setDisplayNonLife(tempNonLife);
                    setShowPickerNonLife(false);
                    setTempNonLife(null);
                  }}
                >
                  <Text style={styles.pickerBtnPrimaryText}>확인</Text>
                </Pressable>
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
  container: {
    paddingHorizontal: SPACING.lg,
    paddingTop: 0,
    paddingBottom: SPACING.xl,
    gap: SPACING.lg
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    padding: SPACING.lg,
    gap: SPACING.base,
    ...SHADOWS.base,
  },
  sectionTitle: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontWeight: TYPOGRAPHY.fontWeight.extrabold,
    color: COLORS.text.primary
  },
  sectionDesc: {
    fontSize: TYPOGRAPHY.fontSize.sm + 1,
    color: COLORS.text.muted,
    lineHeight: 20
  },
  rejectBox: {
    backgroundColor: COLORS.errorLight,
    borderColor: '#FECACA',
    borderWidth: 1,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    marginBottom: SPACING.md,
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
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm + 2
  },
  badge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.base
  },
  badgeLife: { backgroundColor: '#fff7ed' },
  badgeNonLife: { backgroundColor: '#eff6ff' },
  badgeText: {
    fontSize: TYPOGRAPHY.fontSize.xs + 1,
    fontWeight: TYPOGRAPHY.fontWeight.bold
  },
  badgeTextLife: { color: COLORS.primary },
  badgeTextNonLife: { color: '#2563eb' },
  inputGroup: {
    gap: SPACING.sm,
    marginTop: SPACING.xs
  },
  label: {
    fontSize: TYPOGRAPHY.fontSize.sm + 1,
    fontWeight: TYPOGRAPHY.fontWeight.semibold,
    color: COLORS.text.primary
  },
  webDateWrapper: { position: 'relative', width: '100%' },
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
  disabledInput: {
    backgroundColor: COLORS.gray[100],
    opacity: 0.7
  },
  dateText: {
    fontSize: TYPOGRAPHY.fontSize.md,
    color: COLORS.text.primary
  },
  placeholderText: { color: COLORS.text.disabled },
  infoText: {
    color: COLORS.text.muted,
    fontSize: TYPOGRAPHY.fontSize.sm + 1
  },
  imageFrame: {
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    backgroundColor: COLORS.gray[100],
    justifyContent: 'center',
    alignItems: 'center',
  },
  guideImage: { width: '100%', height: '100%' },
  pagination: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: SPACING.xs + 2,
    flexWrap: 'wrap',
    marginTop: SPACING.sm + 2
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.gray[300],
  },
  dotActive: {
    backgroundColor: COLORS.primary,
    width: 20
  },
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
  pickerBtn: {
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.base,
    borderRadius: RADIUS.base + 2,
  },
  pickerBtnGhost: {
    backgroundColor: COLORS.gray[100],
  },
  pickerBtnPrimary: {
    backgroundColor: COLORS.gray[700],
  },
  pickerBtnGhostText: {
    color: COLORS.text.primary,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
  },
  pickerBtnPrimaryText: {
    color: COLORS.white,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
  },
});
