import { Feather } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { FC_HOME_MOTION } from '@/lib/fc-home-sections';

type Props = {
  preview: string;
  timeLabel: string | null;
  unreadCount: number;
  onOpenMessenger: () => void;
};

export function FcHomeMessages({ preview, timeLabel, unreadCount, onOpenMessenger }: Props) {
  const reduceMotion = useReducedMotion();
  const badgeScale = useSharedValue(1);
  const previousCount = useRef(unreadCount);

  // A new unread message nudges the badge once; it never blinks.
  useEffect(() => {
    if (unreadCount > previousCount.current && !reduceMotion) {
      badgeScale.value = withSequence(
        withTiming(1.25, { duration: FC_HOME_MOTION.press }),
        withTiming(1, { duration: FC_HOME_MOTION.press }),
      );
    }
    previousCount.current = unreadCount;
  }, [badgeScale, reduceMotion, unreadCount]);
  const badgeStyle = useAnimatedStyle(() => ({ transform: [{ scale: badgeScale.value }] }));
  const badgeText = unreadCount > 99 ? '99+' : String(unreadCount);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.sectionTitle}>
          <Image source={require('@/assets/images/fc-home/section-chat.png')} style={styles.sectionIcon} accessibilityIgnoresInvertColors />
          <Text style={styles.title}>메시지</Text>
        </View>
        <Pressable onPress={onOpenMessenger} hitSlop={8} accessibilityRole="button" accessibilityLabel="메신저 전체 보기">
          <Text style={styles.link}>전체</Text>
        </Pressable>
      </View>
      <Pressable
        onPress={onOpenMessenger}
        accessibilityRole="button"
        accessibilityLabel={unreadCount > 0 ? `총무팀, 읽지 않은 메시지 ${badgeText}개` : '총무팀 대화'}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>총</Text>
        </View>
        <View style={styles.copy}>
          <Text style={styles.name}>총무팀</Text>
          <Text style={styles.preview} numberOfLines={1}>{preview}</Text>
        </View>
        <View style={styles.trailing}>
          {timeLabel ? <Text style={styles.time}>{timeLabel}</Text> : null}
          {unreadCount > 0 ? (
            <Animated.View style={[styles.badge, badgeStyle]}>
              <Text style={styles.badgeText}>{badgeText}</Text>
            </Animated.View>
          ) : (
            <Feather name="chevron-right" size={18} color="#9ca3af" />
          )}
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginBottom: 12, paddingTop: 18, paddingHorizontal: 8, paddingBottom: 8, backgroundColor: '#ffffff', borderRadius: 24 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 6 },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionIcon: { width: 28, height: 28 },
  title: { fontSize: 18, fontWeight: '800', color: '#111827' },
  link: { fontSize: 14, fontWeight: '500', color: '#4b5563' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16 },
  rowPressed: { backgroundColor: '#f5f6f8' },
  avatar: { width: 44, height: 44, borderRadius: 15, backgroundColor: '#fff1e6', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 16, fontWeight: '800', color: '#a8460f' },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  name: { fontSize: 15, fontWeight: '700', color: '#111827' },
  preview: { fontSize: 14, color: '#4b5563' },
  trailing: { alignItems: 'flex-end', gap: 6 },
  time: { fontSize: 12, color: '#6b7280' },
  badge: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, backgroundColor: '#c65312', alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 12, fontWeight: '700', color: '#ffffff' },
});
