import { Feather } from '@expo/vector-icons';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { MessengerHubPerson } from '@/lib/messenger-hub-model';

const ACCENT = '#F36F21';

type MessengerPersonProfileSheetProps = {
  person: MessengerHubPerson | null;
  visible: boolean;
  loading?: boolean;
  errorMessage?: string | null;
  onClose: () => void;
  onStartChat: () => void;
};

function initialFor(name: string) {
  return name.replace(/\s+/g, '').charAt(0) || '사';
}

export function MessengerPersonProfileSheet({
  person,
  visible,
  loading = false,
  errorMessage,
  onClose,
  onStartChat,
}: MessengerPersonProfileSheetProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      transparent
      visible={visible && person !== null}
    >
      <View style={styles.root}>
        <Pressable
          accessibilityLabel="프로필 닫기"
          accessibilityRole="button"
          onPress={onClose}
          style={styles.backdrop}
        />
        {person ? (
          <View
            accessibilityViewIsModal
            style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}
          >
            <View style={styles.handle} />
            <View style={styles.header}>
              <Text style={styles.eyebrow}>사람 프로필</Text>
              <Pressable
                accessibilityLabel="프로필 닫기"
                accessibilityRole="button"
                disabled={loading}
                hitSlop={4}
                onPress={onClose}
                style={({ pressed }) => [styles.closeButton, pressed && styles.buttonPressed]}
              >
                <Feather name="x" size={22} color="#374151" />
              </Pressable>
            </View>

            <View style={styles.profile}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initialFor(person.name)}</Text>
              </View>
              <View style={styles.profileBody}>
                <Text style={styles.name}>{person.name}</Text>
                <Text style={styles.detail}>{person.detail}</Text>
                <View style={styles.sourcePill}>
                  <Text style={styles.sourceText}>{person.sourceLabel}</Text>
                </View>
              </View>
            </View>

            {errorMessage ? (
              <Text accessibilityRole="alert" style={styles.errorText}>{errorMessage}</Text>
            ) : null}

            <Pressable
              accessibilityLabel={`${person.name}님과 1:1 대화`}
              accessibilityRole="button"
              disabled={loading}
              onPress={onStartChat}
              style={({ pressed }) => [
                styles.chatButton,
                pressed && !loading && styles.chatButtonPressed,
                loading && styles.chatButtonDisabled,
              ]}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Feather name="message-circle" size={19} color="#FFFFFF" />
                  <Text style={styles.chatButtonText}>1:1 대화</Text>
                </>
              )}
            </Pressable>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(17, 24, 39, 0.38)',
  },
  sheet: {
    paddingHorizontal: 20,
    paddingTop: 8,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  handle: {
    width: 36,
    height: 4,
    alignSelf: 'center',
    marginBottom: 4,
    borderRadius: 2,
    backgroundColor: '#D1D5DB',
  },
  header: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
  },
  eyebrow: {
    flex: 1,
    color: '#6B7280',
    fontSize: 13,
    fontWeight: '700',
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  buttonPressed: { backgroundColor: '#F3F4F6' },
  profile: {
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  avatar: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    backgroundColor: '#FFF0E6',
  },
  avatarText: { color: '#B84D0B', fontSize: 23, fontWeight: '800' },
  profileBody: { flex: 1, alignItems: 'flex-start', gap: 4 },
  name: { color: '#111827', fontSize: 22, lineHeight: 29, fontWeight: '800' },
  detail: { color: '#6B7280', fontSize: 14, lineHeight: 20 },
  sourcePill: {
    minHeight: 24,
    marginTop: 2,
    paddingHorizontal: 9,
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
  },
  sourceText: { color: '#4B5563', fontSize: 11, fontWeight: '700' },
  errorText: {
    marginBottom: 10,
    color: '#B42318',
    fontSize: 13,
    lineHeight: 18,
  },
  chatButton: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    backgroundColor: ACCENT,
  },
  chatButtonPressed: { backgroundColor: '#D85E17' },
  chatButtonDisabled: { opacity: 0.6 },
  chatButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
});
