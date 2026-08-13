import { Feather } from '@expo/vector-icons';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  buildMessengerNotificationPreferenceChange,
  getMessengerNotificationRoomLabel,
  type MessengerNotificationPreferenceChange,
  type MessengerNotificationPreferenceFailure,
  type MessengerNotificationRoomRef,
} from '@/lib/messenger-notification-preferences';
import { COLORS, RADIUS, SHADOWS, SPACING, TOUCH_TARGET, TYPOGRAPHY } from '@/lib/theme';

export type ConversationSettingsSheetProps = {
  visible: boolean;
  room: MessengerNotificationRoomRef;
  roomTitle?: string | null;
  muted: boolean;
  pending?: boolean;
  disabled?: boolean;
  disabledReason?: string | null;
  failure?: MessengerNotificationPreferenceFailure | null;
  onClose: () => void;
  onOpenNotificationSettings?: () => void;
  onPreferenceChange: (change: MessengerNotificationPreferenceChange) => void;
  onRetryLoad: () => void;
  onRetryPreferenceChange: (change: MessengerNotificationPreferenceChange) => void;
};

export function ConversationSettingsSheet({
  visible,
  room,
  roomTitle,
  muted,
  pending = false,
  disabled = false,
  disabledReason,
  failure,
  onClose,
  onOpenNotificationSettings,
  onPreferenceChange,
  onRetryLoad,
  onRetryPreferenceChange,
}: ConversationSettingsSheetProps) {
  const insets = useSafeAreaInsets();
  const interactionDisabled = pending || disabled;
  const retryDisabled = pending || (disabled && failure?.operation !== 'load');
  const roomKindLabel = getMessengerNotificationRoomLabel(room);
  const normalizedRoomTitle = String(roomTitle ?? '').trim();
  const displayTitle = normalizedRoomTitle || roomKindLabel;
  const toggleLabel = muted ? '알림 켜기' : '알림 끄기';
  const statusLabel = muted ? '알림 꺼짐' : '알림 켜짐';
  const statusDescription = disabled
    ? String(disabledReason ?? '').trim() || '이 대화의 알림 설정을 변경할 수 없습니다.'
    : muted
      ? '새 메시지 알림을 받지 않습니다.'
      : '새 메시지 알림을 받습니다.';

  const handleClose = () => {
    if (!pending) onClose();
  };

  const handleToggle = () => {
    if (interactionDisabled) return;
    onPreferenceChange(
      buildMessengerNotificationPreferenceChange(room, !muted),
    );
  };

  const handleRetry = () => {
    if (!failure || retryDisabled) return;
    if (failure.operation === 'load') {
      onRetryLoad();
      return;
    }
    onRetryPreferenceChange(
      buildMessengerNotificationPreferenceChange(room, failure.attemptedMuted),
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <View style={styles.backdrop}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          disabled={pending}
          onPress={handleClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          accessibilityLabel={`${displayTitle} 대화 설정`}
          accessibilityViewIsModal
          style={[
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom, SPACING.base) },
          ]}
          testID="conversation-settings-sheet"
        >
          <View style={styles.handle} />

          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>대화 설정</Text>
              <Text numberOfLines={1} style={styles.roomTitle}>
                {displayTitle}
              </Text>
              {normalizedRoomTitle ? (
                <Text style={styles.roomKind}>{roomKindLabel}</Text>
              ) : null}
            </View>
            <Pressable
              accessibilityLabel="대화 설정 닫기"
              accessibilityRole="button"
              accessibilityState={{ disabled: pending }}
              disabled={pending}
              hitSlop={SPACING.xs}
              onPress={handleClose}
              style={({ pressed }) => [
                styles.closeButton,
                pressed && !pending && styles.pressed,
                pending && styles.controlDisabled,
              ]}
            >
              <Feather name="x" size={20} color={COLORS.text.secondary} />
            </Pressable>
          </View>

          <View style={styles.statusCard}>
            <View
              style={[
                styles.statusDot,
                muted ? styles.statusDotMuted : styles.statusDotActive,
              ]}
            />
            <View style={styles.statusCopy}>
              <Text style={styles.statusLabel}>{statusLabel}</Text>
              <Text style={styles.statusDescription}>{statusDescription}</Text>
            </View>
          </View>

          <Pressable
            accessibilityHint={`${displayTitle}의 새 메시지 알림 상태를 변경합니다.`}
            accessibilityLabel={toggleLabel}
            accessibilityRole="switch"
            accessibilityState={{
              busy: pending,
              checked: !muted,
              disabled: interactionDisabled,
            }}
            disabled={interactionDisabled}
            onPress={handleToggle}
            style={({ pressed }) => [
              styles.preferenceRow,
              pressed && !interactionDisabled && styles.preferenceRowPressed,
              interactionDisabled && styles.controlDisabled,
            ]}
            testID="conversation-notification-toggle"
          >
            <View style={styles.preferenceIcon}>
              <Feather
                name={muted ? 'bell' : 'bell-off'}
                size={19}
                color={COLORS.primaryDark}
              />
            </View>
            <View style={styles.preferenceCopy}>
              <Text style={styles.preferenceTitle}>{toggleLabel}</Text>
              <Text style={styles.preferenceDescription}>
                {pending ? '알림 설정을 저장하는 중입니다.' : '이 대화에만 적용됩니다.'}
              </Text>
            </View>
            {pending ? (
              <ActivityIndicator
                accessibilityLabel="알림 설정 저장 중"
                color={COLORS.primary}
                size="small"
              />
            ) : (
              <Feather name="chevron-right" size={19} color={COLORS.text.muted} />
            )}
          </Pressable>

          {failure ? (
            <View
              accessibilityLiveRegion="polite"
              accessibilityRole="alert"
              style={styles.errorPanel}
              testID="conversation-notification-error"
            >
              <Feather name="alert-circle" size={18} color={COLORS.error} />
              <View style={styles.errorCopy}>
                <Text style={styles.errorMessage}>{failure.message}</Text>
                <Pressable
                  accessibilityLabel={failure.operation === 'load'
                    ? '알림 설정 다시 불러오기'
                    : '알림 설정 다시 저장'}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: retryDisabled }}
                  disabled={retryDisabled}
                  onPress={handleRetry}
                  style={({ pressed }) => [
                    styles.retryButton,
                    pressed && !retryDisabled && styles.retryButtonPressed,
                    retryDisabled && styles.controlDisabled,
                  ]}
                >
                  <Text style={styles.retryLabel}>다시 시도</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {onOpenNotificationSettings ? (
            <Pressable
              accessibilityLabel="전체 알림 설정 열기"
              accessibilityRole="button"
              accessibilityState={{ disabled: pending }}
              disabled={pending}
              onPress={onOpenNotificationSettings}
              style={({ pressed }) => [
                styles.globalSettingsButton,
                pressed && !pending && styles.globalSettingsButtonPressed,
                pending && styles.controlDisabled,
              ]}
            >
              <Feather name="settings" size={17} color={COLORS.primaryDark} />
              <Text style={styles.globalSettingsLabel}>전체 알림 설정</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(17, 24, 39, 0.34)',
  },
  sheet: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    backgroundColor: COLORS.white,
    ...SHADOWS.lg,
  },
  handle: {
    width: 42,
    height: 4,
    alignSelf: 'center',
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.gray[300],
  },
  header: {
    minHeight: 74,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.md,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  title: {
    color: COLORS.text.primary,
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
    lineHeight: 24,
  },
  roomTitle: {
    marginTop: 2,
    color: COLORS.text.secondary,
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: TYPOGRAPHY.fontWeight.semibold,
    lineHeight: 19,
  },
  roomKind: {
    marginTop: 1,
    color: COLORS.text.muted,
    fontSize: TYPOGRAPHY.fontSize.xs,
    lineHeight: 16,
  },
  closeButton: {
    width: TOUCH_TARGET.min,
    height: TOUCH_TARGET.min,
    borderRadius: RADIUS.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.gray[50],
  },
  statusCard: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.base,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.gray[50],
  },
  statusDot: {
    width: 9,
    height: 9,
    borderRadius: RADIUS.full,
  },
  statusDotActive: { backgroundColor: COLORS.primary },
  statusDotMuted: { backgroundColor: COLORS.gray[400] },
  statusCopy: { flex: 1 },
  statusLabel: {
    color: COLORS.text.primary,
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
    lineHeight: 19,
  },
  statusDescription: {
    marginTop: 1,
    color: COLORS.text.secondary,
    fontSize: TYPOGRAPHY.fontSize.xs,
    lineHeight: 17,
  },
  preferenceRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginTop: SPACING.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border.light,
    paddingVertical: SPACING.sm,
  },
  preferenceRowPressed: { backgroundColor: COLORS.primaryPale },
  preferenceIcon: {
    width: TOUCH_TARGET.min,
    height: TOUCH_TARGET.min,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primaryPale,
  },
  preferenceCopy: { flex: 1 },
  preferenceTitle: {
    color: COLORS.text.primary,
    fontSize: TYPOGRAPHY.fontSize.base,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
    lineHeight: 21,
  },
  preferenceDescription: {
    marginTop: 2,
    color: COLORS.text.secondary,
    fontSize: TYPOGRAPHY.fontSize.xs,
    lineHeight: 17,
  },
  controlDisabled: { opacity: 0.48 },
  pressed: { backgroundColor: COLORS.gray[100] },
  errorPanel: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.md,
    marginTop: SPACING.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.error,
    borderRadius: RADIUS.md,
    paddingLeft: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.errorLight,
  },
  globalSettingsButton: {
    minHeight: TOUCH_TARGET.min,
    marginTop: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    backgroundColor: COLORS.white,
  },
  globalSettingsButtonPressed: { backgroundColor: COLORS.primaryPale },
  globalSettingsLabel: {
    color: COLORS.primaryDark,
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
  },
  errorCopy: { flex: 1 },
  errorMessage: {
    paddingRight: SPACING.md,
    color: COLORS.gray[800],
    fontSize: TYPOGRAPHY.fontSize.xs,
    lineHeight: 18,
  },
  retryButton: {
    minHeight: TOUCH_TARGET.min,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    marginTop: 2,
    borderRadius: RADIUS.base,
    paddingHorizontal: SPACING.sm,
  },
  retryButtonPressed: { backgroundColor: 'rgba(243, 111, 33, 0.12)' },
  retryLabel: {
    color: COLORS.primaryDark,
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
  },
});
