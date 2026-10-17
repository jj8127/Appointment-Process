import { Feather } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { ONBOARDING_STEP_NAMES, STEP_NOW_LABEL, type StepNow, type StepNowTone } from '@/lib/onboarding-step-now';
import { COLORS } from '@/lib/theme';

const TONE: Record<StepNowTone, { color: string; background: string; fill: string }> = {
  mine: { color: '#ffffff', background: COLORS.primaryButton, fill: COLORS.primaryButton },
  waiting: { color: '#9a3412', background: COLORS.primaryPale, fill: COLORS.primary },
  rejected: { color: '#b91c1c', background: '#fef2f2', fill: COLORS.error },
  done: { color: '#047857', background: '#ecfdf5', fill: COLORS.success },
  locked: { color: COLORS.gray[600], background: COLORS.gray[100], fill: COLORS.gray[300] },
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
      <View style={styles.topRow}>
        <Text style={styles.stepText}>
          {step}/5 · {ONBOARDING_STEP_NAMES[step - 1]}
        </Text>
        <View style={[styles.pill, { backgroundColor: tone.background }]}>
          <Text style={[styles.pillText, { color: tone.color }]}>{STEP_NOW_LABEL[now.tone]}</Text>
        </View>
      </View>
      <View style={styles.bar}>
        {ONBOARDING_STEP_NAMES.map((name, index) => (
          <View
            key={name}
            style={[
              styles.segment,
              earlierDone && index < step - 1 && styles.segmentDone,
              index === step - 1 && { backgroundColor: tone.fill },
            ]}
          />
        ))}
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
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  stepText: { fontSize: 13, fontWeight: '700', color: COLORS.gray[600] },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  pillText: { fontSize: 12, fontWeight: '800' },
  bar: { flexDirection: 'row', gap: 4, marginTop: 12, marginBottom: 16 },
  segment: { flex: 1, height: 6, borderRadius: 3, backgroundColor: COLORS.gray[200] },
  segmentDone: { backgroundColor: COLORS.primary },
  title: { fontSize: 20, lineHeight: 28, fontWeight: '800', color: COLORS.gray[900], letterSpacing: -0.3 },
  detail: { marginTop: 6, fontSize: 14, lineHeight: 20, color: COLORS.gray[600] },
  reasonBox: { marginTop: 14, padding: 14, borderRadius: 16, backgroundColor: '#fef2f2' },
  reasonLabel: { fontSize: 12, fontWeight: '800', color: '#b91c1c' },
  reasonText: { marginTop: 4, fontSize: 15, lineHeight: 22, color: '#7f1d1d' },
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
