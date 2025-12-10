import { Feather } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
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
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RefreshButton } from '@/components/RefreshButton';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useSession } from '@/hooks/use-session';
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

const APPOINTMENT_IMAGES = [
  require('../appointment_img/그림2.jpg'),
  require('../appointment_img/그림3.jpg'),
  require('../appointment_img/그림4.jpg'),
  require('../appointment_img/그림5.jpg'),
  require('../appointment_img/그림6.jpg'),
  require('../appointment_img/그림7.jpg'),
  require('../appointment_img/그림8.jpg'),
  require('../appointment_img/그림9.jpg'),
  require('../appointment_img/그림10.jpg'),
  require('../appointment_img/그림11.jpg'),
  require('../appointment_img/그림12.jpg'),
  require('../appointment_img/그림13.jpg'),
  require('../appointment_img/그림14.jpg'),
  require('../appointment_img/그림15.jpg'),
  require('../appointment_img/그림16.jpg'),
  require('../appointment_img/그림17.jpg'),
  require('../appointment_img/그림18.jpg'),
  require('../appointment_img/그림19.jpg'),
  require('../appointment_img/그림20.jpg'),
  require('../appointment_img/그림21.jpg'),
  require('../appointment_img/그림22.jpg'),
  require('../appointment_img/그림23.jpg'),
  require('../appointment_img/그림24.jpg'),
  require('../appointment_img/그림25.jpg'),
];

