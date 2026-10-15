import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { QueryReadState } from '@/components/QueryReadState';
import {
  FC_HOME_MOTION,
  formatDday,
  formatHomeMonthDay,
  getKstDaysUntil,
  pickHomeExamRounds,
  type HomeExamRound,
} from '@/lib/fc-home-sections';
import { supabase } from '@/lib/supabase';

const EASE = Easing.bezier(0.2, 0.8, 0.2, 1);
const GAP = 10;
const TYPE_TITLE = { life: '생명 · 제3보험', nonlife: '손해 · 제3보험' } as const;
// Each exam type keeps one picture and tint so the two cards read apart at a glance.
const TYPE_LOOK = {
  life: { image: require('@/assets/images/fc-home/life.png'), tint: '#fff1f1', chip: '#fde2e2', ink: '#b4323f', short: '생명' },
  nonlife: { image: require('@/assets/images/fc-home/nonlife.png'), tint: '#eef4fd', chip: '#dbe8fb', ink: '#2f5f9e', short: '손해' },
} as const;
const TYPE_ROUTE = { life: '/exam-apply', nonlife: '/exam-apply2' } as const;

const todayKst = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

async function fetchHomeExamRounds(): Promise<HomeExamRound[]> {
  const { data, error } = await supabase
    .from('exam_rounds')
    .select('exam_type, exam_date, registration_deadline, round_label')
    .gte('registration_deadline', todayKst())
    .order('registration_deadline', { ascending: true })
    .limit(20);
  if (error) throw error;
  return (data ?? [])
    .filter((row: any) => (row.exam_type === 'life' || row.exam_type === 'nonlife') && row.registration_deadline)
    .map((row: any) => ({
      examType: row.exam_type,
      examDate: row.exam_date ?? null,
      registrationDeadline: row.registration_deadline,
      roundLabel: row.round_label ?? null,
    }));
}

type Props = {
  sessionScope: number | string;
  onOpen: (href: string) => void;
};

