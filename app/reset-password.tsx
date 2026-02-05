import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { MotiView } from 'moti';
import { useState } from 'react';
import {
  Alert,
  Keyboard,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { KeyboardAwareWrapper } from '@/components/KeyboardAwareWrapper';
import { FormInput } from '@/components/FormInput';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { COLORS, TYPOGRAPHY, SPACING, RADIUS } from '@/lib/theme';
import { validatePhone, validatePassword, normalizePhone } from '@/lib/validation';

export default function ResetPasswordScreen() {
  const { logout } = useSession();
  const [phone, setPhone] = useState('');
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [requested, setRequested] = useState(false);
  const keyboardPadding = useKeyboardPadding();

  const handleRequest = async () => {
    Keyboard.dismiss();
    const phoneValidation = validatePhone(phone);
    if (!phoneValidation.isValid) {
      Alert.alert('알림', phoneValidation.error);
      return;
    }
    const digits = normalizePhone(phone);
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('request-password-reset', {
        body: { phone: digits },
      });

      // 디버깅: 응답 로깅
      logger.info('reset-password response', { data, error, hasError: !!error, dataOk: data?.ok });

      if (error) {
        let detail = error.message;
        const context = (error as any)?.context as Response | undefined;
        if (context?.text) {
          try {
            detail = await context.text();
          } catch {
            // ignore
          }
        }
        logger.warn('reset request failed', { detail });
        throw new Error(detail || error.message);
      }
      if (!data?.ok) {
        if (data?.code === 'not_found') {
          Alert.alert(
            '회원가입 필요',
            '회원가입이 되어 있지 않은 번호입니다.\n회원가입 페이지로 이동하시겠습니까?',
            [
              { text: '취소', style: 'cancel' },
              {
                text: '회원가입',
                onPress: () => router.replace('/signup'),
              },
            ]
          );
          return;
        }
        if (data?.code === 'not_set' || data?.code === 'not_completed') {
          Alert.alert(
            '회원가입 미완료',
            '회원가입이 완료되지 않았습니다.\n회원가입 페이지로 이동하시겠습니까?',
            [
              { text: '취소', style: 'cancel' },
              {
                text: '회원가입',
                onPress: () => router.replace('/signup'),
              },
            ]
          );
          return;
        }
        Alert.alert('알림', data?.message ?? '요청에 실패했습니다.');
        return;
      }
      setRequested(true);
      Alert.alert(
        '안내',
        '인증 코드가 문자로 발송되었습니다.',
      );
    } catch (err: any) {
      const message = err?.message || '비밀번호 재설정 요청에 실패했습니다.';
      Alert.alert('오류', message);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    Keyboard.dismiss();
    const phoneValidation = validatePhone(phone);
    if (!phoneValidation.isValid) {
      Alert.alert('알림', phoneValidation.error);
      return;
    }
    if (!token.trim()) {
      Alert.alert('알림', '인증 코드를 입력해주세요.');
      return;
    }
    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.isValid) {
      Alert.alert('알림', passwordValidation.error);
      return;
    }
    const digits = normalizePhone(phone);
    const trimmedNew = newPassword.trim();

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('reset-password', {
        body: {
          phone: digits,
          token: token.trim(),
          newPassword: trimmedNew,
        },
      });
      if (error) throw error;
      if (!data?.ok) {
        Alert.alert('알림', data?.message ?? '재설정에 실패했습니다.');
        return;
      }

      await supabase.auth.signOut().catch(() => {});
      logout();
      Alert.alert('완료', '비밀번호 변경됨');
      router.replace('/login');
    } catch {
      Alert.alert('오류', '비밀번호 재설정에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#ffffff', '#fff1e6']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <KeyboardAwareWrapper
          contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(40, keyboardPadding + 40) }]}
          extraScrollHeight={140}
        >
          <View style={styles.innerContent}>
            <MotiView
              from={{ opacity: 0, translateY: 30, scale: 0.98 }}
              animate={{ opacity: 1, translateY: 0, scale: 1 }}
              transition={{ type: 'spring', damping: 20, stiffness: 100, delay: 200 }}
              style={styles.card}
            >
              <View style={styles.headerSection}>
                <Text style={styles.title}>비밀번호 재설정</Text>
                <Text style={styles.subtitle}>문자로 받은 6자리 코드를 입력해주세요.</Text>
              </View>

              <FormInput
                label="휴대폰 번호"
                placeholder="숫자 11자리"
                value={phone}
                onChangeText={setPhone}
                keyboardType="number-pad"
                editable={!loading}
                containerStyle={styles.inputContainer}
              />

              <Button
                onPress={handleRequest}
                disabled={loading}
                variant="outline"
                size="md"
                fullWidth
                style={styles.subButton}
              >
                {requested ? '인증 코드 다시 받기' : '인증 코드 받기'}
              </Button>

              <FormInput
                label="인증 코드"
                placeholder="6자리 숫자 코드"
                value={token}
                onChangeText={setToken}
                keyboardType="number-pad"
                editable={!loading}
                containerStyle={styles.inputContainer}
              />

              <FormInput
                label="새 비밀번호"
                variant="password"
                placeholder="8자 이상, 영문+숫자+특수문자"
                value={newPassword}
                onChangeText={setNewPassword}
                autoCapitalize="none"
                editable={!loading}
                containerStyle={styles.inputContainer}
              />

              <Button
                onPress={handleReset}
                disabled={loading}
                loading={loading}
                variant="primary"
                size="lg"
                fullWidth
              >
                비밀번호 변경
              </Button>
            </MotiView>
          </View>
        </KeyboardAwareWrapper>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safe: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingTop: '10%',
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING['2xl'],
  },
  innerContent: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.xl,
    padding: SPACING['2xl'],
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 8,
    borderWidth: 1,
    borderColor: COLORS.primaryPale,
  },
  headerSection: {
    marginBottom: SPACING['2xl'],
    alignItems: 'center',
  },
  title: {
    fontSize: TYPOGRAPHY.fontSize['2xl'],
    fontWeight: TYPOGRAPHY.fontWeight.extrabold,
    color: COLORS.text.primary,
    marginBottom: SPACING.sm,
  },
  subtitle: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.text.secondary,
    textAlign: 'center',
    lineHeight: TYPOGRAPHY.lineHeight.relaxed * TYPOGRAPHY.fontSize.sm,
  },
  inputContainer: {
    marginBottom: SPACING.base,
  },
  subButton: {
    marginBottom: SPACING.lg,
  },
});
