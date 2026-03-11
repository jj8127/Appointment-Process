import { useState } from 'react';
import { Alert, Keyboard } from 'react-native';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useSession } from '@/hooks/use-session';
import { clearRequestBoardState, rbBridgeLogin, setAppSessionToken, setBridgeToken } from '@/lib/request-board-api';
import { normalizeStaffType } from '@/lib/staff-identity';
import { supabase } from '@/lib/supabase';
import { validatePhone, validateRequired, normalizePhone } from '@/lib/validation';

type LoginResponse = {
  ok: boolean;
  code?: string;
  message?: string;
  role?: 'admin' | 'fc' | 'manager';
  residentId?: string;
  displayName?: string;
  staffType?: 'admin' | 'developer' | null;
  requestBoardBridgeToken?: string;
  appSessionToken?: string;
  requestBoardRole?: 'fc' | 'designer' | null;
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

    // Validation using centralized validation library
    const phoneValidation = validatePhone(phoneInput);
    if (!phoneValidation.isValid) {
      Alert.alert('알림', phoneValidation.error);
      return;
    }

    const passwordValidation = validateRequired(passwordInput, '비밀번호');
    if (!passwordValidation.isValid) {
      Alert.alert('알림', passwordValidation.error);
      return;
    }

    const digits = normalizePhone(phoneInput);

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
        if (data?.code === 'not_found') {
          Alert.alert('안내', '회원가입이 되어 있지 않은 번호입니다. 회원가입 후 로그인해주세요.');
          if (data?.role !== 'admin' && data?.role !== 'manager') {
            router.replace('/signup');
          }
          return;
        }

        if ((data?.code === 'needs_password_setup' || data?.code === 'not_completed') && data?.role !== 'admin' && data?.role !== 'manager') {
          Alert.alert('안내', '회원가입이 완료되지 않았습니다. 회원가입을 완료해주세요.');
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
      const staffType = normalizeStaffType(data.staffType);
      const bridgeToken = data.requestBoardBridgeToken ?? null;
      const appSessionToken = data.appSessionToken ?? null;
      const fallbackRequestBoardRole =
        data.requestBoardRole === 'fc' || data.requestBoardRole === 'designer'
          ? data.requestBoardRole
          : null;
      await clearRequestBoardState({ clearAppSession: true });
      await setAppSessionToken(appSessionToken);
      await setBridgeToken(bridgeToken);

      let requestBoardRole: 'fc' | 'designer' | null = fallbackRequestBoardRole;
      let isRequestBoardDesigner = fallbackRequestBoardRole === 'designer' && nextRole === 'fc';
      if (bridgeToken) {
        try {
          const bridged = await rbBridgeLogin(bridgeToken);
          if (bridged.success && (bridged.user?.role === 'designer' || bridged.user?.role === 'fc')) {
            requestBoardRole = bridged.user.role;
            // admin(총무/본부장) 계정은 request_board designer 여부에 관계없이 항상 admin 화면 유지
            isRequestBoardDesigner = bridged.user.role === 'designer' && nextRole === 'fc';
          }
        } catch {
          requestBoardRole = fallbackRequestBoardRole;
          isRequestBoardDesigner = fallbackRequestBoardRole === 'designer' && nextRole === 'fc';
        }
      }

      loginAs(
        nextRole,
        data.residentId ?? digits,
        data.displayName ?? '',
        staffType,
        readOnly,
        isRequestBoardDesigner,
        requestBoardRole,
        appSessionToken,
      );

      // Navigate or call custom success handler
      if (options?.onSuccess) {
        options.onSuccess(nextRole);
      } else {
        router.replace(isRequestBoardDesigner ? '/request-board' : nextRole === 'admin' ? '/' : '/home-lite');
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
