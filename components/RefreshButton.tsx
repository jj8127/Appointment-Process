import { Feather } from '@expo/vector-icons';
import { usePathname, router } from 'expo-router';
import { useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet } from 'react-native';

const BORDER = '#e5e7eb';
const CHARCOAL = '#111827';

type Props = { onPress?: () => void | Promise<void> };

export function RefreshButton({ onPress }: Props) {
  const pathname = usePathname();
  const spinAnim = useRef(new Animated.Value(0)).current;

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const trigger = () => {
    spinAnim.setValue(0);
    Animated.timing(spinAnim, {
      toValue: 1,
      duration: 600,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start(async () => {
      try {
        if (onPress) {
          await onPress();
        } else {
          router.replace(pathname || '/');
        }
      } catch (err) {
        console.warn('RefreshButton onPress failed', err);
      }
    });
  };

  return (
    <Pressable style={styles.button} onPress={trigger}>
      <Animated.View style={{ transform: [{ rotate: spin }] }}>
        <Feather name="refresh-cw" size={18} color={CHARCOAL} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 3,
  },
});
