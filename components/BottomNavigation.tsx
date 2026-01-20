import { Feather } from '@expo/vector-icons';
import { useRouter, usePathname } from 'expo-router';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { COLORS, SHADOWS } from '@/lib/theme';

/** 네비게이션 아이템 정의 */
export interface NavItem {
  key: string;
  label: string;
  icon: keyof typeof Feather.glyphMap;
  route?: string;
  onPress?: () => void;
}

/** 역할별 네비게이션 프리셋 */
export type NavPreset = 'fc' | 'admin-onboarding' | 'admin-exam' | 'manager';

/** FC 사용자 네비게이션 */
const FC_NAV_ITEMS: NavItem[] = [
  { key: 'home', label: '홈', icon: 'home', route: '/' },
  { key: 'board', label: '게시판', icon: 'clipboard', route: '/board' },
  { key: 'notice', label: '공지', icon: 'bell', route: '/notice' },
  { key: 'settings', label: '설정', icon: 'settings', route: '/settings' },
];

/** 관리자 위촉 탭 네비게이션 */
const ADMIN_ONBOARDING_NAV_ITEMS: NavItem[] = [
  { key: 'onboarding', label: '위촉 홈', icon: 'home' },
  { key: 'exam', label: '시험 홈', icon: 'book-open' },
  { key: 'board', label: '게시판', icon: 'clipboard', route: '/admin-board-manage' },
  { key: 'notice', label: '공지', icon: 'bell', route: '/admin-notice' },
];

/** 관리자 시험 탭 네비게이션 */
const ADMIN_EXAM_NAV_ITEMS: NavItem[] = [
  { key: 'onboarding', label: '위촉 홈', icon: 'home' },
  { key: 'exam', label: '시험 홈', icon: 'book-open' },
  { key: 'board', label: '게시판', icon: 'clipboard', route: '/admin-board-manage' },
  { key: 'notice', label: '공지', icon: 'bell', route: '/admin-notice' },
];

/** 본부장 네비게이션 (FC와 유사, 읽기 전용) */
const MANAGER_NAV_ITEMS: NavItem[] = [
  { key: 'home', label: '홈', icon: 'home', route: '/' },
  { key: 'board', label: '게시판', icon: 'clipboard', route: '/admin-board-manage' },
  { key: 'notice', label: '공지', icon: 'bell', route: '/notice' },
  { key: 'settings', label: '설정', icon: 'settings', route: '/settings' },
];

const NAV_PRESETS: Record<NavPreset, NavItem[]> = {
  fc: FC_NAV_ITEMS,
  'admin-onboarding': ADMIN_ONBOARDING_NAV_ITEMS,
  'admin-exam': ADMIN_EXAM_NAV_ITEMS,
  manager: MANAGER_NAV_ITEMS,
};

interface BottomNavigationProps {
  /** 역할별 프리셋 사용 */
  preset?: NavPreset;
  /** 커스텀 아이템 (preset 대신 사용) */
  items?: NavItem[];
  /** 현재 활성화된 아이템 키 */
  activeKey: string;
  /** useBottomNavAnimation에서 반환된 animatedStyle */
  animatedStyle?: ViewStyle;
  /** SafeArea bottom inset */
  bottomInset?: number;
  /** 관리자 탭 전환 핸들러 */
  onAdminTabChange?: (tab: 'onboarding' | 'exam') => void;
}

/**
 * 재사용 가능한 하단 네비게이션 컴포넌트
 *
 * @example
 * ```tsx
 * // FC 화면에서 사용
 * <BottomNavigation
 *   preset="fc"
 *   activeKey="board"
 *   animatedStyle={animatedStyle}
 *   bottomInset={insets.bottom}
 * />
 *
 * // 관리자 화면에서 탭 전환과 함께 사용
 * <BottomNavigation
 *   preset={adminTab === 'exam' ? 'admin-exam' : 'admin-onboarding'}
 *   activeKey={adminTab}
 *   onAdminTabChange={setAdminTab}
 *   animatedStyle={animatedStyle}
 *   bottomInset={insets.bottom}
 * />
 * ```
 */
export function BottomNavigation({
  preset,
  items,
  activeKey,
  animatedStyle,
  bottomInset = 0,
  onAdminTabChange,
}: BottomNavigationProps) {
  const router = useRouter();
  const pathname = usePathname();
  const navItems = items ?? (preset ? NAV_PRESETS[preset] : []);

  const handlePress = (item: NavItem) => {
    if (item.onPress) {
      item.onPress();
      return;
    }

    // 관리자 탭 전환
    if (onAdminTabChange && (item.key === 'onboarding' || item.key === 'exam')) {
      onAdminTabChange(item.key);
      return;
    }

    // 라우팅
    if (item.route) {
      // 현재 페이지면 무시
      if (pathname === item.route) return;
      router.push(item.route as any);
    }
  };

  if (navItems.length === 0) return null;

  return (
    <Animated.View
      style={[
        styles.bottomNav,
        { paddingBottom: Math.max(bottomInset, 12) },
        animatedStyle,
      ]}
    >
      {navItems.map((item) => {
        const isActive = activeKey === item.key;
        return (
          <Pressable
            key={item.key}
            style={({ pressed }) => [
              styles.navItem,
              pressed && styles.navItemPressed,
            ]}
            onPress={() => handlePress(item)}
          >
            <View style={[styles.iconWrap, isActive && styles.iconWrapActive]}>
              <Feather
                name={item.icon}
                size={20}
                color={isActive ? '#fff' : COLORS.primary}
              />
            </View>
            <Text style={[styles.label, isActive && styles.labelActive]}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bottomNav: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border.light,
    ...SHADOWS.md,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 3,
  },
  navItemPressed: {
    opacity: 0.7,
  },
  iconWrap: {
    width: 30,
    height: 30,
    borderRadius: 22,
    backgroundColor: 'rgba(243,111,33,0.08)',
    borderWidth: 1.5,
    borderColor: 'rgba(243,111,33,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  label: {
    fontSize: 13,
    color: COLORS.text.muted,
    fontWeight: '700',
  },
  labelActive: {
    color: COLORS.gray[900],
  },
});
