import type { ServiceName } from '@/components/service-home/ServiceIcon';

// The floating 모두온 messenger entry: a button over the app's browsing screens
// that unfolds the services vertically, like the service rail on the 모두온
// promo site. Only services with a messenger today can be opened.

export type MessengerEntryService = {
  key: 'moduon' | ServiceName;
  label: string;
  detail: string;
  available: boolean;
};

export const MODUON_MESSENGER_SERVICES: readonly MessengerEntryService[] = [
  { key: 'moduon', label: '모두온', detail: '전체 대화', available: true },
  { key: 'insurance', label: '가람in', detail: '보험 · FC 업무', available: true },
  { key: 'care', label: '가족간병', detail: '준비 중', available: false },
  { key: 'telecom', label: '통신', detail: '준비 중', available: false },
  { key: 'rental', label: '렌탈', detail: '준비 중', available: false },
  { key: 'car', label: '자동차', detail: '준비 중', available: false },
  { key: 'hospital', label: '제휴병원', detail: '준비 중', available: false },
];

// Browsing screens only. Sign-in, gates, forms with a keyboard, the messenger
// itself and full-screen viewers stay clear of the button.
const SHOWN_EXACT = new Set(['/', '/board', '/notice', '/settings', '/notifications', '/services/hospitals']);
const HIDDEN_SERVICE_PAGES = new Set(['/services/login', '/services/signup', '/services/application', '/services/account', '/services/manage']);

export function shouldShowMessengerEntry(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (SHOWN_EXACT.has(path)) return true;
  if (path.startsWith('/services/')) return !HIDDEN_SERVICE_PAGES.has(path);
  return false;
}

/** Badge text for the floating button: nothing for 0, "99+" above 99. */
export function formatMessengerEntryBadge(count: number | null | undefined): string {
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return '';
  return count > 99 ? '99+' : String(Math.floor(count));
}
