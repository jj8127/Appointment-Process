import { Feather } from '@expo/vector-icons';
import { Stack, router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomNavigation } from '@/components/BottomNavigation';
import { ServiceIcon, type ServiceName } from '@/components/service-home';
import { useSession } from '@/hooks/use-session';
import { resolveBottomNavActiveKey, resolveBottomNavPreset } from '@/lib/bottom-navigation';
import { COLORS } from '@/lib/theme';

export function ServiceAction({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
    <Text style={styles.actionText}>{label}</Text>
  </Pressable>;
}

export default function ServiceInformation({ title, service, children, activity = false }: {
  title: string;
  service?: ServiceName;
  children: ReactNode;
  activity?: boolean;
}) {
  const session = useSession();
  const insets = useSafeAreaInsets();
  const preset = resolveBottomNavPreset(session, { surface: 'service-hub' });
  return <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
    <Stack.Screen options={{ headerShown: false, title }} />
    <ScrollView contentContainerStyle={{ paddingBottom: 120 + insets.bottom }}>
      <View style={styles.column}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="서비스 홈으로" style={styles.back} onPress={() => router.replace('/')}>
            <Feather name="arrow-left" size={23} color={COLORS.text.primary} accessible={false} />
          </Pressable>
          <Text accessibilityRole="header" style={styles.headerTitle}>{title}</Text>
        </View>
        <View style={styles.content}>
          {service && <View style={styles.art}><ServiceIcon service={service} size={80} /></View>}
          {children}
        </View>
      </View>
    </ScrollView>
    {preset && <BottomNavigation preset={preset} activeKey={resolveBottomNavActiveKey(preset, activity ? 'activity' : 'home')} bottomInset={insets.bottom} />}
  </SafeAreaView>;
}

export const informationStyles = StyleSheet.create({
  badge: { color: COLORS.warning.dark, fontSize: 12, fontWeight: '600', alignSelf: 'flex-start', backgroundColor: COLORS.primaryPale, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 16 },
  title: { fontSize: 27, lineHeight: 37, letterSpacing: -0.8, fontWeight: '700', color: COLORS.text.primary, marginBottom: 14 },
  body: { fontSize: 15, lineHeight: 25, color: COLORS.text.secondary, marginBottom: 22 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: COLORS.text.primary, marginBottom: 12 },
  list: { borderWidth: 1, borderColor: COLORS.border.light, borderRadius: 16, padding: 18, marginBottom: 22, gap: 16 },
  item: { fontSize: 14, lineHeight: 23, color: COLORS.text.secondary },
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.white },
  column: { maxWidth: 480, width: '100%', alignSelf: 'center' },
  header: { minHeight: 72, paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border.light, flexDirection: 'row', alignItems: 'center', gap: 9 },
  back: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '700', color: COLORS.text.primary },
  content: { padding: 24 },
  art: { marginBottom: 20 },
  action: { minHeight: 48, padding: 14, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', borderRadius: 12, marginTop: 8 },
  actionText: { fontSize: 15, fontWeight: '700', color: COLORS.text.primary, textAlign: 'center' },
  pressed: { opacity: 0.75 },
});
