import { useState } from 'react';
import { Alert, Keyboard } from 'react-native';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';

type LoginResponse = {
  ok: boolean;
  code?: string;
  message?: string;
  role?: 'admin' | 'fc' | 'manager';
  residentId?: string;
  displayName?: string;
};

type UseLoginOptions = {
  onSuccess?: (role: 'admin' | 'fc') => void;
  onError?: (error: Error) => void;
};

export function useLogin(options?: UseLoginOptions) {
  const { loginAs } = useSession();
  const [loading, setLoading] = useState(false);

  const login = async (phoneInput: string, passwordInput: string) => {
    Keyboard.dismiss();

    // Validation
    const code = phoneInput.replace(/\s/g, '');
    if (!code) {
      Alert.alert('알림', '휴대폰 번호를 입력해주세요.');
      return;
    }

    const digits = code.replace(/[^0-9]/g, '');
    if (digits.length !== 11) {
      Alert.alert('알림', '휴대폰 번호는 숫자 11자리로 입력해주세요.');
      return;
    }

    if (!passwordInput.trim()) {
      Alert.alert('알림', '비밀번호를 입력해주세요.');
      return;
    }

    Haptics.selectionAsync();
    setLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke<LoginResponse>('login-with-password', {
        body: { phone: digits, password: passwordInput.trim() },
      });

      if (error) {
        const errorMessage = error instanceof Error ? error.message : '오류가 발생했습니다. 다시 시도해주세요.';
        Alert.alert('로그인 실패', errorMessage);
        if (options?.onError) {
          options.onError(error instanceof Error ? error : new Error(errorMessage));
        }
        return;
      }

      if (!data?.ok) {
        // Account not found - redirect to signup for FC
        if (
          (data?.code === 'needs_password_setup' || data?.code === 'not_found')
          && data?.role !== 'admin'
          && data?.role !== 'manager'
        ) {
          Alert.alert('안내', '계정정보가 없습니다. 회원가입 페이지로 이동합니다.');
          router.replace('/signup');
          return;
        }

        // Other login failures
        Alert.alert('로그인 실패', data?.message ?? '오류가 발생했습니다. 다시 시도해주세요.');
        return;
      }

      // Success - set session
      const readOnly = data.role === 'manager';
      const nextRole = data.role === 'admin' || data.role === 'manager' ? 'admin' : 'fc';
      loginAs(nextRole, data.residentId ?? digits, data.displayName ?? '', readOnly);

      // Navigate or call custom success handler
      if (options?.onSuccess) {
        options.onSuccess(nextRole);
      } else {
        router.replace(nextRole === 'admin' ? '/' : '/home-lite');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '오류가 발생했습니다. 다시 시도해주세요.';
      Alert.alert('로그인 실패', errorMessage);
      if (options?.onError && error instanceof Error) {
        options.onError(error);
      }
    } finally {
      setLoading(false);
    }
  };

  return {
    login,
    loading,
  };
}
