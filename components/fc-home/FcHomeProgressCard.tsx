import { Feather } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { Skeleton } from '@/components/LoadingSkeleton';
import { FC_HOME_MOTION, getNewlyCompletedSteps, isFcHomeNextActionWaiting } from '@/lib/fc-home-sections';
import { logger } from '@/lib/logger';
import { safeStorage } from '@/lib/safe-storage';

const ORANGE = '#c65312';
const INK = '#111827';
const MUTED = '#4b5563';
const CHECK_PATH = 'M5 12.5l4.5 4.5L19 7.5';
const CHECK_LENGTH = 24;
const AnimatedPath = Animated.createAnimatedComponent(Path);
// The same pictures as the exam cards and shortcuts mark life and non-life everywhere on the home.
const TYPE_IMAGES = {
  생명: require('@/assets/images/fc-home/life.png'),
  손해: require('@/assets/images/fc-home/nonlife.png'),
} as const;
const EASE = Easing.bezier(0.2, 0.8, 0.2, 1);

type Step = { key: string; label: string };

type Props = {
  steps: Step[];
  /** 1-based step in progress; steps before it are done. */
  currentStep: number;
  loading: boolean;
  storageScope: string | null;
  hasTempId: boolean;
  tempIdLabel: string;
  nextTitle: string;
  nextSubtitle: string;
  onPressNext: () => void;
  lifeCompleted: boolean;
  nonLifeCompleted: boolean;
  licenseLabels: string[];
};

function DoneCircle({ animate }: { animate: boolean }) {
  const reduceMotion = useReducedMotion();
  const play = animate && !reduceMotion;
  const draw = useSharedValue(play ? 0 : 1);
  const scale = useSharedValue(play ? 0.6 : 1);

  useEffect(() => {
    if (!play) return;
    scale.value = withSequence(
      withTiming(1.08, { duration: FC_HOME_MOTION.donePop * 0.7, easing: EASE }),
      withTiming(1, { duration: FC_HOME_MOTION.donePop * 0.3, easing: EASE }),
    );
    draw.value = withDelay(FC_HOME_MOTION.checkDelay, withTiming(1, { duration: FC_HOME_MOTION.checkDraw, easing: EASE }));
  }, [draw, play, scale]);

  const circleStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const pathProps = useAnimatedProps(() => ({ strokeDashoffset: CHECK_LENGTH * (1 - draw.value) }));

  return (
    <Animated.View style={[styles.circleDone, circleStyle]}>
      <Svg width={16} height={16} viewBox="0 0 24 24">
        <AnimatedPath
          d={CHECK_PATH}
          stroke="#ffffff"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          strokeDasharray={CHECK_LENGTH}
          animatedProps={pathProps}
        />
      </Svg>
    </Animated.View>
  );
}

function StatusChip({ done }: { done: boolean }) {
  return (
    <View style={[styles.statusChip, done ? styles.statusChipDone : styles.statusChipWaiting]}>
      <Text style={[styles.statusChipText, done ? styles.statusChipTextDone : styles.statusChipTextWaiting]}>
        {done ? '완료' : '대기'}
      </Text>
    </View>
  );
}

