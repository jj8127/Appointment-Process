import { StyleSheet, Text, View } from 'react-native';

/** Marks where the viewer stopped reading when the room opened. */
export function MessengerReadLine() {
  return (
    <View style={styles.row} accessibilityRole="text" accessibilityLabel="여기부터 안 읽은 메시지">
      <View style={styles.rule} />
      <Text style={styles.label}>여기까지 읽었어요</Text>
      <View style={styles.rule} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 10, paddingHorizontal: 4 },
  rule: { flex: 1, height: StyleSheet.hairlineWidth * 2, backgroundColor: '#F7B48A' },
  label: { fontSize: 11, fontWeight: '700', color: '#f36f21' },
});
