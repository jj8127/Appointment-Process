import { MaterialIcons } from '@expo/vector-icons';
import { Stack, router } from 'expo-router';
import type { ReactElement, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomNavigation } from '@/components/BottomNavigation';
import { useSession } from '@/hooks/use-session';
import { goBackOrReplace } from '@/lib/back-navigation';
import { resolveBottomNavPreset } from '@/lib/bottom-navigation';
import { CARE_STATUS_TONES } from '@/lib/hospital-care';
import { CARE_REQUEST_STATUSES } from '@/lib/platform-api';
import { COLORS } from '@/lib/theme';

export { IconTile } from '@/components/SelectionControls';

/** Same label and tone for a care status on the member and staff screens. */
export function CareStatusBadge({ status }: { status: keyof typeof CARE_REQUEST_STATUSES }) {
  const tone = CARE_STATUS_TONES[status];
  return <View style={[hospitalStyles.badge, { backgroundColor: tone.bg }]}>
    <View style={[hospitalStyles.badgeDot, { backgroundColor: tone.fg }]} />
    <Text style={[hospitalStyles.badgeText, { color: tone.fg }]}>{CARE_REQUEST_STATUSES[status]}</Text>
  </View>;
}

export default function HospitalScreen({ children, detail = false, overlayHeader = false, overlaySolid = false, solidTitle, title, headerActions, footer }: {
  children: ReactNode; detail?: boolean; overlayHeader?: boolean; title?: string; headerActions?: ReactElement; footer?: ReactNode;
  /** Once the cover photo has scrolled away, the floating back button becomes a solid bar so content never slides under it. */
  overlaySolid?: boolean; solidTitle?: string;
}) {
  const session = useSession();
  const heading = title ?? (detail ? '병원 상세' : '제휴병원');
  const insets = useSafeAreaInsets();
  const preset = resolveBottomNavPreset(session, { surface: 'service-hub' });
  const back = <Pressable accessibilityRole="button" accessibilityLabel="뒤로 가기" style={overlayHeader && !overlaySolid ? hospitalStyles.floatingBack : hospitalStyles.iconButton}
    onPress={() => goBackOrReplace(router, detail ? '/services/hospitals' : '/')}>
    <MaterialIcons name="arrow-back" size={24} color={COLORS.text.primary} accessible={false} />
  </Pressable>;
  return <SafeAreaView style={hospitalStyles.screen} edges={['top', 'left', 'right']}>
    <Stack.Screen options={{ headerShown: false, title: heading }} />
    <View style={hospitalStyles.column}>
      {overlayHeader ? <View style={overlaySolid ? [hospitalStyles.header, hospitalStyles.solidHeader] : hospitalStyles.overlayHeader}>
        {back}
        {overlaySolid && <Text accessibilityRole="header" numberOfLines={1} style={hospitalStyles.headerTitle}>{solidTitle ?? heading}</Text>}
      </View> : <View style={hospitalStyles.header}>
        {back}
        <Text accessibilityRole="header" style={hospitalStyles.headerTitle}>{heading}</Text>
        {headerActions && <View style={hospitalStyles.headerActions}>{headerActions}</View>}
      </View>}
      {children}
      {footer ? <View style={[hospitalStyles.footer, !preset && { paddingBottom: 12 + insets.bottom }]}>{footer}</View> : null}
    </View>
    {preset && <BottomNavigation preset={preset} activeKey="home" bottomInset={insets.bottom} animatedStyle={{ position: 'relative' }} />}
  </SafeAreaView>;
}

// Type scale: display 26 · section 19 · body 16 · caption 13 (no screen text below 13).
export const hospitalStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.white },
  column: { flex: 1, maxWidth: 640, width: '100%', alignSelf: 'center' },
  header: { minHeight: 56, paddingHorizontal: 8, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 4 },
  overlayHeader: { position: 'absolute', top: 8, left: 12, zIndex: 2 },
  solidHeader: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2, backgroundColor: COLORS.white, borderBottomWidth: 1, borderBottomColor: COLORS.gray[100] },
  floatingBack: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.95)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.18, shadowRadius: 6, elevation: 3 },
  iconButton: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { flex: 1, minWidth: 0, fontSize: 18, lineHeight: 26, fontWeight: '700', letterSpacing: -0.3, color: COLORS.text.primary },
  headerActions: { maxWidth: '48%', flexShrink: 1, flexDirection: 'row', alignItems: 'center' },
  footer: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, backgroundColor: COLORS.white, borderTopWidth: 1, borderTopColor: COLORS.gray[100] },
  content: { padding: 20, gap: 16 },
  title: { fontSize: 26, lineHeight: 34, fontWeight: '800', letterSpacing: -0.8, color: COLORS.text.primary },
  heading: { fontSize: 19, lineHeight: 27, fontWeight: '700', letterSpacing: -0.4, color: COLORS.text.primary },
  body: { fontSize: 16, lineHeight: 26, color: COLORS.text.secondary },
  caption: { fontSize: 13, lineHeight: 19, color: COLORS.gray[500] },
  ad: { fontSize: 12, lineHeight: 16, color: COLORS.text.secondary, borderWidth: 1, borderColor: COLORS.gray[300], borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start', overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flexible: { flex: 1, minWidth: 0 },
  chip: { minHeight: 44, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: COLORS.border.light, borderRadius: 22, justifyContent: 'center' },
  selectedChip: { backgroundColor: COLORS.primaryPale, borderColor: COLORS.primary },
  selectedText: { color: COLORS.primaryDark, fontWeight: '700' },
  error: { padding: 16, gap: 8, backgroundColor: COLORS.gray[50], borderRadius: 14 },
  empty: { paddingVertical: 32, gap: 10, alignItems: 'center' },
  separator: { borderBottomWidth: 1, borderBottomColor: COLORS.border.light, paddingBottom: 22 },
  band: { height: 10, backgroundColor: COLORS.gray[100] },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  badgeDot: { width: 7, height: 7, borderRadius: 4 },
  badgeText: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
});
