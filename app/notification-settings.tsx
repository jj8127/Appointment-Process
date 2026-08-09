import { Feather } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSession } from '@/hooks/use-session';
import {
  getNotificationPreferences,
  PUSH_CATEGORIES,
  setGlobalPushEnabled,
  setPushCategoryEnabled,
  type NotificationPreferences,
  type PushCategory,
} from '@/lib/notification-preferences-api';
import {
  getPushPermissionStatus,
  openPushNotificationSettings,
  registerPushToken,
  type PushPermissionStatus,
} from '@/lib/notifications';

const ACCENT = '#F36F21';

const CATEGORY_COPY: Record<PushCategory, { title: string; description: string }> = {
  messages: { title: '메신저 알림', description: '새로운 1:1 및 단체 대화 알림' },
  request_activity: { title: '설계요청 진행 알림', description: '요청 접수와 진행 상태 변경' },
  notices: { title: '공지 알림', description: '가람in 공지와 중요 안내' },
  operations: { title: '일정·서류·시험 알림', description: '업무에 필요한 운영 알림' },
};

function permissionCopy(status: PushPermissionStatus) {
  if (status === 'granted') {
    return { icon: 'check-circle' as const, tone: 'ok' as const, title: '기기 알림 허용됨', body: '이 기기에서 알림을 받을 수 있어요.' };
  }
  if (status === 'denied') {
    return { icon: 'alert-triangle' as const, tone: 'error' as const, title: '기기 알림이 꺼져 있어요', body: '기기 설정에서 가람in 알림 권한을 켜 주세요.' };
  }
  if (status === 'undetermined') {
    return { icon: 'bell' as const, tone: 'neutral' as const, title: '기기 알림 권한 확인 전', body: '알림 받기를 켜면 권한을 요청합니다.' };
  }
  return { icon: 'smartphone' as const, tone: 'neutral' as const, title: '기기 알림 미지원', body: '현재 환경에서는 앱 푸시 알림을 사용할 수 없어요.' };
}

