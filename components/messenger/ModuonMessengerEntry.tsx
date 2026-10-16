import { useQuery } from '@tanstack/react-query';
import { router, usePathname } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ServiceIcon } from '@/components/service-home/ServiceIcon';
import { useToast } from '@/components/Toast';
import { useSession } from '@/hooks/use-session';
import { fetchInternalUnreadCount } from '@/lib/internal-chat-api';
import {
  formatMessengerEntryBadge,
  MODUON_MESSENGER_SERVICES,
  shouldShowMessengerEntry,
  type MessengerEntryService,
} from '@/lib/moduon-messenger-entry';

// Matches the bottom navigation: its content height plus the safe-area pad,
// so the button sits just above it (same formula as the board write button).
const BOTTOM_NAV_HEIGHT = 72;

/**
 * Floating 모두온 messenger entry, rendered once above every screen. It shows
 * on browsing screens only and unfolds the services vertically.
 */
export function ModuonMessengerEntry() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { hydrated, role, residentId, readOnly, staffType, isRequestBoardDesigner, isPlatformSignedIn } = useSession();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);

  // Same key and source as the home badge, so both share one cached count.
  const { data: unreadCount } = useQuery({
    queryKey: ['unread-msg-count', role, residentId, readOnly, staffType, isRequestBoardDesigner],
    queryFn: () => fetchInternalUnreadCount({ role, residentId, readOnly, staffType, isRequestBoardDesigner }),
    enabled: !!role && !!residentId,
  });
  const badge = formatMessengerEntryBadge(unreadCount);

  useEffect(() => { setOpen(false); }, [pathname]);

  const visible = hydrated && (!!role || isPlatformSignedIn) && shouldShowMessengerEntry(pathname);
  const services = useMemo(() => [...MODUON_MESSENGER_SERVICES].reverse(), []);
  if (!visible) return null;

  const bottom = Math.max(insets.bottom, 12) + BOTTOM_NAV_HEIGHT + 12;
  const openService = (service: MessengerEntryService) => {
    if (!service.available) {
      showToast({ message: `${service.label} 대화는 준비 중이에요.`, variant: 'info' });
      return;
    }
    setOpen(false);
    router.push('/messenger');
  };

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {open ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="서비스 목록 닫기"
          onPress={() => setOpen(false)}
          style={[StyleSheet.absoluteFill, styles.scrim]}
        />
      ) : null}
      <View pointerEvents="box-none" style={[styles.stack, { bottom, right: Math.max(insets.right, 16) }]}>
        {open ? (
          <View style={styles.rail} accessibilityLabel="메신저 서비스 목록">
            {services.map((service) => {
              const count = service.key === 'insurance' || service.key === 'moduon' ? badge : '';
              return (
                <Pressable
                  key={service.key}
                  accessibilityRole="button"
                  accessibilityLabel={`${service.label}, ${service.detail}${count ? `, 읽지 않은 메시지 ${count}개` : ''}`}
                  accessibilityState={{ disabled: !service.available }}
                  onPress={() => openService(service)}
                  style={({ pressed }) => [styles.service, !service.available && styles.serviceOff, pressed && styles.pressed]}
                >
                  <View style={styles.serviceText}>
                    <Text style={styles.serviceLabel}>{service.label}</Text>
                    <Text style={styles.serviceDetail}>{service.detail}</Text>
                  </View>
                  {count && service.key === 'insurance' ? (
                    <View style={styles.badge}><Text style={styles.badgeText}>{count}</Text></View>
                  ) : null}
                  <View style={styles.serviceIcon}>
                    {service.key === 'moduon' ? (
                      <Image source={require('@/assets/images/moduon/moduon-symbol.png')} style={styles.symbolSmall} resizeMode="contain" accessible={false} />
                    ) : (
                      <ServiceIcon service={service.key} size={30} />
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`메신저 열기${badge ? `, 읽지 않은 메시지 ${badge}개` : ''}`}
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((current) => !current)}
          style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
        >
          <Image source={require('@/assets/images/moduon/moduon-symbol.png')} style={styles.symbol} resizeMode="contain" accessible={false} />
          {badge ? (
            <View style={[styles.badge, styles.fabBadge]}><Text style={styles.badgeText}>{badge}</Text></View>
          ) : null}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: 'rgba(17,24,39,0.18)' },
  stack: { position: 'absolute', alignItems: 'flex-end', gap: 8 },
  rail: { alignItems: 'flex-end', gap: 6 },
  service: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 12,
    paddingRight: 6,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  serviceOff: { opacity: 0.55 },
  serviceText: { alignItems: 'flex-end' },
  serviceLabel: { fontSize: 13, fontWeight: '700', color: '#111827' },
  serviceDetail: { fontSize: 11, color: '#9CA3AF' },
  serviceIcon: { width: 32, height: 32, borderRadius: 11, backgroundColor: '#FFF0E6', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  symbolSmall: { width: 26, height: 26 },
  fab: {
    width: 58,
    height: 58,
    borderRadius: 22,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  symbol: { width: 38, height: 38 },
  pressed: { opacity: 0.85 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, backgroundColor: '#f36f21', alignItems: 'center', justifyContent: 'center' },
  fabBadge: { position: 'absolute', top: -6, right: -6 },
  badgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
