import { StyleSheet, Text, View } from 'react-native';

import { formatMessengerDayLabel } from '@/lib/messenger-time';

export function MessengerDayDivider({ createdAt }: { createdAt: string }) {
  const label = formatMessengerDayLabel(createdAt);
  if (!label) return null;
  return (
    <View style={styles.row} accessibilityRole="header">
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', marginTop: 4, marginBottom: 14 },
  label: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#EEF0F3',
    color: '#6B7280',
    fontSize: 12,
    fontWeight: '600',
  },
});
