import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

type Props = {
  value: string;
  onChangeText: (value: string) => void;
  onBack: () => void;
  onClear: () => void;
};

export default function MessengerSearchHeader({ value, onChangeText, onBack, onClear }: Props) {
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="검색 닫기"
        hitSlop={6}
        onPress={onBack}
        style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
      >
        <Feather name="arrow-left" size={24} color="#171717" />
      </Pressable>
      <View style={styles.inputShell}>
        <Feather name="search" size={19} color="#7A7A7A" />
        <TextInput
          accessibilityLabel="메신저 검색어"
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          clearButtonMode="never"
          onChangeText={onChangeText}
          placeholder="사람, 채팅방, 메시지 검색"
          placeholderTextColor="#929292"
          returnKeyType="search"
          selectionColor="#F36F21"
          style={styles.input}
          value={value}
        />
        {value.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="검색어 지우기"
            hitSlop={8}
            onPress={onClear}
            style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}
          >
            <Feather name="x-circle" size={19} color="#A2A2A2" />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    gap: 8,
    minHeight: 60,
    paddingHorizontal: 8,
  },
  iconButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  inputShell: {
    alignItems: 'center',
    backgroundColor: '#F4F4F5',
    borderRadius: 12,
    flex: 1,
    flexDirection: 'row',
    minHeight: 44,
    paddingHorizontal: 13,
  },
  input: {
    color: '#171717',
    flex: 1,
    fontSize: 16,
    lineHeight: 21,
    paddingHorizontal: 9,
    paddingVertical: 0,
  },
  clearButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    marginRight: -10,
    width: 40,
  },
  pressed: { opacity: 0.55 },
});
