import DateTimePicker from '@react-native-community/datetimepicker';
import { Feather } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Image,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Dimensions } from 'react-native';

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
  const [appointmentUrl, setAppointmentUrl] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showPicker, setShowPicker] = useState(Platform.OS === 'ios');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [imageRatio, setImageRatio] = useState(16 / 9);

  const load = useCallback(async () => {
    if (!residentId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('fc_profiles')
      .select('appointment_url,appointment_date')
      .eq('phone', residentId)
      .maybeSingle();
    setLoading(false);
    if (error) {
      Alert.alert('불러오기 실패', error.message ?? '정보를 불러오지 못했습니다.');
      return;
    }
    setAppointmentUrl(data?.appointment_url ?? null);
    if (data?.appointment_date) {
      setSelectedDate(new Date(data.appointment_date));
    }
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

  const formattedDate = useMemo(() => formatKoreanDate(selectedDate), [selectedDate]);
  // 카드 영역(좌우 패딩 제외) 기준 너비/높이 계산 (좌우 패딩 24*2)
  const frameWidth = width - 128;

  const handleOpenUrl = () => {
    if (!appointmentUrl) {
      Alert.alert('대기 중', '총무가 위촉 URL을 발송하면 안내 드릴게요.');
      return;
    }
    Linking.openURL(appointmentUrl).catch(() =>
      Alert.alert('오류', 'URL을 열 수 없습니다. 주소를 다시 확인해주세요.'),
    );
  };

  const submit = async () => {
    if (!residentId) return;
    if (!appointmentUrl) {
      Alert.alert('대기 중', '위촉 URL 발송 후 완료일을 입력할 수 있습니다.');
      return;
    }
    setSaving(true);
    const ymd = toYMD(selectedDate);
    const { data, error } = await supabase
      .from('fc_profiles')
      .update({ appointment_date: ymd, status: 'final-link-sent' })
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
        body: { type: 'fc_update', fc_id: data.id, message: `${data.name}님이 위촉 절차를 완료했습니다.` },
      })
      .catch(() => {});

    Alert.alert('저장 완료', '위촉 완료일이 저장되었습니다.');
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
            <Text style={styles.subtitle}>총무가 발송한 URL로 접속 후 완료일을 입력해주세요.</Text>
          </View>
          <RefreshButton onPress={load} />
        </View>

        {loading ? (
          <ActivityIndicator color={HANWHA_ORANGE} style={{ marginTop: 40 }} />
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>위촉 URL</Text>
              <Text style={styles.sectionDesc}>아래 버튼을 눌러 위촉 절차를 진행하세요.</Text>
              <Pressable
                style={[styles.primaryButton, !appointmentUrl && styles.buttonDisabled]}
                onPress={handleOpenUrl}
                disabled={!appointmentUrl}
              >
                <Text style={styles.primaryButtonText}>
                  {appointmentUrl ? '위촉 페이지 열기' : 'URL 발송 대기 중'}
                </Text>
                <Feather name="external-link" size={18} color="#fff" />
              </Pressable>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>위촉 진행 가이드</Text>
              <Text style={styles.sectionDesc}>아래 화면을 따라 위촉 절차를 완료해주세요.</Text>
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
                  // 이미지가 실제로 차지할 너비(좌우 패딩 24*2를 뺀 값)
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

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>위촉 완료일</Text>
              <Text style={styles.sectionDesc}>모든 절차가 끝난 날짜를 선택하고 저장해주세요.</Text>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>완료 날짜</Text>
                {Platform.OS === 'ios' ? (
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
                    <Text style={styles.dateText}>{formattedDate}</Text>
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
                style={[
                  styles.submitButton,
                  (saving || !appointmentUrl) && styles.buttonDisabled,
                ]}
                onPress={submit}
                disabled={saving || !appointmentUrl}
              >
                <Text style={styles.submitButtonText}>{saving ? '저장 중...' : '완료 저장하기'}</Text>
              </Pressable>
            </View>
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
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: HANWHA_ORANGE,
    paddingVertical: 14,
    borderRadius: 10,
  },
  primaryButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
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
