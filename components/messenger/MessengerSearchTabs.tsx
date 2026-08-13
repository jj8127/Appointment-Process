import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { MessengerSearchTab } from '@/lib/messenger-search-model';

const TABS: { key: MessengerSearchTab; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'people', label: '사람' },
  { key: 'rooms', label: '채팅방' },
  { key: 'messages', label: '메시지' },
];

export default function MessengerSearchTabs({
  activeTab,
  onChange,
}: {
  activeTab: MessengerSearchTab;
  onChange: (tab: MessengerSearchTab) => void;
}) {
  return (
    <View accessibilityRole="tablist" style={styles.container}>
      {TABS.map((tab) => {
        const active = tab.key === activeTab;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            key={tab.key}
            onPress={() => onChange(tab.key)}
            style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
          >
            <Text style={[styles.label, active && styles.activeLabel]}>{tab.label}</Text>
            <View style={[styles.indicator, active && styles.activeIndicator]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderBottomColor: '#EAEAEA',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
  },
  tab: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'flex-end',
    minHeight: 48,
  },
  label: { color: '#777777', fontSize: 15, fontWeight: '600' },
  activeLabel: { color: '#F36F21', fontWeight: '700' },
  indicator: { height: 2, marginTop: 11, width: '58%' },
  activeIndicator: { backgroundColor: '#F36F21' },
  pressed: { opacity: 0.55 },
});
