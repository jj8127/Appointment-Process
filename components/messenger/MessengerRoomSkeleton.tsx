import { StyleSheet, View } from 'react-native';

// Bubble-shaped placeholders while a room's first page loads, so the room
// keeps its shape instead of a full-screen spinner. Widths are fixed so the
// placeholder never jumps between renders.
const ROWS: readonly { mine: boolean; width: `${number}%`; lines: 1 | 2 }[] = [
  { mine: false, width: '62%', lines: 2 },
  { mine: false, width: '38%', lines: 1 },
  { mine: true, width: '54%', lines: 1 },
  { mine: false, width: '70%', lines: 2 },
  { mine: true, width: '44%', lines: 2 },
  { mine: false, width: '30%', lines: 1 },
];

export function MessengerRoomSkeleton() {
  return (
    <View style={styles.wrap} accessibilityRole="progressbar" accessibilityLabel="대화를 불러오는 중">
      {ROWS.map((row, index) => (
        <View key={index} style={[styles.row, row.mine ? styles.rowMine : styles.rowOther]}>
          {row.mine ? null : <View style={styles.avatar} />}
          <View style={[styles.bubble, { width: row.width, height: row.lines === 2 ? 58 : 38 }]} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: 16, paddingBottom: 16, gap: 14 },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  rowMine: { justifyContent: 'flex-end' },
  rowOther: { justifyContent: 'flex-start' },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#ECEEF1', marginRight: 8 },
  bubble: { borderRadius: 16, backgroundColor: '#ECEEF1' },
});