export default function NotificationSettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    role,
    residentId,
    displayName,
    requestBoardRole,
    hydrated,
  } = useSession();
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [permission, setPermission] = useState<PushPermissionStatus>('undetermined');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [confirmGlobalOff, setConfirmGlobalOff] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [preferenceResult, permissionResult] = await Promise.allSettled([
      getNotificationPreferences(),
      getPushPermissionStatus(),
    ]);
    if (permissionResult.status === 'fulfilled') setPermission(permissionResult.value);
    if (preferenceResult.status === 'fulfilled') {
      setPreferences(preferenceResult.value);
    } else {
      setError('알림 설정을 불러오지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (!role) {
      router.replace('/login');
    }
  }, [hydrated, role, router]);

  useFocusEffect(useCallback(() => {
    if (!hydrated || !role) return undefined;
    void load();
    return undefined;
  }, [hydrated, load, role]));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void getPushPermissionStatus().then(setPermission);
      }
    });
    return () => subscription.remove();
  }, []);

  const pushRole: 'admin' | 'fc' | 'manager' = requestBoardRole === 'designer'
    ? 'manager'
    : role === 'admin' ? 'admin' : 'fc';

  const commitGlobal = async (enabled: boolean) => {
    if (!preferences || pendingKey) return;
    setConfirmGlobalOff(false);
    const previous = preferences;
    setPendingKey('global');
    setError(null);
    setPreferences({ ...preferences, globalPushEnabled: enabled });
    try {
      const next = await setGlobalPushEnabled(enabled);
      setPreferences(next);
      if (enabled) {
        const registration = await registerPushToken(
          pushRole,
          residentId,
          displayName,
          undefined,
          { requestPermission: true },
        );
        const nextPermission = await getPushPermissionStatus();
        setPermission(nextPermission);
        if (!registration.ok && registration.reason !== 'permission_denied') {
          setError('알림 등록을 완료하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.');
        }
      }
    } catch {
      setPreferences(previous);
      setError('알림 설정을 저장하지 못했어요. 서버 상태를 다시 확인합니다.');
      void load();
    } finally {
      setPendingKey(null);
    }
  };

  const commitCategory = async (category: PushCategory, enabled: boolean) => {
    if (!preferences || pendingKey || !preferences.globalPushEnabled) return;
    const previous = preferences;
    setPendingKey(category);
    setError(null);
    setPreferences({
      ...preferences,
      categories: { ...preferences.categories, [category]: enabled },
    });
    try {
      setPreferences(await setPushCategoryEnabled(category, enabled));
    } catch {
      setPreferences(previous);
      setError('알림 종류 설정을 저장하지 못했어요. 이전 상태로 되돌렸습니다.');
    } finally {
      setPendingKey(null);
    }
  };

  const permissionState = permissionCopy(permission);

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safe}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="뒤로 가기"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
        >
          <Feather name="arrow-left" size={24} color="#111827" />
        </Pressable>
        <Text style={styles.headerTitle}>알림 설정</Text>
        <View style={styles.headerButton} />
      </View>

      {loading && !preferences ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={ACCENT} />
          <Text style={styles.stateText}>알림 설정을 불러오는 중입니다.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 20) + 20 }]}>
          <View style={[
            styles.permissionCard,
            permissionState.tone === 'error' && styles.permissionCardError,
          ]}>
            <Feather
              name={permissionState.icon}
              size={20}
              color={permissionState.tone === 'error' ? '#C2410C' : permissionState.tone === 'ok' ? '#18864B' : '#6B7280'}
            />
            <View style={styles.flex}>
              <Text style={styles.permissionTitle}>{permissionState.title}</Text>
              <Text style={styles.description}>{permissionState.body}</Text>
            </View>
          </View>

          {permission === 'denied' ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => void openPushNotificationSettings()}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.primaryButtonText}>기기 알림 설정 열기</Text>
            </Pressable>
          ) : null}

          {error ? (
            <View accessibilityRole="alert" style={styles.errorCard}>
              <Feather name="alert-circle" size={18} color="#B42318" />
              <Text style={styles.errorText}>{error}</Text>
              <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.inlineRetry}>
                <Text style={styles.inlineRetryText}>다시 시도</Text>
              </Pressable>
            </View>
          ) : null}

          {preferences ? (
            <>
              <View style={styles.section}>
                <PreferenceSwitch
                  description="끄면 이 계정으로 로그인한 모든 기기에서 가람in 알림을 받지 않습니다."
                  disabled={pendingKey !== null}
                  pending={pendingKey === 'global'}
                  title="알림 받기"
                  value={preferences.globalPushEnabled}
                  onChange={(enabled) => enabled ? void commitGlobal(true) : setConfirmGlobalOff(true)}
                />
              </View>

              <SectionTitle title="메시지" />
              <View style={styles.section}>
                <PreferenceSwitch
                  {...CATEGORY_COPY.messages}
                  disabled={!preferences.globalPushEnabled || pendingKey !== null}
                  pending={pendingKey === 'messages'}
                  value={preferences.categories.messages}
                  onChange={(enabled) => void commitCategory('messages', enabled)}
                />
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push('/muted-conversations' as never)}
                  style={({ pressed }) => [styles.navigationRow, pressed && styles.pressed]}
                >
                  <View style={styles.rowIcon}><Feather name="bell-off" size={18} color={ACCENT} /></View>
                  <View style={styles.flex}>
                    <Text style={styles.rowTitle}>알림을 끈 대화</Text>
                    <Text style={styles.description}>
                      알림을 끈 가람in·가람Link 대화를 관리합니다.
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={20} color="#9CA3AF" />
                </Pressable>
              </View>

              <SectionTitle title="업무" />
              <View style={styles.section}>
                {PUSH_CATEGORIES.filter((category) => category !== 'messages').map((category) => (
                  <PreferenceSwitch
                    key={category}
                    {...CATEGORY_COPY[category]}
                    disabled={!preferences.globalPushEnabled || pendingKey !== null}
                    pending={pendingKey === category}
                    value={preferences.categories[category]}
                    onChange={(enabled) => void commitCategory(category, enabled)}
                  />
                ))}
              </View>

              {!preferences.globalPushEnabled ? (
                <View style={styles.infoCard}>
                  <Feather name="info" size={17} color="#9A4C16" />
                  <Text style={styles.infoText}>알림을 꺼도 앱 안의 메시지와 읽지 않은 개수는 유지됩니다.</Text>
                </View>
              ) : null}
            </>
          ) : null}
        </ScrollView>
      )}

      <Modal visible={confirmGlobalOff} transparent animationType="slide" onRequestClose={() => setConfirmGlobalOff(false)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setConfirmGlobalOff(false)} />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>전체 알림을 끌까요?</Text>
            <Text style={styles.sheetDescription}>
              모든 메시지와 업무 알림 전달이 중단됩니다. 앱 안의 읽지 않은 항목은 그대로 남습니다.
            </Text>
            <Pressable accessibilityRole="button" onPress={() => void commitGlobal(false)} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>전체 알림 끄기</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => setConfirmGlobalOff(false)} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>취소</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

