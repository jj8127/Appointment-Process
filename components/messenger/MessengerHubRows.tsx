import { Feather } from '@expo/vector-icons';
import { memo, useRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import BrandedLoadingSpinner from '@/components/BrandedLoadingSpinner';
import {
  MESSENGER_PERSON_ROLE_LABELS,
  type MessengerHubConversation,
  type MessengerHubPerson,
  type MessengerPersonRole,
  type MessengerPersonRoleFilter,
} from '@/lib/messenger-hub-model';

const ACCENT = '#f36f21';

const avatarText = (name: string) => name.replace(/\s+/g, '').charAt(0) || '메';
const badgeText = (count: number) => count > 99 ? '99+' : String(count);

const ROLE_TONES: Record<MessengerPersonRole, { line: string; avatar: string; text: string; badge: string }> = {
  operations: { line: '#168A8A', avatar: '#E7F7F6', text: '#0F6969', badge: '#D6F0EE' },
  manager: { line: '#D97706', avatar: '#FFF1DD', text: '#A85300', badge: '#FDE6C2' },
  designer: { line: '#2563EB', avatar: '#EAF1FF', text: '#1D4ED8', badge: '#DCE8FF' },
  developer: { line: '#7C3AED', avatar: '#F0E9FF', text: '#6431C5', badge: '#E7DBFF' },
  fc: { line: '#64748B', avatar: '#EEF2F6', text: '#475569', badge: '#E2E8F0' },
  other: { line: '#94A3B8', avatar: '#F1F5F9', text: '#64748B', badge: '#E2E8F0' },
};

const ROLE_FILTERS: { key: MessengerPersonRoleFilter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'operations', label: '총무' },
  { key: 'manager', label: '본부장' },
  { key: 'designer', label: '설계 매니저' },
  { key: 'developer', label: '개발자' },
];

export function MessengerHubHeader({
  onBack,
  onSearch,
  onFilter,
  filterActive = false,
  filterExpanded = false,
}: {
  onBack: () => void;
  onSearch: () => void;
  onFilter?: () => void;
  filterActive?: boolean;
  filterExpanded?: boolean;
}) {
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="뒤로 가기"
        hitSlop={4}
        onPress={onBack}
        style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
      >
        <Feather name="arrow-left" size={24} color="#111827" />
      </Pressable>
      <Text style={styles.title}>메신저</Text>
      <View style={styles.headerActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="메신저 검색"
          hitSlop={4}
          onPress={onSearch}
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
        >
          <Feather name="search" size={22} color="#111827" />
        </Pressable>
        {onFilter ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={filterActive ? '역할 필터, 적용됨' : '역할 필터'}
            accessibilityState={{ expanded: filterExpanded }}
            hitSlop={4}
            onPress={onFilter}
            style={({ pressed }) => [styles.headerButton, filterActive && styles.headerButtonActive, pressed && styles.pressed]}
          >
            <Feather name="sliders" size={20} color={filterActive ? ACCENT : '#111827'} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export const MessengerHubPersonRow = memo(function MessengerHubPersonRow({
  item,
  onPress,
}: {
  item: MessengerHubPerson;
  onPress: (item: MessengerHubPerson) => void;
}) {
  const tone = ROLE_TONES[item.role];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.name}, ${item.detail}`}
      onPress={() => onPress(item)}
      style={({ pressed }) => [styles.row, styles.personRow, pressed && styles.rowPressed]}
    >
      <View style={[styles.personRoleLine, { backgroundColor: tone.line }]} />
      <View style={[styles.avatar, { backgroundColor: tone.avatar }]}><Text style={[styles.avatarText, { color: tone.text }]}>{avatarText(item.name)}</Text></View>
      <View style={styles.body}>
        <View style={styles.nameLine}>
          <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
          <View style={[styles.roleBadge, { backgroundColor: tone.badge }]}>
            <Text style={[styles.roleBadgeText, { color: tone.text }]}>{MESSENGER_PERSON_ROLE_LABELS[item.role]}</Text>
          </View>
        </View>
        <Text style={styles.detail} numberOfLines={1}>{item.detail}</Text>
      </View>
      <Feather name="chevron-right" size={18} color="#9CA3AF" />
    </Pressable>
  );
});

export const MessengerRoleSectionHeader = memo(function MessengerRoleSectionHeader({
  role,
  title,
  count,
  expanded,
  onToggle,
}: {
  role: MessengerPersonRole;
  title: string;
  count: number;
  expanded: boolean;
  onToggle: (role: MessengerPersonRole) => void;
}) {
  const tone = ROLE_TONES[role];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title} ${count}명 ${expanded ? '접기' : '펼치기'}`}
      accessibilityState={{ expanded }}
      onPress={() => onToggle(role)}
      style={({ pressed }) => [styles.sectionHeader, pressed && styles.sectionHeaderPressed]}
    >
      <View style={[styles.sectionDot, { backgroundColor: tone.line }]} />
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionCount}>{count}</Text>
      <Feather name={expanded ? 'chevron-down' : 'chevron-right'} size={18} color="#94A3B8" />
    </Pressable>
  );
});