export default function AppointmentScreen() {
  const { role, residentId } = useSession();
  const keyboardPadding = useKeyboardPadding();
  const [scheduleLife, setScheduleLife] = useState<string | null>(null);
  const [scheduleNonLife, setScheduleNonLife] = useState<string | null>(null);
  const [dateLife, setDateLife] = useState<Date | null>(null);
  const [dateNonLife, setDateNonLife] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingLife, setSavingLife] = useState(false);
  const [savingNonLife, setSavingNonLife] = useState(false);
  const [savedLife, setSavedLife] = useState(false);
  const [savedNonLife, setSavedNonLife] = useState(false);
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
        'appointment_schedule_life,appointment_schedule_nonlife,appointment_date_life,appointment_date_nonlife',
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
    setDateLife(data?.appointment_date_life ? new Date(data.appointment_date_life) : null);
    setDateNonLife(data?.appointment_date_nonlife ? new Date(data.appointment_date_nonlife) : null);
    setSavedLife(Boolean(data?.appointment_date_life));
    setSavedNonLife(Boolean(data?.appointment_date_nonlife));
  }, [residentId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (APPOINTMENT_IMAGES[0]) {
      const { width: iw, height: ih } = Image.resolveAssetSource(APPOINTMENT_IMAGES[0]);
      if (iw && ih) setImageRatio(ih / iw);
    }
  }, []);
  const frameWidth = width - 128;

  const submitDate = async (type: 'life' | 'nonlife') => {
    if (!residentId) return;
    const targetDate = type === 'life' ? dateLife : dateNonLife;
    if (!targetDate) {
      Alert.alert('날짜 선택', '완료일을 선택해주세요.');
      return;
    }
    const setSaving = type === 'life' ? setSavingLife : setSavingNonLife;
    const setSaved = type === 'life' ? setSavedLife : setSavedNonLife;
    setSaving(true);
    setSaved(false);
    const ymd = toYMD(targetDate);
    // FC는 날짜를 입력하지만 최종 승인은 총무가 진행: 상태만 업데이트하고 날짜는 알림으로 전달
    // appointment_date_life/nonlife 컬럼은 총무 승인 시에만 기록됨
    const payload = { status: 'appointment-completed' };

    const { data, error } = await supabase
      .from('fc_profiles')
      .update(payload)
      .eq('phone', residentId)
      .select('id,name')
      .maybeSingle();
    setSaving(false);

    if (error || !data) {
      Alert.alert('저장 실패', error?.message ?? '정보를 저장하지 못했습니다.');
      return;
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
      `${type === 'life' ? '생명보험' : '손해보험'} 위촉 완료일이 저장되었습니다.\n총무 승인 후 최종 반영됩니다.`,
    );
    // 최신 상태 반영
    await load();
    setSaved(true);
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
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
          <Text style={styles.infoText}>FC 계정으로 로그인하면 이용할 수 있습니다.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
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

            {scheduleLife && (
              <View style={styles.card}>
                <View style={styles.badgeRow}>
                  <View style={[styles.badge, styles.badgeLife]}>
                    <Text style={[styles.badgeText, styles.badgeTextLife]}>생명보험</Text>
                  </View>
                  <Text style={styles.sectionTitle}>{scheduleLife}월 위촉 진행</Text>
                </View>
                <Text style={styles.sectionDesc}>
                  현재 {scheduleLife}월 생명보험 위촉이 진행 중입니다. 완료되면 완료일을 입력해주세요.
                </Text>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>완료 날짜</Text>
                  {Platform.OS === 'ios' ? (
                    <DateTimePicker
                      value={dateLife ?? new Date()}
                      mode="date"
                      display="default"
                      locale="ko-KR"
                      onChange={(_, d) => d && setDateLife(d)}
                      style={{ alignSelf: 'flex-start' }}
                    />
                  ) : (
                    <Pressable style={styles.dateInput} onPress={() => setShowPickerLife(true)}>
                      <Text style={styles.dateText}>
                        {dateLife ? formatKoreanDate(dateLife) : '날짜를 선택하세요'}
                      </Text>
                      <Feather name="calendar" size={18} color={MUTED} />
                    </Pressable>
                  )}
                  {showPickerLife && Platform.OS === 'android' && (
                    <DateTimePicker
                      value={dateLife ?? new Date()}
                      mode="date"
                      onChange={(_, d) => {
                        setShowPickerLife(false);
                        if (d) setDateLife(d);
                      }}
                    />
                  )}
                </View>

                <Pressable
                  style={[styles.submitButton, (!dateLife || savingLife) && styles.buttonDisabled]}
                  onPress={() => submitDate('life')}
                  disabled={!dateLife || savingLife}
                >
                  <Text style={styles.submitButtonText}>
                    {savingLife ? '저장 중...' : savedLife ? '저장됨' : '완료 저장하기'}
                  </Text>
                </Pressable>
              </View>
            )}

            {scheduleNonLife && (
              <View style={styles.card}>
                <View style={styles.badgeRow}>
                  <View style={[styles.badge, styles.badgeNonLife]}>
                    <Text style={[styles.badgeText, styles.badgeTextNonLife]}>손해보험</Text>
                  </View>
                  <Text style={styles.sectionTitle}>{scheduleNonLife}월 위촉 진행</Text>
                </View>
                <Text style={styles.sectionDesc}>
                  현재 {scheduleNonLife}월 손해보험 위촉이 진행 중입니다. 완료되면 완료일을 입력해주세요.
                </Text>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>완료 날짜</Text>
                  {Platform.OS === 'ios' ? (
                    <DateTimePicker
                      value={dateNonLife ?? new Date()}
                      mode='date'
                      display='default'
                      locale='ko-KR'
                      onChange={(_, d) => d && setDateNonLife(d)}
                      style={{ alignSelf: 'flex-start' }}
                    />
                  ) : (
                    <Pressable style={styles.dateInput} onPress={() => setShowPickerNonLife(true)}>
                      <Text style={styles.dateText}>
                        {dateNonLife ? formatKoreanDate(dateNonLife) : '날짜를 선택하세요'}
                      </Text>
                      <Feather name="calendar" size={18} color={MUTED} />
                    </Pressable>
                  )}
                  {showPickerNonLife && Platform.OS === 'android' && (
                    <DateTimePicker
                      value={dateNonLife ?? new Date()}
                      mode="date"
                      onChange={(_, d) => {
                        setShowPickerNonLife(false);
                        if (d) setDateNonLife(d);
                      }}
                    />
                  )}
                </View>

                <Pressable
                  style={[styles.submitButton, (!dateNonLife || savingNonLife) && styles.buttonDisabled]}
                  onPress={() => submitDate('nonlife')}
                  disabled={!dateNonLife || savingNonLife}
                >
                  <Text style={styles.submitButtonText}>
                    {savingNonLife ? '저장 중...' : savedNonLife ? '저장됨' : '완료 저장하기'}
                  </Text>
                </Pressable>
              </View>
            )}

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
                        <View style={[styles.imageFrame, { width: frameWidth, height: frameHeight }]}>
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
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  title: { fontSize: 22, fontWeight: '800', color: CHARCOAL },
  subtitle: { fontSize: 14, color: MUTED, marginTop: 4 },
  container: { paddingHorizontal: 24, paddingTop: 0, paddingBottom: 24, gap: 20 },
  card: {
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
  sectionDesc: { fontSize: 14, color: MUTED },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  badgeLife: { backgroundColor: '#fff7ed' },
  badgeNonLife: { backgroundColor: '#eff6ff' },
  badgeText: { fontSize: 12, fontWeight: '700' },
  badgeTextLife: { color: HANWHA_ORANGE },
  badgeTextNonLife: { color: '#2563eb' },
  inputGroup: { gap: 8 },
  label: { fontSize: 14, fontWeight: '600', color: CHARCOAL },
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
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  submitButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  buttonDisabled: { opacity: 0.5 },
  infoText: { color: MUTED, fontSize: 14 },
  imageFrame: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  guideImage: { width: '100%', height: '100%' },
  pagination: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#e5e7eb',
  },
  dotActive: { backgroundColor: HANWHA_ORANGE },
});