function PreferenceSwitch({
  title,
  description,
  value,
  disabled,
  pending,
  onChange,
}: {
  title: string;
  description: string;
  value: boolean;
  disabled: boolean;
  pending: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={[styles.switchRow, disabled && styles.disabled]}>
      <View style={styles.flex}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
      </View>
      {pending ? (
        <ActivityIndicator accessibilityLabel={`${title} 저장 중`} color={ACCENT} size="small" />
      ) : (
        <Switch
          accessibilityLabel={title}
          accessibilityRole="switch"
          disabled={disabled}
          onValueChange={onChange}
          thumbColor="#FFFFFF"
          trackColor={{ false: '#D1D5DB', true: ACCENT }}
          value={value}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F7F8FA' },
  header: { minHeight: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, backgroundColor: '#FFFFFF', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB' },
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  headerTitle: { flex: 1, textAlign: 'center', color: '#111827', fontSize: 18, fontWeight: '800' },
  content: { padding: 20, gap: 12 },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  stateText: { color: '#6B7280', fontSize: 14 },
  permissionCard: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB' },
  permissionCardError: { backgroundColor: '#FFF7ED', borderColor: '#FED7AA' },
  permissionTitle: { color: '#111827', fontSize: 15, lineHeight: 20, fontWeight: '800' },
  flex: { flex: 1, minWidth: 0 },
  description: { marginTop: 2, color: '#6B7280', fontSize: 12, lineHeight: 17 },
  sectionTitle: { marginTop: 8, marginLeft: 4, color: '#6B7280', fontSize: 13, lineHeight: 18, fontWeight: '700' },
  section: { overflow: 'hidden', borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB' },
  switchRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ECEFF2' },
  navigationRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 11 },
  rowIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#FFF0E6' },
  rowTitle: { color: '#111827', fontSize: 15, lineHeight: 20, fontWeight: '700' },
  disabled: { opacity: 0.45 },
  pressed: { backgroundColor: '#F3F4F6' },
  errorCard: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12, backgroundColor: '#FEF3F2', borderWidth: 1, borderColor: '#FECDCA' },
  errorText: { flex: 1, color: '#912018', fontSize: 12, lineHeight: 17 },
  inlineRetry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  inlineRetryText: { color: '#912018', fontSize: 12, fontWeight: '800' },
  infoCard: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12, backgroundColor: '#FFF7ED' },
  infoText: { flex: 1, color: '#7C3F13', fontSize: 12, lineHeight: 17 },
  primaryButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: ACCENT, paddingHorizontal: 16 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  secondaryButton: { minHeight: 48, marginTop: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: '#D1D5DB' },
  secondaryButtonText: { color: '#374151', fontSize: 15, fontWeight: '700' },
  buttonPressed: { opacity: 0.78 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(17, 24, 39, 0.34)' },
  sheet: { width: '100%', maxWidth: 520, alignSelf: 'center', padding: 20, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: '#FFFFFF' },
  sheetHandle: { width: 42, height: 4, alignSelf: 'center', marginBottom: 18, borderRadius: 2, backgroundColor: '#D1D5DB' },
  sheetTitle: { color: '#111827', fontSize: 20, lineHeight: 27, fontWeight: '800' },
  sheetDescription: { marginTop: 8, marginBottom: 20, color: '#6B7280', fontSize: 14, lineHeight: 21 },
});
