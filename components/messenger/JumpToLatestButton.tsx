import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text } from 'react-native';

const ORANGE = '#f36f21';

/** Floating button over an inverted chat list: a plain arrow, or "새 메시지" when one arrived while scrolled up. */
export function JumpToLatestButton({ hasNewMessage, onPress }: { hasNewMessage: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={hasNewMessage ? '새 메시지로 이동' : '최신 메시지로 이동'}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        hasNewMessage ? styles.buttonNew : styles.buttonPlain,
        pressed && styles.pressed,
      ]}
    >
      {hasNewMessage ? <Text style={styles.newText}>새 메시지</Text> : null}
      <Feather name="arrow-down" size={18} color={hasNewMessage ? '#fff' : '#374151'} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    right: 14,
    bottom: 14,
    minWidth: 40,
    height: 40,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  buttonPlain: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5E7EB' },
  buttonNew: { backgroundColor: ORANGE, paddingHorizontal: 14 },
  newText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  pressed: { opacity: 0.85 },
});
