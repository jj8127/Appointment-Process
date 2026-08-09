import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  MESSENGER_TAB_BADGE_UNDERLINE_GAP,
  MESSENGER_TAB_TOUCH_TARGET,
} from '@/lib/messenger-hub-model';

export type MessengerTab = 'people' | 'chats';

type Props = {
  activeTab: MessengerTab;
  unreadCount: number;
  onChange: (tab: MessengerTab) => void;
};

const formatBadge = (count: number) => count > 99 ? '99+' : String(count);

export function MessengerTabBar({ activeTab, unreadCount, onChange }: Props) {
  return (
    <View style={styles.root} accessibilityRole="tablist">
      <TabButton
        label="사람"
        tab="people"
        activeTab={activeTab}
        onChange={onChange}
      />
      <TabButton
        label="대화"
        tab="chats"
        activeTab={activeTab}
        onChange={onChange}
        badge={unreadCount}
      />
    </View>
  );
}

function TabButton({
  label,
  tab,
  activeTab,
  badge = 0,
  onChange,
}: {
  label: string;
  tab: MessengerTab;
  activeTab: MessengerTab;
  badge?: number;
  onChange: (tab: MessengerTab) => void;
}) {
  const selected = activeTab === tab;
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={`${label} 탭`}
      accessibilityState={{ selected }}
      hitSlop={4}
      onPressIn={() => onChange(tab)}
      style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
    >
      <View style={styles.tabTopSpace} />
      <View style={styles.tabContent}>
        <Text style={[styles.label, selected && styles.labelActive]}>{label}</Text>
      </View>
      <View style={styles.badgeSlot}>
        {badge > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{formatBadge(badge)}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.badgeUnderlineGap} />
      <View style={[styles.underline, selected && styles.underlineActive]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  tab: { flex: 1, minHeight: MESSENGER_TAB_TOUCH_TARGET },
  pressed: { opacity: 0.72 },
  tabTopSpace: { height: 8 },
  tabContent: {
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeSlot: { height: 20, alignItems: 'center', justifyContent: 'center' },
  label: { color: '#6B7280', fontSize: 15, fontWeight: '600' },
  labelActive: { color: '#111827', fontWeight: '700' },
  badge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f36f21',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  badgeUnderlineGap: { height: MESSENGER_TAB_BADGE_UNDERLINE_GAP },
  underline: { height: 2, marginHorizontal: 22, backgroundColor: 'transparent' },
  underlineActive: { backgroundColor: '#f36f21' },
});
