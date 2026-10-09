import { Feather } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { COLORS } from '@/lib/theme';

import { ServiceIcon, type ServiceName } from './ServiceIcon';

export interface ServiceHomeScreenProps {
  isSignedIn: boolean;
  loading?: boolean;
  canResumeInsurance?: boolean;
  bottomInset: number;
  navigation: ReactNode;
  onAccountPress: () => void;
  onCarePress: () => void;
  onInsurancePress: () => void;
  onTelecomPress: () => void;
  onCarPress: () => void;
  onHelpPress: () => void;
  onResumeInsurancePress: () => void;
}

const inkAccent = COLORS.warning.dark;
function ControlIcon({ name, size = 18, color = COLORS.text.secondary }: {
  name: keyof typeof Feather.glyphMap;
  size?: number;
  color?: string;
}) {
  return <Feather name={name} size={size} color={color} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
}

function PreparationBadge({ children }: { children: string }) {
  return <View style={styles.badge}><Text style={styles.badgeText}>{children}</Text></View>;
}

export default function ServiceHomeScreen({
  isSignedIn, loading = false, canResumeInsurance = false, bottomInset, navigation,
  onAccountPress, onCarePress, onInsurancePress, onTelecomPress, onCarPress,
  onHelpPress, onResumeInsurancePress,
}: ServiceHomeScreenProps) {
  const { width, fontScale } = useWindowDimensions();
  const compact = width <= 360;
  const expandedText = fontScale > 1.25;
  const shortcuts: { service: ServiceName; label: string; status: string; onPress: () => void }[] = [
    { service: 'care', label: '가족간병', status: '출시 준비 중', onPress: onCarePress },
    { service: 'insurance', label: '보험·FC', status: 'FC 전용', onPress: onInsurancePress },
    { service: 'telecom', label: '통신', status: '제휴 준비 중', onPress: onTelecomPress },
    { service: 'car', label: '자동차', status: '제휴 준비 중', onPress: onCarPress },
  ];

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: 110 + Math.max(bottomInset, 12) + 16 * Math.max(fontScale - 1, 0) }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.column}>
          <View style={styles.header}>
            <View style={styles.brand} accessible accessibilityLabel="가람in">
              <Image source={require('@/assets/images/logo.png')} style={styles.logo} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
              <Text style={styles.brandName}>가람in</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isSignedIn ? '내 정보' : '로그인'}
              accessibilityState={{ disabled: loading, busy: loading }}
              disabled={loading}
              onPress={onAccountPress}
              style={({ pressed }) => [styles.account, isSignedIn && styles.signedInAccount, pressed && styles.pressed, loading && styles.disabled]}
            >
              {isSignedIn ? <ControlIcon name="user" color={inkAccent} size={21} /> : <Text style={styles.loginText}>로그인</Text>}
            </Pressable>
          </View>

          <View style={styles.content}>
            <Text accessibilityRole="header" style={[styles.title, compact && styles.compactTitle]}>필요한 서비스를 골라보세요</Text>

            {isSignedIn && canResumeInsurance && (
              <Pressable accessibilityRole="button" accessibilityLabel="보험·FC 업무 이어가기" onPress={onResumeInsurancePress} style={({ pressed }) => [styles.recent, pressed && styles.pressed]}>
                <ControlIcon name="file-text" color={inkAccent} size={22} />
                <View style={styles.rowCopy}>
                  <Text style={styles.recentTitle}>보험·FC 업무 이어가기</Text>
                  <Text style={styles.recentDescription}>시험 · 서류 · 설계 진행 확인</Text>
                </View>
                <ControlIcon name="chevron-right" size={17} />
              </Pressable>
            )}

            <View style={styles.shortcuts}>
              {shortcuts.map(({ service, label, status, onPress }) => (
                <Pressable key={service} accessibilityRole="button" accessibilityLabel={`${label} · ${status}`} onPress={onPress} style={({ pressed }) => [styles.shortcut, pressed && styles.shortcutPressed]}>
                  <ServiceIcon service={service} />
                  <Text style={styles.shortcutLabel}>{label}</Text>
                </Pressable>
              ))}
            </View>

            <View style={[styles.featured, compact && styles.featuredCompact]}>
              <View style={[styles.cardTop, expandedText && styles.wrap]}>
                <ServiceIcon service="care" size={64} />
                <PreparationBadge>출시 준비 중</PreparationBadge>
              </View>
              <Text accessibilityRole="header" style={[styles.featuredTitle, compact && styles.compactFeaturedTitle]}>
                <Text style={styles.headlineAccent}>가족간병,</Text>{'\n'}미리 알아두세요
              </Text>
              <Text style={styles.featuredDescription}>신청 절차와 준비할 정보</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="가족간병 이용 안내 보기" onPress={onCarePress} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
                <Text style={styles.primaryLabel}>이용 안내 보기</Text>
                <ControlIcon name="arrow-right" color={COLORS.text.primary} />
              </Pressable>
            </View>

            <Pressable accessibilityRole="button" accessibilityLabel="보험·FC 업무 · FC 전용 · 시험, 서류, 설계" onPress={onInsurancePress} style={({ pressed }) => [styles.insuranceRow, pressed && styles.pressed]}>
              <ServiceIcon service="insurance" />
              <View style={styles.rowCopy}>
                <Text style={styles.kicker}>FC 전용</Text>
                <Text style={styles.insuranceTitle}>보험·FC 업무</Text>
                <Text style={styles.rowDescription}>시험 · 서류 · 설계</Text>
              </View>
              <ControlIcon name="chevron-right" />
            </Pressable>

            <View style={styles.partners}>
              <View style={[styles.sectionHeading, expandedText && styles.wrap]}>
                <Text accessibilityRole="header" style={styles.sectionTitle}>제휴 서비스</Text>
                <PreparationBadge>준비 중</PreparationBadge>
              </View>
              <View style={[styles.partnerGrid, expandedText && styles.partnerStack]}>
                {shortcuts.slice(2).map(({ service, label, onPress }) => (
                  <Pressable key={service} accessibilityRole="button" accessibilityLabel={`${label} · 제휴 준비 중`} onPress={onPress} style={({ pressed }) => [styles.partner, compact && styles.partnerCompact, pressed && styles.pressed]}>
                    <ServiceIcon service={service} size={32} />
                    <Text style={styles.partnerLabel}>{label}</Text>
                    <ControlIcon name="chevron-right" size={17} />
                  </Pressable>
                ))}
              </View>
            </View>

            <Pressable accessibilityRole="button" accessibilityLabel="이용 안내" onPress={onHelpPress} style={({ pressed }) => [styles.help, pressed && styles.pressed]}>
              <ControlIcon name="help-circle" color={inkAccent} size={19} />
              <Text style={styles.helpLabel}>이용 안내</Text>
              <ControlIcon name="chevron-right" color={inkAccent} size={17} />
            </Pressable>
          </View>
        </View>
      </ScrollView>
      {navigation}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.white },
  scroll: { flex: 1 },
  column: { width: '100%', maxWidth: 480, alignSelf: 'center' },
  header: { minHeight: 72, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: COLORS.gray[100] },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  logo: { width: 40, height: 40, borderRadius: 11, resizeMode: 'contain' },
  brandName: { fontSize: 22, fontWeight: '700', color: COLORS.text.primary, letterSpacing: -0.8, flexShrink: 1 },
  account: { minHeight: 44, minWidth: 44, paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1, borderColor: COLORS.border.light, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  signedInAccount: { backgroundColor: COLORS.primaryPale, borderWidth: 0, paddingHorizontal: 11 },
  loginText: { fontSize: 13, fontWeight: '700', color: COLORS.text.primary },
  content: { paddingHorizontal: 20, paddingTop: 22 },
  title: { fontSize: 22, fontWeight: '600', letterSpacing: -0.75, color: COLORS.text.primary },
  compactTitle: { fontSize: 20 },
  shortcuts: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginHorizontal: -4, marginTop: 22, marginBottom: 25 },
  shortcut: { flex: 1, minWidth: 0, minHeight: 74, paddingHorizontal: 2, alignItems: 'center', gap: 10, borderRadius: 12, paddingBottom: 4 },
  shortcutPressed: { backgroundColor: COLORS.background.secondary },
  shortcutLabel: { fontSize: 13, fontWeight: '500', color: COLORS.text.primary, textAlign: 'center' },
  featured: { padding: 20, marginBottom: 22, backgroundColor: COLORS.primaryPale, borderWidth: 1, borderColor: COLORS.warning.border, borderRadius: 16 },
  featuredCompact: { padding: 17 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  wrap: { flexWrap: 'wrap' },
  badge: { paddingVertical: 3, paddingHorizontal: 8, borderWidth: 1, borderColor: COLORS.warning.border, borderRadius: 6, backgroundColor: COLORS.warning.light, flexShrink: 1 },
  badgeText: { fontSize: 12, fontWeight: '400', color: inkAccent },
  featuredTitle: { fontSize: 29, fontWeight: '500', letterSpacing: -1.2, color: COLORS.text.primary, marginTop: 13, marginBottom: 12 },
  compactFeaturedTitle: { fontSize: 27 },
  headlineAccent: { fontWeight: '800', color: inkAccent, textDecorationLine: 'underline', textDecorationColor: COLORS.warning.border },
  featuredDescription: { fontSize: 14, color: COLORS.text.secondary, marginBottom: 20 },
  primaryButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingHorizontal: 15, paddingVertical: 12, borderRadius: 12, backgroundColor: COLORS.primary },
  primaryLabel: { flexShrink: 1, fontSize: 15, fontWeight: '700', color: COLORS.text.primary, textAlign: 'center' },
  insuranceRow: { minHeight: 98, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 17, borderWidth: 1, borderColor: COLORS.border.light, borderRadius: 16 },
  rowCopy: { flex: 1, minWidth: 0 },
  kicker: { fontSize: 11, fontWeight: '500', color: inkAccent },
  insuranceTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text.primary, marginTop: 3, marginBottom: 4 },
  rowDescription: { fontSize: 13, color: COLORS.text.secondary },
  partners: { marginTop: 23 },
  sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: COLORS.text.primary },
  partnerGrid: { flexDirection: 'row', gap: 12 },
  partnerStack: { flexDirection: 'column' },
  partner: { flex: 1, minHeight: 67, flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 15, paddingHorizontal: 16, backgroundColor: COLORS.background.secondary, borderWidth: 1, borderColor: COLORS.border.light, borderRadius: 16 },
  partnerCompact: { paddingHorizontal: 10, gap: 5 },
  partnerLabel: { flex: 1, fontSize: 15, fontWeight: '600', color: COLORS.text.primary },
  help: { flexDirection: 'row', alignItems: 'center', minHeight: 48, gap: 9, paddingHorizontal: 2, paddingVertical: 7, marginTop: 18 },
  helpLabel: { flex: 1, fontSize: 13, fontWeight: '500', color: inkAccent, textDecorationLine: 'underline' },
  recent: { flexDirection: 'row', alignItems: 'center', gap: 11, minHeight: 63, marginTop: 19, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: COLORS.background.secondary, borderWidth: 1, borderColor: COLORS.border.light, borderRadius: 13 },
  recentTitle: { fontSize: 14, fontWeight: '700', color: COLORS.text.primary },
  recentDescription: { fontSize: 12, color: COLORS.text.secondary, marginTop: 4 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
});
