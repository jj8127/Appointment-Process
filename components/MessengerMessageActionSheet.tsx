import { Feather } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

const CHARCOAL = '#111827';

type FeatherName = ComponentProps<typeof Feather>['name'];

export const MESSENGER_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '👏'] as const;

type ActionRowProps = {
  icon: FeatherName;
  label: string;
  onPress?: () => void;
  destructive?: boolean;
  disabled?: boolean;
};

function ActionRow({ icon, label, onPress, destructive = false, disabled = false }: ActionRowProps) {
  if (!onPress) return null;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.actionButton,
        destructive && styles.actionButtonDanger,
        disabled && styles.actionButtonDisabled,
        pressed && !disabled && styles.actionButtonPressed,
      ]}
      disabled={disabled}
      onPress={onPress}
    >
      <Feather name={icon} size={18} color={destructive ? '#FCA5A5' : '#F9FAFB'} />
      <Text style={[styles.actionButtonText, destructive && styles.actionButtonTextDanger]}>
        {label}
      </Text>
    </Pressable>
  );
}

type MessengerMessageActionSheetProps = {
  visible: boolean;
  preview?: string | null;
  onClose: () => void;
  reactions?: readonly string[];
  onReact?: (reaction: string) => void;
  onCopy?: () => void;
  onSelectCopy?: () => void;
  onReply?: () => void;
  onNotice?: () => void;
  noticeLabel?: string;
  noticeDisabled?: boolean;
  onDelete?: () => void;
  deleteLabel?: string;
  footer?: ReactNode;
};

export function MessengerMessageActionSheet({
  visible,
  preview,
  onClose,
  reactions = MESSENGER_REACTIONS,
  onReact,
  onCopy,
  onSelectCopy,
  onReply,
  onNotice,
  noticeLabel = '공지',
  noticeDisabled = false,
  onDelete,
  deleteLabel = '삭제',
  footer,
}: MessengerMessageActionSheetProps) {
  const canReact = Boolean(onReact && reactions.length > 0);
  const previewText = String(preview ?? '').trim();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.actionMenuBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.actionMenu}>
          <View style={styles.sheetHandle} />
          <Text style={styles.actionSheetTitle}>메시지 작업</Text>
          {previewText ? (
            <Text style={styles.actionSheetPreview} numberOfLines={2}>
              {previewText}
            </Text>
          ) : null}

          {canReact ? (
            <>
              <Text style={styles.reactionPickerLabel}>감정 남기기</Text>
              <View style={styles.reactionPickerRow}>
                {reactions.map((reaction) => (
                  <Pressable
                    key={reaction}
                    style={({ pressed }) => [
                      styles.reactionPickerButton,
                      pressed && styles.reactionPickerButtonPressed,
                    ]}
                    onPress={() => onReact?.(reaction)}
                  >
                    <Text style={styles.reactionPickerText}>{reaction}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}

          <View style={styles.actionList}>
            <ActionRow icon="copy" label="복사" onPress={onCopy} />
            <ActionRow icon="type" label="선택 복사" onPress={onSelectCopy} />
            <ActionRow icon="corner-up-left" label="답장" onPress={onReply} />
            <ActionRow
              icon="volume-2"
              label={noticeLabel}
              onPress={onNotice}
              disabled={noticeDisabled}
            />
            <ActionRow icon="trash-2" label={deleteLabel} onPress={onDelete} destructive />
          </View>

          {footer}
        </View>
      </View>
    </Modal>
  );
}

type MessageSelectCopySheetProps = {
  visible: boolean;
  text?: string | null;
  onClose: () => void;
  bottomInset?: number;
};

export function MessageSelectCopySheet({
  visible,
  text,
  onClose,
  bottomInset = 0,
}: MessageSelectCopySheetProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.selectCopyBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.selectCopySheet, { paddingBottom: Math.max(bottomInset, 16) + 18 }]}>
          <View style={styles.sheetHandleDark} />
          <View style={styles.selectCopyHeader}>
            <Text style={styles.selectCopyTitle}>선택 복사</Text>
            <Pressable style={styles.selectCopyCloseButton} onPress={onClose}>
              <Feather name="x" size={20} color={CHARCOAL} />
            </Pressable>
          </View>
          <ScrollView style={styles.selectCopyScroll} contentContainerStyle={styles.selectCopyScrollContent}>
            <Text selectable style={styles.selectCopyText}>
              {String(text ?? '')}
            </Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  actionMenuBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  actionMenu: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 22,
    backgroundColor: '#202124',
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.24,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 54,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#D1D5DB',
    marginBottom: 18,
  },
  sheetHandleDark: {
    alignSelf: 'center',
    width: 54,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#D1D5DB',
    marginBottom: 16,
  },
  actionSheetTitle: { fontSize: 16, fontWeight: '900', color: '#F9FAFB' },
  actionSheetPreview: { marginTop: 8, fontSize: 13, lineHeight: 19, color: '#D1D5DB' },
  reactionPickerLabel: { marginTop: 16, fontSize: 12, fontWeight: '900', color: '#D1D5DB' },
  reactionPickerRow: { marginTop: 10, flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
  reactionPickerButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2F3136',
  },
  reactionPickerButtonPressed: { opacity: 0.72 },
  reactionPickerText: { fontSize: 22 },
  actionList: { marginTop: 12 },
  actionButton: {
    minHeight: 50,
    borderRadius: 10,
    backgroundColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 8,
  },
  actionButtonPressed: { backgroundColor: 'rgba(255, 255, 255, 0.08)' },
  actionButtonDisabled: { opacity: 0.45 },
  actionButtonDanger: { backgroundColor: 'transparent' },
  actionButtonText: { fontSize: 17, fontWeight: '800', color: '#F9FAFB' },
  actionButtonTextDanger: { color: '#FCA5A5' },
  selectCopyBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(17, 24, 39, 0.45)',
  },
  selectCopySheet: {
    maxHeight: '72%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  selectCopyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14,
  },
  selectCopyTitle: { fontSize: 20, fontWeight: '900', color: CHARCOAL },
  selectCopyCloseButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F4F6',
  },
  selectCopyScroll: { maxHeight: 420 },
  selectCopyScrollContent: { paddingBottom: 16 },
  selectCopyText: {
    borderRadius: 16,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 15,
    lineHeight: 23,
    color: CHARCOAL,
  },
});
