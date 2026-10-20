import { Feather } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Image, type ImageSourcePropType, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useReferralAllowance } from '@/hooks/use-referral-allowance';
import { useReferralTree } from '@/hooks/use-referral-tree';
import {
  FC_HOME_MOTION,
  type FcHomeShortcutIcon,
  getFcHomeShortcutIcon,
  getFcHomeShortcutLabel,
  getHomeAllowanceDisplay,
} from '@/lib/fc-home-sections';
import { formatReferralAllowanceKrw } from '@/lib/referral-allowance-display';

const ICONS: Record<FcHomeShortcutIcon, ImageSourcePropType> = {
  profile: require('@/assets/images/fc-home/profile.png'),
  documents: require('@/assets/images/fc-home/documents.png'),
  link: require('@/assets/images/fc-home/link.png'),
  life: require('@/assets/images/fc-home/life.png'),
  nonlife: require('@/assets/images/fc-home/nonlife.png'),
  consent: require('@/assets/images/service-home/insurance.png'),
  appointment: require('@/assets/images/fc-home/appointment.png'),
  referral: require('@/assets/images/fc-home/referral.png'),
  allowance: require('@/assets/images/fc-home/allowance.png'),
  howto: require('@/assets/images/fc-home/howto.png'),
};

export type FcHomeShortcutLink = { href: string; title: string; description?: string };

type Props = {
  links: FcHomeShortcutLink[];
  referralCode: string | null;
  onOpen: (href: string) => void;
  onShareReferral: () => void;
  referralSharing?: boolean;
  onHowTo: () => void;
  /** Wraps each icon tile, e.g. with the shortcut tour zone. */
  renderTile?: (tile: ReactNode, link: FcHomeShortcutLink, index: number) => ReactNode;
};

