import { Feather } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { ONBOARDING_STEP_NAMES, STEP_NOW_LABEL, type StepNow, type StepNowTone } from '@/lib/onboarding-step-now';
import { COLORS } from '@/lib/theme';

const ORANGE = COLORS.primaryButton;

const TONE: Record<StepNowTone, { color: string; background: string; ring: string }> = {
  mine: { color: '#ffffff', background: COLORS.primaryButton, ring: ORANGE },
  waiting: { color: '#9a3412', background: COLORS.primaryPale, ring: ORANGE },
  rejected: { color: '#b91c1c', background: '#fef2f2', ring: COLORS.error },
  done: { color: '#047857', background: '#ecfdf5', ring: ORANGE },
  locked: { color: COLORS.gray[600], background: COLORS.gray[100], ring: '#e5e7eb' },
};

type Props = {
  /** 1-based appointment step this screen handles. */
  step: 1 | 2 | 3 | 4;
  now: StepNow;
  action?: { label: string; onPress: () => void; icon?: ComponentProps<typeof Feather>['name'] };
  style?: StyleProp<ViewStyle>;
};

/** Top card on each appointment step screen: where this step sits, whose turn it is, and the one thing to do. */
export function OnboardingStepNowCard({ step, now, action, style }: Props) {
  const tone = TONE[now.tone];
  // A locked step means an earlier one is still open, so earlier segments are not shown as done.
  const earlierDone = now.tone !== 'locked';
  return (
    <View style={[styles.card, style]} accessibilityLabel={`위촉 ${step}단계 ${ONBOARDING_STEP_NAMES[step - 1]}, ${STEP_NOW_LABEL[now.tone]}`}>
      {/* Same stepper as the home progress card, without its celebration motion. */}
      <View style={styles.stepper} accessibilityRole="progressbar" accessibilityLabel={`위촉 진행 ${step}단계`}>
        <View style={styles.track} />
        {earlierDone && step > 1 ? (
          <View style={[styles.trackFill, { width: `${((step - (now.tone === 'done' ? 0 : 1)) / 4) * 80}%` }]} />
        ) : null}
        {ONBOARDING_STEP_NAMES.map((name, index) => {
          const stepNum = index + 1;
          const done = (earlierDone && stepNum < step) || (stepNum === step && now.tone === 'done');
          const active = stepNum === step && !done;
          return (
            <View key={name} style={styles.stepItem}>
              {done ? (
                <View style={styles.circleDone}>
                  <Feather name="check" size={15} color="#ffffff" />
                </View>
              ) : active && now.tone !== 'locked' ? (
                <View style={[styles.circleActive, { borderColor: tone.ring }]}>
                  <View style={[styles.circleActiveDot, { backgroundColor: tone.ring }]} />
                </View>
              ) : (
                <View style={styles.circleTodo}>
                  <Text style={styles.circleTodoText}>{stepNum}</Text>
                </View>
              )}
              <Text style={[styles.stepLabel, stepNum === step && styles.stepLabelActive, done && stepNum !== step && styles.stepLabelDone]}>
                {name}
              </Text>
            </View>
          );
        })}
      </View>
      <View style={[styles.pill, { backgroundColor: tone.background }]}>
        <Text style={[styles.pillText, { color: tone.color }]}>{STEP_NOW_LABEL[now.tone]}</Text>
      </View>
      <Text style={styles.title}>{now.title}</Text>
      {now.detail ? <Text style={styles.detail}>{now.detail}</Text> : null}
      {now.reason ? (
        <View style={styles.reasonBox}>
          <Text style={styles.reasonLabel}>반려 사유</Text>
          <Text style={styles.reasonText}>{now.reason}</Text>
        </View>
      ) : null}
      {action ? (
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
          onPress={action.onPress}
        >
          <Text style={styles.actionText}>{action.label}</Text>
          <Feather name={action.icon ?? 'arrow-right'} size={16} color="#ffffff" />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 12, padding: 20, borderRadius: 24, backgroundColor: '#ffffff' },
  stepper: { flexDirection: 'row', marginBottom: 18 },
  track: { position: 'absolute', left: '10%', right: '10%', top: 13, height: 2, backgroundColor: '#eceef1' },
  trackFill: { position: 'absolute', left: '10%', top: 13, height: 2, backgroundColor: ORANGE },
  stepItem: { flex: 1, alignItems: 'center', gap: 8 },
  circleDone: { width: 28, height: 28, borderRadius: 14, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center' },
  circleActive: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center' },
  circleActiveDot: { width: 10, height: 10, borderRadius: 5 },
  circleTodo: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: '#e5e7eb', backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center' },
  circleTodoText: { fontSize: 12, fontWeight: '700', color: '#9ca3af' },
  stepLabel: { fontSize: 12, lineHeight: 16, color: '#6b7280', fontWeight: '500', textAlign: 'center' },
  stepLabelActive: { color: COLORS.gray[900], fontWeight: '700' },
  stepLabelDone: { color: '#374151' },
  pill: { alignSelf: 'flex-start', marginBottom: 8, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  pillText: { fontSize: 12, fontWeight: '800' },
  title: { fontSize: 20, lineHeight: 28, fontWeight: '800', color: COLORS.gray[900], letterSpacing: -0.3 },
  detail: { marginTop: 6, fontSize: 14, lineHeight: 20, color: COLORS.gray[600] },
  // Neutral box with a red edge: the label carries the alarm, the reason stays easy to read.
  reasonBox: { marginTop: 14, padding: 14, borderRadius: 12, borderLeftWidth: 3, borderLeftColor: COLORS.error, backgroundColor: COLORS.gray[50] },
  reasonLabel: { fontSize: 12, fontWeight: '800', color: '#b91c1c' },
  reasonText: { marginTop: 4, fontSize: 15, lineHeight: 22, color: COLORS.gray[800] },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 52,
    marginTop: 16,
    borderRadius: 16,
    backgroundColor: COLORS.primaryButton,
  },
  actionPressed: { opacity: 0.88 },
  actionText: { fontSize: 16, fontWeight: '800', color: '#ffffff' },
});
