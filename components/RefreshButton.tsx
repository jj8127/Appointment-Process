import { Feather } from '@expo/vector-icons';
import { usePathname, router, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet } from 'react-native';

import { logger } from '@/lib/logger';

const BORDER = '#e5e7eb';
const CHARCOAL = '#111827';

/** `busy` lets a screen keep the spinner going while its own fetch runs (e.g. a query's isFetching). */
type Props = { onPress?: () => void | Promise<void>; busy?: boolean };

const BUTTON_SHADOW =
  Platform.OS === 'web'
    ? { boxShadow: '0 2px 6px rgba(0,0,0,0.12)' }
    : {
        shadowColor: '#000',
        shadowOpacity: 0.06,
        shadowOffset: { width: 0, height: 2 },
        shadowRadius: 6,
        elevation: 3,
      };

export function RefreshButton({ onPress, busy = false }: Props) {
  const pathname = usePathname();
  const spinAnim = useRef(new Animated.Value(0)).current;
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const spinning = running || busy;

  // Spin for as long as the refresh is actually running, not a fixed 600ms before it starts.
  useEffect(() => {
    if (!spinning) return;
    spinAnim.setValue(0);
    const loop = Animated.loop(
      Animated.timing(spinAnim, { toValue: 1, duration: 600, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => {
      loop.stop();
      spinAnim.setValue(0);
    };
  }, [spinning, spinAnim]);

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const trigger = async () => {
    if (runningRef.current || busy) return;
    runningRef.current = true;
    setRunning(true);
    try {
      if (onPress) {
        await onPress();
      } else {
        const target = (pathname || '/') as Href;
        router.replace(target);
      }
    } catch (err) {
      logger.warn('RefreshButton onPress failed', err);
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="새로고침"
      accessibilityState={{ busy: spinning, disabled: spinning }}
      disabled={spinning}
      style={styles.button}
      onPress={() => void trigger()}
    >
      <Animated.View style={{ transform: [{ rotate: spin }] }}>
        <Feather aria-hidden accessible={false} name="refresh-cw" size={18} color={CHARCOAL} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    ...BUTTON_SHADOW,
  },
});
