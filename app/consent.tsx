import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Image,
  Dimensions,
  FlatList,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';

import { RefreshButton } from '@/components/RefreshButton';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';

const { width, height: screenHeight } = Dimensions.get('window');

const ORANGE = '#f36f21';
const ORANGE_LIGHT = '#f7b182';
const CHARCOAL = '#111827';

const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
const formatKoreanDate = (d: Date) =>
  `${d.getMonth() + 1}월 ${d.getDate()}일(${weekdays[d.getDay()]})`;

const toYMD = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;

// 동의 안내 이미지들 (프로젝트 루트: agreement_imag/00~09.jpg)
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
  const [tempId, setTempId] = useState('');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [loading, setLoading] = useState(false);
  const keyboardPadding = useKeyboardPadding();
  const [showPicker, setShowPicker] = useState(Platform.OS === 'ios');
  const [currentIndex, setCurrentIndex] = useState(0);

  // 실제 이미지 비율 (height / width)
  const [imageRatio, setImageRatio] = useState(16 / 9);

  useEffect(() => {
    const load = async () => {
      if (!residentId) return;

      const { data, error } = await supabase
        .from('fc_profiles')
        .select('temp_id, allowance_date')
        .eq('phone', residentId)
        .maybeSingle();

      if (!error && data?.temp_id) setTempId(data.temp_id);
      if (!error && data?.allowance_date)
        setSelectedDate(new Date(data.allowance_date));
    };

    load();
  }, [residentId]);

  // 첫 번째 이미지 비율 읽어서 저장
  useEffect(() => {
    if (!AGREEMENT_IMAGES[0]) return;
    const { width: iw, height: ih } = Image.resolveAssetSource(
      AGREEMENT_IMAGES[0],
    );
    if (iw && ih) setImageRatio(ih / iw);
  }, []);

  const ymd = useMemo(() => toYMD(selectedDate), [selectedDate]);

  const submit = async () => {
    if (!tempId || !ymd) {
      Alert.alert('입력 필요', '임시사번과 날짜를 입력하세요.');
      return;
    }

    setLoading(true);
    const { error, data } = await supabase
      .from('fc_profiles')
      .update({ allowance_date: ymd, status: 'allowance-consented' })
      .eq('temp_id', tempId)
      .select('id, name')
      .single();
    setLoading(false);

    if (error || !data) {
      Alert.alert('저장 실패', error?.message ?? '데이터 없음');
      return;
    }

    supabase.functions
      .invoke('fc-notify', {
        body: {
          type: 'fc_update',
          fc_id: data.id,
          message: `${data.name}님이 수당동의일을 입력했습니다.`,
        },
      })
      .catch(() => {});

    Alert.alert('저장 완료', '저장되었습니다.');
  };

  const openAllowanceSite = () => {
    Linking.openURL('https://www.sgic.co.kr').catch(() => {
      Alert.alert('연결 실패', '브라우저를 열 수 없습니다.');
    });
  };

  // ✅ 이미지 카드의 width/height 계산 (비율 유지 + 가능한 크게)
  const maxCardWidth = width - 32;         // 좌우 16px 여백
  const maxCardHeight = screenHeight * 0.55; // 화면 높이 55%까지만 사용

  let cardWidth = maxCardWidth;
  let cardHeight = cardWidth * imageRatio;

  // 세로가 너무 길어지면 높이를 기준으로 다시 맞추기
  if (cardHeight > maxCardHeight) {
    cardHeight = maxCardHeight;
    cardWidth = cardHeight / imageRatio;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: keyboardPadding + 24 },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {/* 상단: 가이드 제목 + 사이트 바로가기 */}
          <View style={styles.guideHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.guideTitle}>수당 동의 가이드라인</Text>
            <Text style={styles.guideSubtitle}>
              아래 화면 예시를 참고해 수당 동의 절차를 진행해주세요.
            </Text>
          </View>
        </View>

        {/* ✅ 버튼을 별도 줄로 내림 */}
        <Pressable style={styles.linkButton} onPress={openAllowanceSite}>
          <Text style={styles.linkButtonText}>수당 동의 사이트 바로가기</Text>
        </Pressable>


          {/* ✅ 이미지 캐러셀: 카드(흰 배경) 가운데 정렬 + 비율 유지 */}
          <View style={styles.carouselWrapper}>
            <FlatList
              data={AGREEMENT_IMAGES}
              keyExtractor={(_, i) => String(i)}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => {
                const idx = Math.round(
                  e.nativeEvent.contentOffset.x / width,
                );
                setCurrentIndex(idx);
              }}
              renderItem={({ item }) => (
                <View style={styles.imageContainer}>
                  <View
                    style={[
                      styles.imageCard,
                      { width: cardWidth, height: cardHeight },
                    ]}
                  >
                    <Image
                      source={item}
                      style={styles.carouselImage}
                      resizeMode="contain"
                    />
                  </View>
                </View>
              )}
            />
          </View>

          {/* 인디케이터 */}
          <View style={styles.indicator}>
            {AGREEMENT_IMAGES.map((_, i) => (
              <View
                key={i}
                style={[styles.dot, currentIndex === i && styles.dotActive]}
              />
            ))}
          </View>

          {/* 입력 폼 */}
          <View style={styles.card}>
            <RefreshButton />

            <Text style={styles.label}>임시사번</Text>
            <TextInput
              style={styles.input}
              placeholder="T-23001"
              value={tempId}
              onChangeText={setTempId}
            />

            <Text style={styles.label}>수당동의일</Text>
            <Pressable
              style={styles.input}
              onPress={() => setShowPicker(true)}
            >
              <Text style={styles.dateText}>
                {formatKoreanDate(selectedDate)}
              </Text>
            </Pressable>

            {showPicker && (
              <DateTimePicker
                value={selectedDate}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'calendar'}
                locale="ko-KR"
                onChange={(event, d) => {
                  if (Platform.OS !== 'ios') setShowPicker(false);
                  if (d) setSelectedDate(d);
                }}
                style={{ width: '100%' }}
              />
            )}

            <Button
              title={loading ? '저장 중' : '저장'}
              disabled={loading}
              onPress={submit}
              color={ORANGE}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFF5EE' },

  scrollContent: {
    paddingBottom: 24,
  },

  guideHeader: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  guideTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: CHARCOAL,
  },
  guideSubtitle: {
    marginTop: 4,
    fontSize: 15,
    color: '#6b7280',
  },
  linkButton: {
    width: 161,
    marginLeft: 20,
    textAlign: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: ORANGE,
  },
  linkButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ffffff',
  },

  // 캐러셀 전체 래퍼
  carouselWrapper: {
    marginTop: 8,
  },

  // 각 페이지 컨테이너: 전체 폭 사용 + 가운데 정렬
  imageContainer: {
    width,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // 흰색 카드: 여기 width/height를 계산해서 넘겨줌
  imageCard: {
    borderRadius: 18,
    backgroundColor: '#ffffff',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // 이미지 자체는 카드 안을 꽉 채우되 비율 유지
  carouselImage: {
    width: '100%',
    height: '100%',
  },

  indicator: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 12,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginHorizontal: 4,
    backgroundColor: '#d1d5db',
  },
  dotActive: {
    width: 22,
    height: 8,
    borderRadius: 6,
    backgroundColor: ORANGE_LIGHT,
  },

  card: {
    marginHorizontal: 20,
    marginTop: 4,
    backgroundColor: 'white',
    padding: 20,
    borderRadius: 16,
    gap: 14,
    borderWidth: 1,
    borderColor: ORANGE_LIGHT,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },

  label: { fontWeight: '800', fontSize: 16, color: CHARCOAL },

  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 52,
    justifyContent: 'center',
    backgroundColor: '#fff',
    marginBottom: 12,
  },

  dateText: { fontWeight: '800', fontSize: 16, color: CHARCOAL },
});
