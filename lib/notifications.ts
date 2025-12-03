import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { supabase } from './supabase';

let handlerSet = false;

export async function registerPushToken(role: 'admin' | 'fc', residentId: string, displayName: string) {
  try {
    console.log('registerPushToken start', role, residentId);
    // Expo Go cannot issue push tokens; use an EAS build
    if (Constants.appOwnership === 'expo') {
      console.warn('[push] Expo Go cannot issue push tokens. Please use an EAS build.');
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
    console.log('push permission existingStatus', existingStatus);
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      console.log('push permission requested status', status);
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      console.log('push permission not granted, skip token register');
      return;
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.expoConfig?.extra?.projectId;
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    const expoToken = token.data;
    console.log('getExpoPushTokenAsync token', { projectId, expoToken });

    const { error: upsertError } = await supabase.from('device_tokens').upsert(
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
    console.log('upsert resp', upsertError);
  } catch (err) {
    console.warn('registerPushToken failed', err);
  }
}
