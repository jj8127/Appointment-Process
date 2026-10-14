import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { type ReactNode } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { COLORS } from '@/lib/theme';
import ModuonBrand from '@/components/ModuonBrand';

import { ServiceIcon, type ServiceName } from './ServiceIcon';
import { useServicePromotionPager } from './useServicePromotionPager';

export interface ServiceHomeScreenProps {
  isSignedIn: boolean;
  accountName?: string;
  loading?: boolean;
  canResumeInsurance?: boolean;
  bottomInset: number;
  navigation: ReactNode;
  onAccountPress: () => void;
  onLogoutPress: () => void;
  onCarePress: () => void;
  onInsurancePress: () => void;
  onTelecomPress: () => void;
  onCarPress: () => void;
  onRentalPress: () => void;
  onHospitalPress: () => void;
  onHelpPress: () => void;
  onResumeInsurancePress: () => void;
}

function ControlIcon({ name, size = 18, color = COLORS.text.secondary }: {
  name: keyof typeof Feather.glyphMap;
  size?: number;
  color?: string;
}) {
  return <Feather aria-hidden name={name} size={size} color={color} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
}

export default function ServiceHomeScreen({
  isSignedIn, accountName, loading = false, canResumeInsurance = false, bottomInset, navigation,
  onAccountPress, onLogoutPress, onCarePress, onInsurancePress, onTelecomPress, onCarPress, onRentalPress, onHospitalPress,
  onHelpPress, onResumeInsurancePress,
}: ServiceHomeScreenProps) {
  const { width, fontScale } = useWindowDimensions();
  const compact = width <= 360;
  const name = isSignedIn ? accountName?.trim() : '';
  const accountLabel = loading ? '로그인 상태 확인 중' : isSignedIn ? `${name ? `${name}님 · ` : ''}내 정보` : '로그인';
  const bannerWidth = Math.max(1, Math.min(width, 480) - 40);
  const resumeInsurance = isSignedIn && canResumeInsurance;
  const services: { service: ServiceName; label: string; status: string; onPress: () => void }[] = [
    { service: 'care', label: '가족간병', status: '준비 중', onPress: onCarePress },
    { service: 'insurance', label: '보험', status: 'FC 업무', onPress: resumeInsurance ? onResumeInsurancePress : onInsurancePress },
    { service: 'telecom', label: '통신', status: '준비 중', onPress: onTelecomPress },
    { service: 'rental', label: '렌탈', status: '준비 중', onPress: onRentalPress },
    { service: 'car', label: '자동차', status: '준비 중', onPress: onCarPress },
    { service: 'hospital', label: '제휴병원', status: '지역별 안내', onPress: onHospitalPress },
  ];
  const slides = [
    { ...services[0], image: require('@/assets/images/service-home/banners/care.png'), title: '가족간병,\n시작 전 안내', description: '이용 전 절차를 확인하세요', action: '가족간병 알아보기' },
    { ...services[1], image: require('@/assets/images/service-home/banners/insurance.png'), title: '가람in 보험,\nFC 업무를 편리하게', description: '보험 상담 서비스는 준비 중이에요', action: resumeInsurance ? 'FC 업무로 이동' : '보험 서비스 보기' },
    { ...services[2], image: require('@/assets/images/service-home/banners/telecom.png'), title: '통신 서비스,\n곧 만나요', description: '새로운 제휴를 준비 중이에요', action: '준비 상태 보기' },
    { ...services[4], image: require('@/assets/images/service-home/banners/car.png'), title: '자동차 서비스,\n곧 만나요', description: '새로운 제휴를 준비 중이에요', action: '준비 상태 보기' },
  ];
  const carousel = useServicePromotionPager(slides.length, fontScale);
  const { pager, pageWidth, setPageWidth, page } = carousel;
  const loopSlides = [slides[slides.length - 1], ...slides, slides[0]];
  const bannerHeight = Math.round((pageWidth || bannerWidth) * 0.75 * Math.max(1, fontScale) + 96 * Math.max(0, fontScale - 1));

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: 110 + Math.max(bottomInset, 12) + 16 * Math.max(fontScale - 1, 0) }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.column}>
          <View style={[styles.header, fontScale > 1.35 && styles.expandedHeader]}>
            <ModuonBrand />
            <View style={[styles.accountControls, fontScale > 1.35 && styles.expandedAccountControls]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={accountLabel}
              accessibilityState={{ disabled: loading, busy: loading }}
              disabled={loading}
              onPress={onAccountPress}
              style={({ pressed }) => [styles.account, pressed && styles.pressed, loading && styles.disabled]}
            >
              <ControlIcon name="user" size={18} />
              <Text numberOfLines={1} style={styles.loginText}>{loading ? '확인 중' : isSignedIn ? '내 정보' : '로그인'}</Text>
            </Pressable>
            {isSignedIn && !loading ? <Pressable accessibilityRole="button" accessibilityLabel="로그아웃"
              onPress={onLogoutPress} style={({ pressed }) => [styles.account, pressed && styles.pressed]}>
              <Text numberOfLines={1} style={styles.loginText}>로그아웃</Text>
            </Pressable> : null}
            </View>
          </View>

          <View style={styles.content}>
            <Text accessibilityRole="header" style={[styles.title, compact && styles.compactTitle]}>{'좋은 서비스,\n함께 누리는 혜택'}</Text>
            <View style={styles.services}>
              {services.map(({ service, label, status, onPress }) => (
                <Pressable key={service} accessibilityRole="button" accessibilityLabel={`${label} · ${status}`} onPress={onPress} style={({ pressed }) => [styles.serviceEntry, pressed && styles.shortcutPressed]}>
                  <View style={styles.serviceArtwork}><ServiceIcon service={service} size={56} /></View>
                  <Text style={styles.serviceLabel}>{label}</Text>
                  <Text style={styles.serviceStatus}>{status}</Text>
                </Pressable>
              ))}
            </View>
            <View ref={carousel.webSurface} style={styles.carousel} onLayout={(event) => setPageWidth(event.nativeEvent.layout.width)}>

              <ScrollView
                ref={pager} horizontal pagingEnabled={Platform.OS !== 'web'} snapToInterval={Platform.OS === 'web' ? undefined : pageWidth || undefined} disableIntervalMomentum decelerationRate="fast"
                showsHorizontalScrollIndicator={false} scrollEventThrottle={16}
                onScroll={(event) => carousel.trackPage(event.nativeEvent.contentOffset.x)}
                onScrollBeginDrag={carousel.beginDrag}
                onScrollEndDrag={(event) => carousel.endDrag(event.nativeEvent.contentOffset.x)}
                onMomentumScrollEnd={(event) => carousel.settlePage(event.nativeEvent.contentOffset.x)}
                accessibilityLabel="제휴 서비스 소개" accessibilityRole={Platform.OS === 'web' ? undefined : 'adjustable'}
                role={Platform.OS === 'web' ? 'region' : undefined}
                accessibilityValue={{ min: 1, max: slides.length, now: page + 1, text: `${slides[page].label}, ${page + 1}/${slides.length}` }}
                accessibilityActions={[{ name: 'increment', label: '다음 서비스' }, { name: 'decrement', label: '이전 서비스' }]}
                onAccessibilityAction={(event) => {
                  if (event.nativeEvent.actionName === 'increment') carousel.move(1);
                  if (event.nativeEvent.actionName === 'decrement') carousel.move(-1);
                }}
              >
                {loopSlides.map((slide, index) => (
                  <Pressable key={`${slide.service}-${index}`} accessibilityRole="button" accessible={index > 0 && index < loopSlides.length - 1} accessibilityLabel={index > 0 && index < loopSlides.length - 1 ? `${slide.label} · ${slide.action}` : undefined} disabled={index !== carousel.physicalPage || index === 0 || index === loopSlides.length - 1} tabIndex={index === carousel.physicalPage && index > 0 && index < loopSlides.length - 1 ? 0 : -1}
                    onPressIn={carousel.pressIn} onPressOut={carousel.pressOut} onPress={() => { if (carousel.canOpen()) slide.onPress(); }}
                    style={({ pressed }) => [styles.slide, { width: pageWidth || bannerWidth, height: bannerHeight }, pressed && styles.pressed]}
                    aria-hidden={index !== carousel.physicalPage || index === 0 || index === loopSlides.length - 1} accessibilityElementsHidden={index !== carousel.physicalPage || index === 0 || index === loopSlides.length - 1} importantForAccessibility={index === carousel.physicalPage && index > 0 && index < loopSlides.length - 1 ? 'auto' : 'no-hide-descendants'}>
                    <View pointerEvents="none" style={StyleSheet.absoluteFillObject}><Image source={slide.image} resizeMode="cover" style={styles.campaignImage} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" /></View>
                    <LinearGradient colors={['rgba(0,0,0,0.5)', 'rgba(0,0,0,0.04)', 'rgba(0,0,0,0.76)']} locations={[0, 0.5, 1]} style={styles.campaignShade} pointerEvents="none" accessible={false} />
                    <Text accessibilityRole="header" style={[styles.bannerTitle, compact && styles.compactBannerTitle]}>{slide.title}</Text>
                    <View style={[styles.campaignCopy, fontScale > 1.25 && styles.expandedCampaignCopy]}>
                      <Text style={styles.description}>{slide.description}</Text>
                      <View style={styles.bannerAction}>
                        <Text style={styles.bannerActionLabel}>{slide.action}</Text><ControlIcon name="arrow-right" size={16} color={COLORS.white} />
                      </View>
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
              <View style={styles.autoplayControl}>
                <View style={styles.pagerSurface} pointerEvents="none" accessible={false} />
                <Pressable accessibilityRole="button" accessibilityLabel={carousel.paused || carousel.reduceMotion !== false ? '배너 자동 넘김 재생' : '배너 자동 넘김 일시정지'} accessibilityState={{ disabled: carousel.reduceMotion !== false }} disabled={carousel.reduceMotion !== false} hitSlop={6} onPress={carousel.togglePaused} style={({ pressed }) => [styles.pagerButton, pressed && styles.pressed]}>
                  <ControlIcon name={carousel.paused || carousel.reduceMotion !== false ? 'play' : 'pause'} size={14} color={COLORS.white} />
                </Pressable>
              </View>
              <View style={styles.pagerControls}>
                <View style={styles.pagerSurface} pointerEvents="none" accessible={false} />
                <Pressable accessibilityRole="button" accessibilityLabel="이전 서비스 소개" hitSlop={6} onPress={() => carousel.move(-1)} style={({ pressed }) => [styles.pagerButton, pressed && styles.pressed]}><ControlIcon name="chevron-left" size={14} color={COLORS.white} /></Pressable>
                <Text accessibilityLiveRegion="polite" style={styles.pageCount}>{page + 1} / {slides.length}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="다음 서비스 소개" hitSlop={6} onPress={() => carousel.move(1)} style={({ pressed }) => [styles.pagerButton, pressed && styles.pressed]}><ControlIcon name="chevron-right" size={14} color={COLORS.white} /></Pressable>
              </View>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="이용 안내" onPress={onHelpPress} style={({ pressed }) => [styles.help, pressed && styles.pressed]}>
              <ControlIcon name="help-circle" size={19} />
              <Text style={styles.helpLabel}>이용 안내</Text>
              <ControlIcon name="chevron-right" size={17} />
            </Pressable>
          </View>
        </View>
      </ScrollView>
      {navigation}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background.tertiary },
  scroll: { flex: 1 },
  column: { width: '100%', maxWidth: 480, alignSelf: 'center', backgroundColor: COLORS.white },
  header: { minHeight: 72, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 20, paddingVertical: 12, backgroundColor: COLORS.white },
  expandedHeader: { flexWrap: 'wrap' },
  accountControls: { maxWidth: '60%', marginLeft: 'auto', flexShrink: 0, flexDirection: 'row', gap: 2, alignItems: 'center' },
  expandedAccountControls: { maxWidth: '100%' },
  account: { minHeight: 44, minWidth: 44, flexDirection: 'row', gap: 5, paddingHorizontal: 6, paddingVertical: 6, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  loginText: { fontSize: 13, fontWeight: '500', color: COLORS.text.secondary },
  content: { paddingHorizontal: 20, paddingTop: 26, paddingBottom: 20, backgroundColor: COLORS.background.tertiary, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  title: { fontSize: 24, lineHeight: 32, fontWeight: '800', letterSpacing: -0.9, color: COLORS.text.primary, marginBottom: 18 },
  compactTitle: { fontSize: 21, lineHeight: 29 },
  services: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch', rowGap: 8, marginBottom: 20 },
  serviceEntry: { width: '33.333%', minWidth: 0, alignItems: 'center', paddingVertical: 2, paddingHorizontal: 1, borderRadius: 12 },
  serviceArtwork: { width: 64, height: 56, alignItems: 'center', justifyContent: 'center' },
  serviceLabel: { fontSize: 14, fontWeight: '700', color: COLORS.text.primary, textAlign: 'center', letterSpacing: -0.4 },
  serviceStatus: { fontSize: 12, lineHeight: 17, color: COLORS.text.secondary, textAlign: 'center', marginTop: 3 },
  shortcutPressed: { backgroundColor: COLORS.background.secondary },
  carousel: { width: '100%', overflow: 'hidden', borderRadius: 10, backgroundColor: COLORS.gray[100] },
  slide: { position: 'relative', padding: 20, justifyContent: 'flex-start', backgroundColor: COLORS.gray[800] },
  campaignImage: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  campaignShade: { ...StyleSheet.absoluteFillObject },
  bannerTitle: { userSelect: 'none', fontSize: 32, lineHeight: 38, fontWeight: '800', letterSpacing: -1.1, color: COLORS.white, textShadowColor: 'rgba(0,0,0,0.22)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  compactBannerTitle: { fontSize: 28, lineHeight: 34 },
  campaignCopy: { position: 'absolute', bottom: 18, left: 18, right: 124 },
  expandedCampaignCopy: { bottom: 62, right: 18 },
  description: { userSelect: 'none', fontSize: 15, lineHeight: 21, fontWeight: '700', color: COLORS.white, letterSpacing: -0.5 },
  bannerAction: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  bannerActionLabel: { userSelect: 'none', flexShrink: 1, fontSize: 13, lineHeight: 19, fontWeight: '500', color: COLORS.white },
  autoplayControl: { position: 'absolute', right: 6, top: 6, height: 44, width: 44, padding: 6, alignItems: 'center', justifyContent: 'center' },
  pagerControls: { position: 'absolute', right: 6, bottom: 6, height: 44, padding: 6, flexDirection: 'row', alignItems: 'center' },
  pagerSurface: { position: 'absolute', top: 6, bottom: 6, left: 6, right: 6, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.34)' },
  pagerButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  pageCount: { userSelect: 'none', fontSize: 12, fontWeight: '600', color: COLORS.white, minWidth: 32, textAlign: 'center' },
  help: { flexDirection: 'row', alignItems: 'center', minHeight: 48, gap: 9, paddingHorizontal: 2, paddingVertical: 7, marginTop: 20 },
  helpLabel: { flex: 1, fontSize: 13, color: COLORS.text.secondary },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
});