export function FcHomeProgressCard({
  steps,
  currentStep,
  loading,
  storageScope,
  hasTempId,
  tempIdLabel,
  nextTitle,
  nextSubtitle,
  onPressNext,
  lifeCompleted,
  nonLifeCompleted,
  licenseLabels,
}: Props) {
  const reduceMotion = useReducedMotion();
  const storageKey = storageScope ? `fc-home-last-seen-step:${storageScope}` : null;
  const [animatedSteps, setAnimatedSteps] = useState<number[]>([]);
  const lastStepRef = useRef<number | null>(null);
  const doneCount = Math.max(0, Math.min(steps.length - 1, currentStep - 1));
  const fill = useSharedValue(doneCount);

  // Celebrate only steps finished since this FC last saw the home; first visits stay still.
  useEffect(() => {
    if (loading || !storageKey) return;
    let cancelled = false;
    (async () => {
      let lastSeen: number | null = lastStepRef.current;
      if (lastSeen === null) {
        try {
          const stored = await safeStorage.getItem(storageKey);
          lastSeen = stored === null ? null : Number(stored);
        } catch (error) {
          logger.warn('[fc-home] last seen step unavailable', error);
        }
      }
      if (cancelled) return;
      const newlyDone = getNewlyCompletedSteps(lastSeen, currentStep);
      lastStepRef.current = currentStep;
      setAnimatedSteps(newlyDone);
      const target = Math.max(0, Math.min(steps.length - 1, currentStep - 1));
      if (newlyDone.length && !reduceMotion) {
        fill.value = Math.max(0, newlyDone[0] - 1);
        fill.value = withDelay(
          FC_HOME_MOTION.progressFillDelay,
          withTiming(target, { duration: FC_HOME_MOTION.progressFill, easing: EASE }),
        );
      } else {
        fill.value = target;
      }
      safeStorage.setItem(storageKey, String(currentStep)).catch((error: unknown) => {
        logger.warn('[fc-home] last seen step not saved', error);
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [currentStep, fill, loading, reduceMotion, steps.length, storageKey]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${(fill.value / (steps.length - 1)) * 80}%` }));

  // The next-step text rises in when it changes.
  const swap = useSharedValue(1);
  const previousTitle = useRef(nextTitle);
  useEffect(() => {
    if (previousTitle.current === nextTitle) return;
    previousTitle.current = nextTitle;
    if (reduceMotion) return;
    swap.value = 0;
    swap.value = withTiming(1, { duration: FC_HOME_MOTION.contentSwap, easing: EASE });
  }, [nextTitle, reduceMotion, swap]);
  const swapStyle = useAnimatedStyle(() => ({
    opacity: swap.value,
    transform: [{ translateY: (1 - swap.value) * 6 }],
  }));

  const waiting = isFcHomeNextActionWaiting(nextSubtitle);
  const commissionDone = Number(lifeCompleted) + Number(nonLifeCompleted);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>내 진행 상황</Text>
        <Text style={styles.stepCount}>
          {currentStep}
          <Text style={styles.stepTotal}>/{steps.length}</Text>
        </Text>
        <View style={styles.flex} />
        <View style={[styles.tempBadge, hasTempId ? styles.tempBadgeIssued : styles.tempBadgeMissing]}>
          <View style={[styles.tempDot, { backgroundColor: hasTempId ? '#16a34a' : '#ea6a1a' }]} />
          <Text style={[styles.tempText, { color: hasTempId ? '#166534' : '#9a3412' }]} numberOfLines={1}>
            {tempIdLabel}
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingBlock}>
          <Skeleton width="100%" height={44} />
          <Skeleton width="100%" height={84} />
        </View>
      ) : (
        <>
          <View style={styles.stepper} accessibilityRole="progressbar" accessibilityLabel={`위촉 진행 ${currentStep}단계`}>
            <View style={styles.track} />
            <Animated.View style={[styles.trackFill, fillStyle]} />
            {steps.map((step, index) => {
              const stepNum = index + 1;
              const done = stepNum < currentStep;
              const active = stepNum === currentStep;
              return (
                <View key={step.key} style={styles.stepItem}>
                  {done ? (
                    <DoneCircle animate={animatedSteps.includes(stepNum)} />
                  ) : active ? (
                    <View style={styles.circleActive}>
                      <View style={styles.circleActiveDot} />
                    </View>
                  ) : (
                    <View style={styles.circleTodo}>
                      <Text style={styles.circleTodoText}>{stepNum}</Text>
                    </View>
                  )}
                  <Text style={[styles.stepLabel, active && styles.stepLabelActive, done && styles.stepLabelDone]}>
                    {step.label}
                  </Text>
                </View>
              );
            })}
          </View>

          <Pressable
            onPress={onPressNext}
            accessibilityRole="button"
            accessibilityLabel={`다음 단계 ${nextTitle}. ${nextSubtitle}`}
            style={({ pressed }) => [styles.next, pressed && styles.nextPressed]}
          >
            <View style={styles.nextIcon}>
              <Feather name={waiting ? 'clock' : 'arrow-right'} size={20} color={ORANGE} />
            </View>
            <Animated.View style={[styles.flex, swapStyle]}>
              <Text style={styles.nextLabel}>다음 단계</Text>
              <Text style={styles.nextTitle} numberOfLines={1}>{nextTitle}</Text>
              <Text style={styles.nextSubtitle}>{nextSubtitle}</Text>
            </Animated.View>
          </Pressable>

          <View style={styles.commissionRow}>
            <View style={styles.commissionTile}>
              <Image source={TYPE_IMAGES.생명} style={styles.commissionImage} accessibilityIgnoresInvertColors />
              <Text style={styles.commissionLabel}>생명 위촉</Text>
              <StatusChip done={lifeCompleted} />
            </View>
            <View style={styles.commissionTile}>
              <Image source={TYPE_IMAGES.손해} style={styles.commissionImage} accessibilityIgnoresInvertColors />
              <Text style={styles.commissionLabel}>손해 위촉</Text>
              <StatusChip done={nonLifeCompleted} />
            </View>
          </View>

          <View style={styles.summary}>
            <Text style={styles.summaryText}>
              위촉 완료 <Text style={styles.summaryStrong}>{commissionDone}/2</Text>
            </Text>
            <View style={styles.flex} />
            {licenseLabels.length ? (
              <>
                <Text style={styles.summaryText}>자격증</Text>
                {licenseLabels.map((label) => (
                  <View key={label} style={styles.licenseChip}>
                    {label in TYPE_IMAGES ? (
                      <Image source={TYPE_IMAGES[label as keyof typeof TYPE_IMAGES]} style={styles.licenseImage} accessibilityIgnoresInvertColors />
                    ) : (
                      <Feather name="check" size={12} color="#1f7a4d" />
                    )}
                    <Text style={styles.licenseChipText}>{label}</Text>
                  </View>
                ))}
              </>
            ) : (
              <Text style={styles.summaryText}>자격증 없음</Text>
            )}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginBottom: 12, padding: 20, backgroundColor: '#ffffff', borderRadius: 24, gap: 18 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 19, fontWeight: '800', color: INK },
  stepCount: { fontSize: 15, fontWeight: '800', color: ORANGE, fontVariant: ['tabular-nums'] },
  stepTotal: { color: '#9ca3af', fontWeight: '700' },
  flex: { flex: 1 },
  tempBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 5, maxWidth: '55%' },
  tempBadgeIssued: { backgroundColor: '#ecfdf5' },
  tempBadgeMissing: { backgroundColor: '#fff4ea' },
  tempDot: { width: 6, height: 6, borderRadius: 3 },
  tempText: { fontSize: 12, fontWeight: '700', flexShrink: 1 },
  loadingBlock: { gap: 12 },
  stepper: { flexDirection: 'row' },
  track: { position: 'absolute', left: '10%', right: '10%', top: 13, height: 2, backgroundColor: '#eceef1' },
  trackFill: { position: 'absolute', left: '10%', top: 13, height: 2, backgroundColor: ORANGE },
  stepItem: { flex: 1, alignItems: 'center', gap: 8 },
  circleDone: { width: 28, height: 28, borderRadius: 14, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center' },
  circleActive: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: ORANGE, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center' },
  circleActiveDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: ORANGE },
  circleTodo: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: '#e5e7eb', backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center' },
  circleTodoText: { fontSize: 12, fontWeight: '700', color: '#9ca3af' },
  stepLabel: { fontSize: 12, lineHeight: 16, color: '#6b7280', fontWeight: '500', textAlign: 'center' },
  stepLabelActive: { color: INK, fontWeight: '700' },
  stepLabelDone: { color: '#374151' },
  next: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, borderRadius: 18, padding: 16, backgroundColor: '#fff6ef' },
  nextPressed: { transform: [{ scale: 0.98 }], backgroundColor: '#fdeee2' },
  nextIcon: { width: 40, height: 40, borderRadius: 14, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center' },
  nextLabel: { fontSize: 12, fontWeight: '700', color: '#a8460f', marginBottom: 4 },
  nextTitle: { fontSize: 18, fontWeight: '800', color: INK, marginBottom: 4 },
  nextSubtitle: { fontSize: 14, lineHeight: 20, color: '#5b4636' },
  commissionRow: { flexDirection: 'row', gap: 8 },
  commissionTile: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 16, backgroundColor: '#f5f6f8', paddingLeft: 8, paddingRight: 10, paddingVertical: 8 },
  commissionImage: { width: 30, height: 30 },
  commissionLabel: { flex: 1, fontSize: 14, fontWeight: '500', color: '#374151' },
  statusChip: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  statusChipDone: { backgroundColor: '#dcfce7' },
  statusChipWaiting: { backgroundColor: '#e2e8f0' },
  statusChipText: { fontSize: 12, fontWeight: '700' },
  statusChipTextDone: { color: '#166534' },
  statusChipTextWaiting: { color: '#475569' },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 6, borderTopWidth: 1, borderTopColor: '#f1f2f4', paddingTop: 14, flexWrap: 'wrap' },
  summaryText: { fontSize: 13, color: MUTED },
  summaryStrong: { color: INK, fontWeight: '700' },
  licenseChip: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 8, backgroundColor: '#e7f6ee', paddingHorizontal: 8, paddingVertical: 4 },
  licenseImage: { width: 16, height: 16 },
  licenseChipText: { fontSize: 12, fontWeight: '700', color: '#1f7a4d' },
});
