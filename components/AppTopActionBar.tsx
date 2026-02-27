import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type AppTopActionBarProps = {
  title: string;
  onLogout: () => void;
  onOpenNotifications: () => void;
  notificationCount?: number;
  showNotificationDot?: boolean;
};

const CHARCOAL = '#111827';
const TEXT_MUTED = '#6b7280';

export function AppTopActionBar({
  title,
  onLogout,
  onOpenNotifications,
  notificationCount = 0,
  showNotificationDot = false,
}: AppTopActionBarProps) {
  const insets = useSafeAreaInsets();
  const showCountBadge = notificationCount > 0;
  const showDotBadge = !showCountBadge && showNotificationDot;
  const badgeLabel = notificationCount > 99 ? '99+' : String(notificationCount);

  return (
    <View style={[styles.topBar, { paddingTop: Math.max(insets.top + 6, 12) }]}>
      <View style={styles.sideSlotLeft}>
        <Pressable style={styles.iconButton} onPress={onOpenNotifications}>
          <Feather name="bell" size={20} color={CHARCOAL} />
          {showCountBadge && (
            <View style={[styles.countBadge, badgeLabel.length >= 3 && styles.countBadgeWide]}>
              <Text
                style={styles.countBadgeText}
                allowFontScaling={false}
                maxFontSizeMultiplier={1}
              >
                {badgeLabel}
              </Text>
            </View>
          )}
          {showDotBadge && <View style={styles.dotBadge} />}
        </Pressable>
      </View>

      <View style={styles.centerSlot}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
      </View>

      <View style={styles.sideSlotRight}>
        <Pressable style={styles.logoutButton} onPress={onLogout}>
          <Text style={styles.logoutText}>로그아웃</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  sideSlotLeft: {
    width: 80,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  sideSlotRight: {
    width: 80,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  centerSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  title: {
    fontSize: 16,
    color: CHARCOAL,
    fontWeight: '700',
  },
  logoutButton: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  logoutText: {
    fontSize: 14,
    color: TEXT_MUTED,
    fontWeight: '600',
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'visible',
  },
  countBadge: {
    position: 'absolute',
    top: -6,
    right: -7,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#fff',
    paddingHorizontal: 4,
  },
  countBadgeWide: {
    minWidth: 24,
    paddingHorizontal: 5,
  },
  countBadgeText: {
    color: '#fff',
    fontSize: 10,
    lineHeight: 10,
    fontWeight: '700',
    textAlign: 'center',
    includeFontPadding: false,
  },
  dotBadge: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
  },
});
