import { StyleSheet, Text, View } from 'react-native';

import { REQUEST_PROGRESS_STEPS, type RequestProgressTone } from '@/lib/request-board-progress';
import { COLORS } from '@/lib/theme';

export const REQUEST_PROGRESS_TONE: Record<RequestProgressTone, { color: string; background: string }> = {
  waiting: { color: '#B45309', background: '#FEF3C7' },
  active: { color: '#2563EB', background: '#EFF6FF' },
  action: { color: '#7C3AED', background: '#F5F3FF' },
  done: { color: '#059669', background: '#ECFDF5' },
  stopped: { color: '#DC2626', background: '#FEF2F2' },
};

type Props = {
  step: number;
  tone: RequestProgressTone;
  /** Show step names under the bar (detail screen); the list card shows the bar alone. */
  showLabels?: boolean;
};

/** Four segments for 수락 대기 → 설계 중 → 검토 대기 → 완료; a stopped request keeps its reached step in red. */
export function RequestProgressSteps({ step, tone, showLabels = false }: Props) {
  const fill = REQUEST_PROGRESS_TONE[tone].color;
  return (
    <View accessibilityLabel={`진행 ${step + 1}/${REQUEST_PROGRESS_STEPS.length} 단계`}>
      <View style={styles.bar}>
        {REQUEST_PROGRESS_STEPS.map((name, index) => (
          <View key={name} style={[styles.segment, { backgroundColor: index <= step ? fill : COLORS.gray[200] }]} />
        ))}
      </View>
      {showLabels ? (
        <View style={styles.labels}>
          {REQUEST_PROGRESS_STEPS.map((name, index) => (
            <Text key={name} style={[styles.label, index === step && { color: fill, fontWeight: '800' }]}>
              {name}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', gap: 4 },
  segment: { flex: 1, height: 6, borderRadius: 3 },
  labels: { flexDirection: 'row', marginTop: 6 },
  label: { flex: 1, textAlign: 'center', fontSize: 11, color: COLORS.gray[500] },
});
