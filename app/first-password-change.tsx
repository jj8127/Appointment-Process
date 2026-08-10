import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Keyboard, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { FormInput } from '@/components/FormInput';
import { KeyboardAwareWrapper } from '@/components/KeyboardAwareWrapper';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import {
  clearPendingAssistedPasswordChange,
  getPendingAssistedPasswordChange,
} from '@/lib/pending-assisted-password-change';
import { clearSavedLoginCredentials } from '@/lib/saved-login-credentials';
import { supabase } from '@/lib/supabase';
import { COLORS, RADIUS, SPACING, TYPOGRAPHY } from '@/lib/theme';
import { validatePassword } from '@/lib/validation';

type CompletionResponse = {
  ok?: boolean;
  code?: string;
  message?: string;
};

export default function FirstPasswordChangeScreen() {
  const [challenge] = useState(() => getPendingAssistedPasswordChange());
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const keyboardPadding = useKeyboardPadding();

  useEffect(() => {
    if (challenge?.token) return;
    Alert.alert('다시 로그인이 필요합니다', '비밀번호 변경 요청을 찾을 수 없습니다.', [
      { text: '확인', onPress: () => router.replace('/login?skipAuto=1') },
    ]);
  }, [challenge]);

  const handleSubmit = async () => {
    Keyboard.dismiss();
    if (!challenge?.token || loading) return;

    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.isValid) {
      Alert.alert('입력 확인', passwordValidation.error);
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('입력 확인', '새 비밀번호가 일치하지 않습니다.');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke<CompletionResponse>(
        'complete-assisted-password',
        {
          body: {
            token: challenge.token,
            newPassword,
            confirm: confirmPassword,
          },
        },
      );
      if (error) throw error;
      if (data?.ok !== true) {
        if (
          data?.code === 'invalid_password_change_token'
          || data?.code === 'expired_password_change_token'
        ) {
          clearPendingAssistedPasswordChange();
          Alert.alert('다시 로그인이 필요합니다', data.message ?? '변경 시간이 만료되었습니다.', [
            { text: '확인', onPress: () => router.replace('/login?skipAuto=1') },
          ]);
          return;
        }
        Alert.alert('변경 실패', data?.message ?? '새 비밀번호를 저장하지 못했습니다.');
        return;
      }

      clearPendingAssistedPasswordChange();
      await clearSavedLoginCredentials().catch(() => undefined);
      Alert.alert('변경 완료', '새 비밀번호로 다시 로그인해주세요.', [
        { text: '로그인', onPress: () => router.replace('/login?skipAuto=1') },
      ]);
    } catch {
      Alert.alert('변경 실패', '새 비밀번호를 저장하지 못했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <KeyboardAwareWrapper
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Math.max(40, keyboardPadding + 40) },
          ]}
          extraScrollHeight={140}
          keyboardDismissMode="none"
        >
          <View style={styles.card}>
            <View style={styles.stepBadge}>
              <Text style={styles.stepBadgeText}>본인 변경 · 마지막 단계</Text>
            </View>
            <Text style={styles.title}>새 비밀번호 설정</Text>
            <Text style={styles.subtitle}>
              관리자에게 받은 임시 비밀번호와 다른 비밀번호를 설정하세요. 완료 전에는 일반 로그인 세션이 발급되지 않습니다.
            </Text>

            <FormInput
              label="새 비밀번호"
              variant="password"
              placeholder="8자 이상, 영문+숫자+특수문자"
              value={newPassword}
              onChangeText={setNewPassword}
              autoCapitalize="none"
              editable={!loading}
              containerStyle={styles.input}
            />
            <FormInput
              label="새 비밀번호 확인"
              variant="password"
              placeholder="한 번 더 입력"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              autoCapitalize="none"
              editable={!loading}
              containerStyle={styles.input}
            />
            <Button
              onPress={handleSubmit}
              disabled={loading || !challenge?.token}
              loading={loading}
              variant="primary"
              size="lg"
              fullWidth
              dismissKeyboardOnPress
            >
              새 비밀번호 저장
            </Button>
          </View>
        </KeyboardAwareWrapper>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.primaryPale },
  safe: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING['2xl'],
  },
  card: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.xl,
    padding: SPACING['2xl'],
    borderWidth: 1,
    borderColor: COLORS.primaryPale,
    shadowColor: COLORS.primary,
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 6,
  },
  stepBadge: {
    alignSelf: 'flex-start',
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.primaryPale,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    marginBottom: SPACING.lg,
  },
  stepBadgeText: {
    color: COLORS.primary,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
    fontSize: TYPOGRAPHY.fontSize.xs,
  },
  title: {
    color: COLORS.text.primary,
    fontSize: TYPOGRAPHY.fontSize['2xl'],
    fontWeight: TYPOGRAPHY.fontWeight.extrabold,
    marginBottom: SPACING.sm,
  },
  subtitle: {
    color: COLORS.text.secondary,
    fontSize: TYPOGRAPHY.fontSize.sm,
    lineHeight: 22,
    marginBottom: SPACING['2xl'],
  },
  input: { marginBottom: SPACING.lg },
});