export function FcHomeExamRounds({ sessionScope, onOpen }: Props) {
  const { width } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const cardWidth = Math.min(300, width - 32 - 40 - 48);
  const step = cardWidth + GAP;
  const [index, setIndex] = useState(0);
  const translateX = useSharedValue(0);
  const start = useSharedValue(0);
  const query = useQuery({ queryKey: ['home-exam-rounds', sessionScope], queryFn: fetchHomeExamRounds });
  const cards = pickHomeExamRounds(query.data ?? []);
  const maxIndex = cards.length - 1;

  // The track follows the finger; release settles by distance or flick speed, and a cancel settles back.
  const pan = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-8, 8])
    .onBegin(() => {
      start.value = translateX.value;
    })
    .onUpdate((event) => {
      const next = start.value + event.translationX;
      const min = -maxIndex * step;
      translateX.value = next > 0 ? next * 0.3 : next < min ? min + (next - min) * 0.3 : next;
    })
    .onEnd((event) => {
      const current = Math.round(-start.value / step);
      let target = current;
      if (event.translationX < -70 || event.velocityX < -450) target = Math.min(maxIndex, current + 1);
      else if (event.translationX > 70 || event.velocityX > 450) target = Math.max(0, current - 1);
      translateX.value = withTiming(-target * step, { duration: reduceMotion ? 0 : FC_HOME_MOTION.cardSettle, easing: EASE });
      runOnJS(setIndex)(target);
    })
    .onFinalize((_event, success) => {
      if (success) return;
      translateX.value = withTiming(-Math.round(-start.value / step) * step, { duration: reduceMotion ? 0 : FC_HOME_MOTION.cardSettle, easing: EASE });
    });
  const trackStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.sectionTitle}>
          <Image source={require('@/assets/images/fc-home/section-exam.png')} style={styles.sectionIcon} accessibilityIgnoresInvertColors />
          <Text style={styles.title}>시험 접수</Text>
        </View>
        <Pressable onPress={() => onOpen('/exam-apply')} hitSlop={8} accessibilityRole="button" accessibilityLabel="시험 일정 전체 보기">
          <Text style={styles.link}>일정 전체</Text>
        </Pressable>
      </View>
      {query.isError ? (
        <View style={styles.inset}>
          <QueryReadState error={query.error} message="시험 일정을 불러오지 못했습니다." onRetry={() => void query.refetch()} retrying={query.isFetching} />
        </View>
      ) : (
        <>
          <GestureDetector gesture={pan}>
            <View style={styles.viewport}>
              <Animated.View style={[styles.track, trackStyle]}>
                {cards.map(({ examType, round }) => {
                  const days = round ? getKstDaysUntil(round.registrationDeadline) : null;
                  return (
                    <View key={examType} style={[styles.examCard, { width: cardWidth, backgroundColor: TYPE_LOOK[examType].tint }]}>
                      <View style={styles.examTop}>
                        <View style={styles.examTopCopy}>
                          <View style={styles.examTypeRow}>
                            <Image source={TYPE_LOOK[examType].image} style={styles.examTypeImage} accessibilityIgnoresInvertColors />
                            <Text style={[styles.examTypeChip, { backgroundColor: TYPE_LOOK[examType].chip, color: TYPE_LOOK[examType].ink }]}>
                              {TYPE_LOOK[examType].short}
                            </Text>
                            <Text style={[styles.examState, round ? styles.examStateOpen : styles.examStateClosed]}>{round ? '접수 중' : '접수 전'}</Text>
                          </View>
                          <Text style={styles.examTitle}>{TYPE_TITLE[examType]}</Text>
                        </View>
                        <View style={styles.examDday}>
                          <Text style={styles.examDdayCaption}>{round ? '마감까지' : '다음 회차'}</Text>
                          <Text style={[styles.examDdayValue, !round && styles.examDdayValueClosed]}>
                            {round ? formatDday(days) : '미정'}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.examBottom}>
                        <Text style={styles.examMeta} numberOfLines={2}>
                          {round
                            ? `시험일 ${formatHomeMonthDay(round.examDate) ?? '미정'} · 마감 ${formatHomeMonthDay(round.registrationDeadline) ?? '미정'}`
                            : query.isLoading ? '일정 확인 중' : '등록된 회차 없음'}
                        </Text>
                        <Pressable
                          onPress={() => onOpen(TYPE_ROUTE[examType])}
                          accessibilityRole="button"
                          accessibilityLabel={`${TYPE_TITLE[examType]} ${round ? '시험 신청' : '시험 일정 보기'}`}
                          style={({ pressed }) => [round ? styles.applyButton : styles.scheduleButton, pressed && styles.buttonPressed]}
                        >
                          <Text style={round ? styles.applyText : styles.scheduleText}>{round ? '신청' : '일정'}</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </Animated.View>
            </View>
          </GestureDetector>
          <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {cards.map(({ examType }, dotIndex) => (
              <View key={examType} style={[styles.dot, dotIndex === index && styles.dotActive]} />
            ))}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginBottom: 12, paddingVertical: 18, backgroundColor: '#ffffff', borderRadius: 24 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 12 },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionIcon: { width: 28, height: 28 },
  title: { fontSize: 18, fontWeight: '800', color: '#111827' },
  link: { fontSize: 14, fontWeight: '500', color: '#4b5563' },
  inset: { paddingHorizontal: 20 },
  viewport: { overflow: 'hidden', paddingHorizontal: 20 },
  track: { flexDirection: 'row', gap: GAP },
  examCard: { borderRadius: 20, padding: 18, gap: 16 },
  examTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  examTopCopy: { gap: 8, flexShrink: 1 },
  examTypeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  examTypeImage: { width: 40, height: 40, marginLeft: -4 },
  examTypeChip: { fontSize: 12, fontWeight: '800', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, overflow: 'hidden' },
  examState: { fontSize: 12, fontWeight: '700', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, overflow: 'hidden' },
  examStateOpen: { color: '#ffffff', backgroundColor: '#c65312' },
  examStateClosed: { color: '#4b5563', backgroundColor: '#ffffff' },
  examTitle: { fontSize: 17, fontWeight: '800', color: '#111827' },
  examDday: { alignItems: 'flex-end' },
  examDdayCaption: { fontSize: 12, fontWeight: '500', color: '#4b5563' },
  examDdayValue: { fontSize: 28, lineHeight: 34, fontWeight: '800', color: '#a8460f', letterSpacing: -1, fontVariant: ['tabular-nums'] },
  examDdayValueClosed: { fontSize: 22, color: '#4b5563', letterSpacing: 0 },
  examBottom: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  examMeta: { flex: 1, fontSize: 13, color: '#4b5563' },
  applyButton: { height: 40, paddingHorizontal: 18, borderRadius: 12, backgroundColor: '#c65312', justifyContent: 'center' },
  applyText: { fontSize: 14, fontWeight: '700', color: '#ffffff' },
  scheduleButton: { height: 40, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: '#d1d5db', backgroundColor: '#ffffff', justifyContent: 'center' },
  scheduleText: { fontSize: 14, fontWeight: '700', color: '#374151' },
  buttonPressed: { opacity: 0.8, transform: [{ scale: 0.97 }] },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingTop: 14 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#d1d5db' },
  dotActive: { width: 18, backgroundColor: '#374151' },
});
