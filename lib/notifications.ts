import Constants from 'expo-constants';
import { Linking, Platform } from 'react-native';

import { logger } from './logger';
import { getStoredAppSessionToken } from './request-board-api';
import { supabase } from './supabase';

let handlerSet = false;

export type PushTokenRegistrationResult =
  | { ok: true; retryable: false; reason: 'registered' }
  | {
      ok: false;
      retryable: boolean;
      reason:
        | 'unsupported_platform'
        | 'unsupported_client'
        | 'physical_device_required'
        | 'permission_denied'
        | 'session_unavailable'
        | 'registration_failed';
    };

export type PushPermissionStatus = 'granted' | 'denied' | 'undetermined' | 'unavailable';

export type PushTokenUnregisterResult =
  | { ok: true; retryable: false; reason: 'unregistered' }
  | { ok: false; retryable: boolean; reason: 'session_unavailable' | 'unregister_failed' };

export async function getPushPermissionStatus(): Promise<PushPermissionStatus> {
  if (Platform.OS === 'web') return 'unavailable';
  try {
    const Notifications = await import('expo-notifications');
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted' || status === 'denied' || status === 'undetermined'
      ? status
      : 'undetermined';
  } catch {
    return 'unavailable';
  }
}

export async function openPushNotificationSettings() {
  if (Platform.OS === 'web') return false;
  try {
    await Linking.openSettings();
    return true;
  } catch {
    return false;
  }
}

export async function unregisterAllPushTokens(): Promise<PushTokenUnregisterResult> {
  const sessionToken = await getStoredAppSessionToken();
  if (!sessionToken) {
    return { ok: false, retryable: true, reason: 'session_unavailable' };
  }
  try {
    const { data, error } = await supabase.functions.invoke<{ ok?: boolean }>(
      'device-token-register',
      {
        method: 'DELETE',
        body: { disableAll: true },
        headers: { 'x-app-session-token': sessionToken },
      },
    );
    return !error && data?.ok === true
      ? { ok: true, retryable: false, reason: 'unregistered' }
      : { ok: false, retryable: true, reason: 'unregister_failed' };
  } catch {
    return { ok: false, retryable: true, reason: 'unregister_failed' };
  }
}

export async function registerPushToken(
  role: 'admin' | 'fc' | 'manager',
  residentId: string,
  displayName: string,
  providedExpoPushToken?: string,
  options: { requestPermission?: boolean } = {},
): Promise<PushTokenRegistrationResult> {
  try {
    if (Platform.OS === 'web') {
      return { ok: false, retryable: false, reason: 'unsupported_platform' };
    }
    void residentId;
    logger.debug('registerPushToken start', { role });
    // Expo Go cannot issue push tokens; use an EAS build
    if (Constants.appOwnership === 'expo') {
      logger.warn('[push] Expo Go cannot issue push tokens. Please use an EAS build.');
      return { ok: false, retryable: false, reason: 'unsupported_client' };
    }

    const Device = await import('expo-device');
    const Notifications = await import('expo-notifications');

    if (!handlerSet) {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldPlaySound: true,
          shouldSetBadge: false,
          shouldShowBanner: true,
          shouldShowList: true,
        }),
      });
      handlerSet = true;
    }

    // Android 헤드업 알림을 위해 채널 중요도를 MAX로 설정
    if (Platform.OS === 'android') {
      // 기본 채널
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
      });
      // fc-notify에서 사용하는 alerts 채널
      await Notifications.setNotificationChannelAsync('alerts', {
        name: 'Alerts',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
        sound: 'default',
      });
    }

    if (!Device.isDevice) {
      return { ok: false, retryable: false, reason: 'physical_device_required' };
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    logger.debug('push permission existingStatus', existingStatus);
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted' && options.requestPermission === true) {
      const { status } = await Notifications.requestPermissionsAsync();
      logger.debug('push permission requested status', status);
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      logger.debug('push permission not granted, skip token register');
      return { ok: false, retryable: false, reason: 'permission_denied' };
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.expoConfig?.extra?.projectId;
    const token = providedExpoPushToken
      ? { data: providedExpoPushToken }
      : await Notifications.getExpoPushTokenAsync({ projectId });
    const expoToken = token.data;
    logger.debug('getExpoPushTokenAsync completed', {
      projectIdConfigured: Boolean(projectId),
      reused: Boolean(providedExpoPushToken),
    });

    const sessionToken = await getStoredAppSessionToken();
    if (!sessionToken) {
      logger.warn('[push] missing app session token, skip trusted registration');
      return { ok: false, retryable: true, reason: 'session_unavailable' };
    }

    const { data, error: registerError } = await supabase.functions.invoke<{ ok?: boolean; role?: string }>(
      'device-token-register',
      {
        body: {
          expoPushToken: expoToken,
          platform: Platform.OS,
          displayName,
        },
        headers: { 'x-app-session-token': sessionToken },
      },
    );
    logger.debug('[push] trusted register completed', {
      requestedRole: role,
      serverRole: data?.role,
      ok: !registerError && data?.ok === true,
    });
    if (registerError || data?.ok !== true) {
      logger.warn('[push] trusted register failed', { reason: 'registration_failed' });
      return { ok: false, retryable: true, reason: 'registration_failed' };
    }
    return { ok: true, retryable: false, reason: 'registered' };
  } catch {
    logger.warn('registerPushToken failed', { reason: 'registration_failed' });
    return { ok: false, retryable: true, reason: 'registration_failed' };
  }
}