function ShortcutTile({ icon, label, accessibilityLabel, onPress }: {
  icon: FcHomeShortcutIcon | null;
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const press = (to: number) => {
    scale.value = withTiming(to, { duration: reduceMotion ? 0 : FC_HOME_MOTION.press });
  };
  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => press(0.92)}
      onPressOut={() => press(1)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={styles.tile}
    >
      <Animated.View style={[styles.tileIcon, !icon && styles.tileIconNeutral, iconStyle]}>
        {icon ? (
          <Image source={ICONS[icon]} style={styles.tileImage} accessibilityIgnoresInvertColors />
        ) : (
          <Feather name="grid" size={24} color="#374151" />
        )}
      </Animated.View>
      <Text style={styles.tileLabel} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

function AllowanceCard({ title, onPress }: { title: string; onPress: () => void }) {
  const { statement, isLoading, error } = useReferralAllowance();
  const amount = statement ? formatReferralAllowanceKrw(statement.summary.newPaymentKrw) : null;
  const display = getHomeAllowanceDisplay({ statement, loading: isLoading, error });
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={amount ? `${title}, ${display.caption} ${amount}` : `${title}, ${display.value}`}
      style={({ pressed }) => [styles.widget, pressed && styles.widgetPressed]}
    >
      <View style={styles.widgetHead}>
        <Text style={styles.widgetTitle}>{title}</Text>
        <Feather name="chevron-right" size={16} color="#6b7280" />
      </View>
      <Text style={styles.widgetValue} numberOfLines={1}>{display.value}</Text>
      <View style={styles.widgetFoot}>
        <Text style={[styles.widgetCaption, styles.flex]} numberOfLines={2}>
          {display.caption}
        </Text>
        <Image source={ICONS.allowance} style={styles.widgetGraph} accessibilityIgnoresInvertColors />
      </View>
    </Pressable>
  );
}

function ReferralCard({ title, code, onPress, onShare, sharing = false }: { title: string; code: string | null; onPress: () => void; onShare: () => void; sharing?: boolean }) {
  const { data } = useReferralTree({ depth: 1 });
  const count = data?.root.directInviteeCount ?? data?.descendants.length ?? null;
  const initials = (data?.descendants ?? [])
    .map((node) => node.name?.trim().slice(0, 1))
    .filter((initial): initial is string => Boolean(initial))
    .slice(0, 2);
  const rest = count !== null ? Math.max(0, count - initials.length) : 0;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={count !== null ? `${title}, 추천 ${count}명` : title}
      style={({ pressed }) => [styles.widget, pressed && styles.widgetPressed]}
    >
      <View style={styles.widgetHead}>
        <Text style={styles.widgetTitle}>{title}</Text>
        <Feather name="chevron-right" size={16} color="#6b7280" />
      </View>
      <Text style={styles.widgetValue}>{count !== null ? `${count}명` : ' '}</Text>
      <View style={styles.widgetFoot}>
        <View style={styles.avatars}>
          {initials.map((initial, index) => (
            <View key={`${initial}-${index}`} style={[styles.avatar, index > 0 && styles.avatarOverlap, index === 1 && styles.avatarSecond]}>
              <Text style={styles.avatarText}>{initial}</Text>
            </View>
          ))}
          {rest > 0 ? (
            <View style={[styles.avatar, initials.length > 0 && styles.avatarOverlap, styles.avatarRest]}>
              <Text style={styles.avatarText}>+{rest}</Text>
            </View>
          ) : null}
        </View>
        {code ? (
          <Pressable
            onPress={onShare}
            disabled={sharing}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="추천 코드 공유"
            accessibilityState={{ disabled: sharing, busy: sharing }}
            style={sharing ? styles.widgetActionDisabled : undefined}
          >
            <Text style={styles.widgetAction}>코드 공유</Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

export function FcHomeShortcuts({ links, referralCode, onOpen, onShareReferral, referralSharing = false, onHowTo, renderTile }: Props) {
  const allowance = links.find((link) => link.href === '/referral-allowance');
  const referral = links.find((link) => link.href === '/referral');
  const gridLinks = links.filter((link) => link !== allowance && link !== referral);

  return (
    <View style={styles.card}>
      <View style={styles.sectionTitle}>
        <Image source={require('@/assets/images/fc-home/section-shortcut.png')} style={styles.sectionIcon} accessibilityIgnoresInvertColors />
        <Text style={styles.titleText}>바로가기</Text>
      </View>
      {allowance || referral ? (
        <View style={styles.widgets}>
          {allowance ? <AllowanceCard title="수당" onPress={() => onOpen(allowance.href)} /> : null}
          {referral ? (
            <ReferralCard title="내 추천" code={referralCode} onPress={() => onOpen(referral.href)} onShare={onShareReferral} sharing={referralSharing} />
          ) : null}
        </View>
      ) : null}
      <View style={styles.grid}>
        {gridLinks.map((link, index) => {
          const tile = (
            <ShortcutTile
              icon={getFcHomeShortcutIcon(link.href)}
              label={getFcHomeShortcutLabel(link.href, link.title)}
              accessibilityLabel={link.title}
              onPress={() => onOpen(link.href)}
            />
          );
          return (
            <View key={`${link.href}-${link.title}`} style={styles.cell}>
              {renderTile ? renderTile(tile, link, index) : tile}
            </View>
          );
        })}
        <View style={styles.cell}>
          <ShortcutTile icon="howto" label="사용법" accessibilityLabel="앱 사용법" onPress={onHowTo} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginBottom: 12, paddingTop: 18, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: '#ffffff', borderRadius: 24 },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4, paddingBottom: 12 },
  sectionIcon: { width: 28, height: 28 },
  titleText: { fontSize: 18, fontWeight: '800', color: '#111827' },
  widgets: { flexDirection: 'row', gap: 8, paddingBottom: 12 },
  widget: { flex: 1, gap: 10, padding: 14, borderRadius: 18, backgroundColor: '#f5f6f8' },
  widgetPressed: { backgroundColor: '#eceef1' },
  widgetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  widgetTitle: { fontSize: 13, fontWeight: '700', color: '#4b5563' },
  widgetValue: { fontSize: 19, fontWeight: '800', color: '#111827', letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  widgetCaption: { fontSize: 12, lineHeight: 16, color: '#4b5563' },
  widgetGraph: { width: 46, height: 46, marginVertical: -10, marginRight: -4 },
  flex: { flex: 1 },
  widgetFoot: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 26 },
  widgetAction: { fontSize: 13, fontWeight: '700', color: '#374151' },
  widgetActionDisabled: { opacity: 0.5 },
  avatars: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: '#f5f6f8', backgroundColor: '#e5e7eb', alignItems: 'center', justifyContent: 'center' },
  avatarOverlap: { marginLeft: -8 },
  avatarSecond: { backgroundColor: '#eceef1' },
  avatarRest: { backgroundColor: '#ffffff' },
  avatarText: { fontSize: 11, fontWeight: '800', color: '#374151' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 4 },
  cell: { width: '25%' },
  tile: { alignItems: 'center', gap: 6, paddingVertical: 6 },
  tileIcon: { width: 56, height: 56, borderRadius: 18, backgroundColor: '#fdf3ea', alignItems: 'center', justifyContent: 'center' },
  tileIconNeutral: { backgroundColor: '#f3f4f6' },
  tileImage: { width: 48, height: 48 },
  tileLabel: { fontSize: 13, fontWeight: '500', color: '#111827' },
});
