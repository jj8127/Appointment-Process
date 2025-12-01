import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { supabase } from './supabase';

let handlerSet = false;

export async function registerPushToken(role: 'admin' | 'fc', residentId: string, displayName: string) {
  try {
    // Expo Go에서는 원격 푸시 토큰을 지원하지 않으므로 바로 종료
    if (Constants.appOwnership === 'expo') {
      console.warn('[push] Expo Go에서는 푸시 토큰 등록을 건너뜁니다. 개발용 빌드를 사용하세요.');
      return;
    }

    const Device = await import('expo-device');
    const Notifications = await import('expo-notifications');

    if (!handlerSet) {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldPlaySound: false,
          shouldSetBadge: false,
        }),
      });
      handlerSet = true;
    }

    if (!Device.isDevice) return;

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      return;
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.expoConfig?.extra?.projectId;
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    const expoToken = token.data;

    await supabase.from('device_tokens').upsert(
      {
        expo_push_token: expoToken,
        role,
        resident_id: residentId,
        display_name: displayName,
        platform: Platform.OS,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'expo_push_token' },
    );
  } catch (err) {
    console.warn('registerPushToken failed', err);
  }
}
