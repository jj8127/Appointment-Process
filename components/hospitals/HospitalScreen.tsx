import { Feather } from '@expo/vector-icons';
import { Stack, router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomNavigation } from '@/components/BottomNavigation';
import { useSession } from '@/hooks/use-session';
import { goBackOrReplace } from '@/lib/back-navigation';
import { resolveBottomNavPreset } from '@/lib/bottom-navigation';
import { COLORS } from '@/lib/theme';
import { HOSPITAL_DEMO_ENABLED } from '@/lib/platform-api';

export default function HospitalScreen({ children, detail = false, headerActions }: { children: ReactNode; detail?: boolean; headerActions?: ReactNode }) {
  const session = useSession();
  const insets = useSafeAreaInsets();
  const preset = resolveBottomNavPreset(session, { surface: 'service-hub' });
  return <SafeAreaView style={hospitalStyles.screen} edges={['top', 'left', 'right']}>
    <Stack.Screen options={{ headerShown: false, title: detail ? '병원 상세' : '제휴병원' }} />
    <View style={hospitalStyles.column}>
      <View style={hospitalStyles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="뒤로 가기" style={hospitalStyles.iconButton} onPress={() => goBackOrReplace(router, detail ? '/services/hospitals' : '/')}>
          <Feather aria-hidden name="arrow-left" size={23} color={COLORS.text.primary} accessible={false} />
        </Pressable>
        <Text accessibilityRole="header" style={hospitalStyles.headerTitle}>{detail ? '병원 상세' : '제휴병원'}{HOSPITAL_DEMO_ENABLED ? ' · 샘플' : ''}</Text>
        {headerActions && <View style={hospitalStyles.headerActions}>{headerActions}</View>}
      </View>
      {children}
    </View>
    {preset && <BottomNavigation preset={preset} activeKey="home" bottomInset={insets.bottom} animatedStyle={{ position: 'relative' }} />}
  </SafeAreaView>;
}

export const hospitalStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.white },
  column: { flex: 1, maxWidth: 640, width: '100%', alignSelf: 'center' },
  header: { minHeight: 56, paddingHorizontal: 10, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 6, borderBottomWidth: 1, borderColor: COLORS.gray[100] },
  iconButton: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { flex: 1, minWidth: 0, fontSize: 18, lineHeight: 26, fontWeight: '700', color: COLORS.text.primary },
  headerActions: { maxWidth: '48%', flexShrink: 1, flexDirection: 'row', alignItems: 'center' },
  content: { padding: 20, gap: 16 },
  title: { fontSize: 25, lineHeight: 34, fontWeight: '700', letterSpacing: -0.6, color: COLORS.text.primary },
  heading: { fontSize: 19, lineHeight: 28, fontWeight: '700', color: COLORS.text.primary },
  body: { fontSize: 14, lineHeight: 23, color: COLORS.text.secondary },
  caption: { fontSize: 12, lineHeight: 19, color: COLORS.text.secondary },
  ad: { fontSize: 11, lineHeight: 17, color: COLORS.text.secondary, borderWidth: 1, borderColor: COLORS.gray[300], borderRadius: 4, paddingHorizontal: 5, alignSelf: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flexible: { flex: 1, minWidth: 0 },
  chip: { minHeight: 44, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: COLORS.border.light, borderRadius: 22, justifyContent: 'center' },
  selectedChip: { backgroundColor: COLORS.primaryPale, borderColor: COLORS.primary },
  selectedText: { color: COLORS.primaryDark, fontWeight: '700' },
  error: { padding: 16, gap: 8, backgroundColor: COLORS.gray[50], borderRadius: 12 },
  empty: { paddingVertical: 32, gap: 10, alignItems: 'center' },
  separator: { borderBottomWidth: 1, borderBottomColor: COLORS.border.light, paddingBottom: 22 },
});
