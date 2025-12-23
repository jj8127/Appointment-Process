import { Feather } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RefreshButton } from '@/components/RefreshButton';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useSession } from '@/hooks/use-session';
import { useIdentityGate } from '@/hooks/use-identity-gate';
import { supabase } from '@/lib/supabase';

const HANWHA_ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const MUTED = '#6b7280';
const BORDER = '#E5E7EB';
const INPUT_BG = '#F9FAFB';
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
  const [showPickerLife, setShowPickerLife] = useState(Platform.OS === 'ios');
  const [showPickerNonLife, setShowPickerNonLife] = useState(Platform.OS === 'ios');
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
      type === 'life' ? setShowPickerLife(false) : setShowPickerNonLife(false);
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

      supabase.functions
        .invoke('fc-notify', {
          body: {
            type: 'fc_update',
            fc_id: data.id,
            message: `${data.name}님이 ${type === 'life' ? '생명보험' : '손해보험'} 위촉 완료를 보고했습니다. (입력일: ${ymd})`,
          },
        })
        .catch(() => { });

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
    const setShowPicker = isLife ? setShowPickerLife : setShowPickerNonLife;

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
                <Feather name="calendar" size={18} color={MUTED} />
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
          ) : Platform.OS === 'ios' ? (
            <DateTimePicker
              value={displayDate ?? new Date()}
              mode="date"
              display="default"
              locale="ko-KR"
              onChange={(e, d) => !isLocked && handleDateChange(type, e, d)}
              style={{ alignSelf: 'flex-start', opacity: isLocked ? 0.6 : 1 }}
              disabled={isLocked}
            />
          ) : (
            <Pressable
              style={[styles.dateInput, isLocked && styles.disabledInput]}
              onPress={() => !isLocked && setShowPicker(true)}
            >
              <Text style={[styles.dateText, !displayDate && styles.placeholderText]}>
                {displayDate ? formatKoreanDate(displayDate) : '날짜를 선택하세요'}
              </Text>
              <Feather name="calendar" size={18} color={MUTED} />
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

        <Pressable
          style={[styles.submitButton, (isLocked || !displayDate || saving) && styles.buttonDisabled]}
          onPress={() => submitDate(type)}
          disabled={isLocked || !displayDate || saving}
        >
          <Text style={styles.submitButtonText}>
            {saving ? '저장 중...' : isApproved ? '승인 완료' : isPending ? '승인 대기 중' : '완료 보고하기'}
          </Text>
        </Pressable>
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
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>모바일 위촉 진행</Text>
            <Text style={styles.subtitle}>총무가 배정한 월 기준으로 진행 상황을 입력해주세요.</Text>
          </View>
          <RefreshButton onPress={load} />
        </View>

        {loading ? (
          <ActivityIndicator color={HANWHA_ORANGE} style={{ marginTop: 40 }} />
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  header: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  title: { fontSize: 22, fontWeight: '800', color: CHARCOAL },
  subtitle: { fontSize: 14, color: MUTED, marginTop: 4, width: '90%' },
  container: { paddingHorizontal: 0, paddingTop: 24, paddingBottom: 24, gap: 20 },
  card: {
    marginHorizontal: 24,
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 20,
    gap: 16,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: CHARCOAL },
  sectionDesc: { fontSize: 14, color: MUTED, lineHeight: 20 },
  rejectBox: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderWidth: 1,
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
  },
  rejectTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#B91C1C',
    marginBottom: 6,
  },
  rejectText: {
    fontSize: 12,
    color: '#7F1D1D',
    lineHeight: 18,
  },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  badgeLife: { backgroundColor: '#fff7ed' },
  badgeNonLife: { backgroundColor: '#eff6ff' },
  badgeText: { fontSize: 12, fontWeight: '700' },
  badgeTextLife: { color: HANWHA_ORANGE },
  badgeTextNonLife: { color: '#2563eb' },
  inputGroup: { gap: 8, marginTop: 4 },
  label: { fontSize: 14, fontWeight: '600', color: CHARCOAL },
  webDateWrapper: { position: 'relative', width: '100%' },
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
  disabledInput: { backgroundColor: '#F3F4F6', opacity: 0.7 },
  dateText: { fontSize: 16, color: CHARCOAL },
  placeholderText: { color: '#9CA3AF' },
  submitButton: {
    height: 52,
    backgroundColor: CHARCOAL,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  submitButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  buttonDisabled: { opacity: 0.5, backgroundColor: '#9CA3AF' },
  infoText: { color: MUTED, fontSize: 14 },
  imageFrame: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  guideImage: { width: '100%', height: '100%' },
  pagination: { flexDirection: 'row', justifyContent: 'center', gap: 6, flexWrap: 'wrap', marginTop: 10 },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#e5e7eb',
  },
  dotActive: { backgroundColor: HANWHA_ORANGE, width: 20 },
});
