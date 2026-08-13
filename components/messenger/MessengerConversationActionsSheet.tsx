import { Feather } from '@expo/vector-icons';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { MessengerHubConversation } from '@/lib/messenger-hub-model';

export type MessengerConversationAction = 'pin' | 'mute' | 'read' | 'leave';

type Props = {
  conversation: MessengerHubConversation | null;
  visible: boolean;
  pendingAction: MessengerConversationAction | null;
  onClose: () => void;
  onPin: () => void;
  onMute: () => void;
  onRead: () => void;
  onLeave: () => void;
};

const ACCENT = '#F36F21';

export function MessengerConversationActionsSheet({
  conversation,
  visible,
  pendingAction,
  onClose,
  onPin,
  onMute,
  onRead,
  onLeave,
}: Props) {
  const insets = useSafeAreaInsets();
  const blocked = pendingAction !== null;
  if (!conversation) return null;

  return (
    <Modal
      animationType="fade"
      onRequestClose={blocked ? undefined : onClose}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View style={styles.overlay}>
        <Pressable
          accessibilityLabel="채팅방 설정 닫기"
          accessibilityRole="button"
          disabled={blocked}
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          accessibilityLabel={`${conversation.name} 채팅방 설정`}
          accessibilityViewIsModal
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}
        >
          <View style={styles.handle} />
          <View style={styles.roomHeader}>
            <View style={styles.roomRail} />
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{conversation.name.replace(/\s+/g, '').charAt(0) || '메'}</Text>
            </View>
            <View style={styles.roomText}>
              <Text numberOfLines={1} style={styles.roomName}>{conversation.name}</Text>
              <Text style={styles.roomSource}>{conversation.sourceLabel} 대화방</Text>
            </View>
          </View>

          <ActionRow
            action="pin"
            icon="bookmark"
            label={conversation.pinnedAt ? '채팅방 상단 고정 해제' : '채팅방 상단 고정'}
            onPress={onPin}
            pendingAction={pendingAction}
          />
          <ActionRow
            action="mute"
            icon={conversation.muted ? 'bell' : 'bell-off'}
            label={conversation.muted ? '채팅방 알림 켜기' : '채팅방 알림 끄기'}
            onPress={onMute}
            pendingAction={pendingAction}
          />
          <ActionRow
            action="read"
            disabled={conversation.unreadCount === 0}
            icon="check-circle"
            label="읽음"
            onPress={onRead}
            pendingAction={pendingAction}
          />
          <ActionRow
            action="leave"
            danger
            icon="log-out"
            label="나가기"
            onPress={onLeave}
            pendingAction={pendingAction}
          />
        </View>
      </View>
    </Modal>
  );
}

function ActionRow({
  action,
  icon,
  label,
  onPress,
  pendingAction,
  disabled = false,
  danger = false,
}: {
  action: MessengerConversationAction;
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
  pendingAction: MessengerConversationAction | null;
  disabled?: boolean;
  danger?: boolean;
}) {
  const pending = pendingAction === action;
  const blocked = pendingAction !== null || disabled;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy: pending, disabled }}
      disabled={blocked}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        disabled && styles.actionDisabled,
        pressed && !blocked && styles.actionPressed,
      ]}
    >
      <View style={[styles.actionIcon, danger && styles.actionIconDanger]}>
        {pending
          ? <ActivityIndicator color={danger ? '#C43D3D' : ACCENT} size="small" />
          : <Feather name={icon} size={20} color={danger ? '#C43D3D' : '#374151'} />}
      </View>
      <Text style={[styles.actionLabel, danger && styles.actionLabelDanger]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(17, 24, 39, 0.42)',
  },
  sheet: {
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    shadowColor: '#111827',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 18,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    marginBottom: 12,
    borderRadius: 2,
    backgroundColor: '#D1D5DB',
  },
  roomHeader: {
    position: 'relative',
    minHeight: 70,
    marginBottom: 6,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    overflow: 'hidden',
    borderRadius: 18,
    backgroundColor: '#FFF8F3',
  },
  roomRail: {
    position: 'absolute',
    left: 0,
    top: 12,
    bottom: 12,
    width: 4,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
    backgroundColor: ACCENT,
  },
  avatar: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: '#FFE9DB',
  },
  avatarText: { color: '#A9430A', fontSize: 16, fontWeight: '800' },
  roomText: { flex: 1, minWidth: 0 },
  roomName: { color: '#111827', fontSize: 17, lineHeight: 23, fontWeight: '800' },
  roomSource: { marginTop: 2, color: '#8A5A3C', fontSize: 12, lineHeight: 17, fontWeight: '600' },
  action: {
    minHeight: 58,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
  },
  actionPressed: { backgroundColor: '#FFF5EE' },
  actionDisabled: { opacity: 0.42 },
  actionIcon: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: '#F3F4F6',
  },
  actionIconDanger: { backgroundColor: '#FFF0F0' },
  actionLabel: { color: '#1F2937', fontSize: 16, lineHeight: 22, fontWeight: '700' },
  actionLabelDanger: { color: '#B83232' },
});