export function MessengerRoleFilterPanel({
  value,
  onChange,
}: {
  value: MessengerPersonRoleFilter;
  onChange: (value: MessengerPersonRoleFilter) => void;
}) {
  return (
    <View style={styles.filterPanel} accessibilityLabel="사람 역할 필터">
      {ROLE_FILTERS.map((filter) => {
        const active = value === filter.key;
        return (
          <Pressable
            key={filter.key}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(filter.key)}
            style={({ pressed }) => [styles.filterChip, active && styles.filterChipActive, pressed && styles.filterChipPressed]}
          >
            <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{filter.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export const MessengerHubConversationRow = memo(function MessengerHubConversationRow({
  item,
  onPress,
  onLongPress,
  onToggleMuted,
  muting = false,
}: {
  item: MessengerHubConversation;
  onPress: (item: MessengerHubConversation) => void;
  onLongPress?: (item: MessengerHubConversation) => void;
  onToggleMuted?: (item: MessengerHubConversation) => void;
  muting?: boolean;
}) {
  const formattedTime = formatConversationTime(item.timestamp);
  const suppressNextPressRef = useRef(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.name} 대화${item.muted ? ', 알림 꺼짐' : ''}${item.unreadCount > 0 ? `, 읽지 않은 메시지 ${item.unreadCount}개` : ''}`}
      accessibilityHint={onLongPress ? '길게 누르면 채팅방 설정을 엽니다.' : undefined}
      delayLongPress={380}
      onLongPress={onLongPress ? () => {
        suppressNextPressRef.current = true;
        onLongPress(item);
      } : undefined}
      onPress={() => {
        if (suppressNextPressRef.current) {
          suppressNextPressRef.current = false;
          return;
        }
        onPress(item);
      }}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.avatar}><Text style={styles.avatarText}>{avatarText(item.name)}</Text></View>
      <View style={styles.body}>
        <View style={styles.nameLine}>
          <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.source}>{item.sourceLabel}</Text>
        </View>
        <Text style={styles.preview} numberOfLines={1}>{item.preview}</Text>
      </View>
      <View style={styles.meta}>
        <View style={styles.timeLine}>
          {item.pinnedAt ? <Feather name="bookmark" size={14} color={ACCENT} /> : null}
          {onToggleMuted ? (
            <Pressable
              accessibilityLabel={item.muted ? '이 대화방 알림 켜기' : '이 대화방 알림 끄기'}
              accessibilityRole="button"
              accessibilityState={{ busy: muting, checked: !item.muted }}
              disabled={muting}
              hitSlop={8}
              onPress={(event) => {
                event.stopPropagation();
                onToggleMuted(item);
              }}
              style={({ pressed }) => [
                styles.muteButton,
                item.muted ? styles.muteButtonMuted : styles.muteButtonActive,
                pressed && !muting && styles.muteButtonPressed,
              ]}
            >
              <View style={styles.muteButtonContent}>
                <Feather
                  name={item.muted ? 'bell-off' : 'bell'}
                  size={17}
                  color={item.muted ? '#6B7280' : ACCENT}
                />
                {muting ? <ActivityIndicator color={ACCENT} size={10} /> : null}
              </View>
            </Pressable>
          ) : null}
          {item.muted && !onToggleMuted ? <Feather name="bell-off" size={14} color="#9CA3AF" /> : null}
          {formattedTime ? <Text style={styles.time}>{formattedTime}</Text> : null}
        </View>
        {item.unreadCount > 0 ? (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadText}>{badgeText(item.unreadCount)}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
});

export function MessengerHubNotice({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <View style={styles.notice} accessibilityRole="alert">
      <Feather name="alert-circle" size={16} color="#9A4C16" />
      <Text style={styles.noticeText}>{message}</Text>
      {onRetry ? (
        <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retryButton}>
          <Text style={styles.retryText}>다시 시도</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function MessengerHubSourceLoading({ labels }: { labels: readonly string[] }) {
  if (labels.length === 0) return null;

  return (
    <View style={styles.sourceLoadingList}>
      {labels.map((label) => (
        <View
          key={label}
          accessible
          accessibilityLabel={`${label} 불러오는 중`}
          accessibilityRole="progressbar"
          style={styles.sourceLoadingRow}
        >
          <BrandedLoadingSpinner size="sm" />
          <Text style={styles.sourceLoadingText}>{label} 불러오는 중</Text>
        </View>
      ))}
    </View>
  );
}

export function MessengerHubEmpty({ tab }: { tab: 'people' | 'chats' }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{tab === 'people' ? '표시할 사람이 없습니다.' : '아직 시작한 대화가 없습니다.'}</Text>
      <Text style={styles.emptyDetail}>{tab === 'people' ? '잠시 후 다시 불러와 주세요.' : '사람 탭에서 대화를 시작할 수 있습니다.'}</Text>
    </View>
  );
}

function formatConversationTime(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
}

const styles = StyleSheet.create({
  header: {
    minHeight: 64,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: { flex: 1, color: '#111827', fontSize: 26, lineHeight: 34, fontWeight: '800', letterSpacing: -0.7 },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  headerButtonActive: { backgroundColor: '#FFF0E6' },
  pressed: { backgroundColor: '#F3F4F6' },
  row: {
    minHeight: 72,
    paddingHorizontal: 20,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ECEFF2',
  },
  rowPressed: { backgroundColor: '#FFF7F2' },
  personRow: { position: 'relative' },
  personRoleLine: { position: 'absolute', left: 0, top: 12, bottom: 12, width: 4, borderTopRightRadius: 2, borderBottomRightRadius: 2 },
  avatar: { width: 46, height: 46, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF0E6' },
  avatarText: { color: '#B84D0B', fontSize: 17, fontWeight: '800' },
  body: { flex: 1, minWidth: 0, gap: 3 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  name: { flexShrink: 1, color: '#111827', fontSize: 16, lineHeight: 22, fontWeight: '700' },
  detail: { color: '#6B7280', fontSize: 13, lineHeight: 18 },
  roleBadge: { minHeight: 20, paddingHorizontal: 7, borderRadius: 10, justifyContent: 'center' },
  roleBadgeText: { fontSize: 10, lineHeight: 14, fontWeight: '800' },
  source: { color: '#9CA3AF', fontSize: 11, fontWeight: '600' },
  preview: { color: '#6B7280', fontSize: 13, lineHeight: 18 },
  meta: { minWidth: 42, alignSelf: 'stretch', alignItems: 'flex-end', justifyContent: 'space-between', paddingVertical: 2 },
  timeLine: { minHeight: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  muteButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 16 },
  muteButtonActive: { backgroundColor: '#FFF5EE' },
  muteButtonMuted: { backgroundColor: '#EEF0F3' },
  muteButtonPressed: { backgroundColor: '#FFF0E6' },
  muteButtonContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 },
  time: { color: '#9CA3AF', fontSize: 11, fontVariant: ['tabular-nums'] },
  unreadBadge: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center' },
  unreadText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800', fontVariant: ['tabular-nums'] },
  notice: { marginHorizontal: 20, marginTop: 12, paddingHorizontal: 12, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FFF7ED', borderRadius: 10 },
  noticeText: { flex: 1, color: '#7C3F13', fontSize: 12, lineHeight: 17 },
  retryButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  retryText: { color: '#9A4C16', fontSize: 12, fontWeight: '800' },
  sourceLoadingList: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0E5DE',
    backgroundColor: '#FFFBF8',
  },
  sourceLoadingRow: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  sourceLoadingText: {
    color: '#7C4A2D',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  sectionHeader: { minHeight: 44, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FFFFFF', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB' },
  sectionHeaderPressed: { backgroundColor: '#F8FAFC' },
  sectionDot: { width: 8, height: 8, borderRadius: 4 },
  sectionTitle: { flex: 1, color: '#374151', fontSize: 14, fontWeight: '800' },
  sectionCount: { color: '#94A3B8', fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  filterPanel: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB', backgroundColor: '#FFFFFF' },
  filterChip: { minHeight: 32, paddingHorizontal: 11, borderRadius: 16, justifyContent: 'center', backgroundColor: '#F3F4F6' },
  filterChipActive: { backgroundColor: '#FFF0E6' },
  filterChipPressed: { opacity: 0.72 },
  filterChipText: { color: '#6B7280', fontSize: 12, fontWeight: '700' },
  filterChipTextActive: { color: '#B84D0B' },
  empty: { paddingHorizontal: 24, paddingTop: 72, alignItems: 'center', gap: 7 },
  emptyTitle: { color: '#374151', fontSize: 15, fontWeight: '700' },
  emptyDetail: { color: '#9CA3AF', fontSize: 13 },
});
