import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as NavigationBar from 'expo-navigation-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';
import { Platform } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { SessionProvider } from '@/hooks/use-session';

const queryClient = new QueryClient();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    (async () => {
      try {
        await NavigationBar.setVisibilityAsync('visible');
        await NavigationBar.setStyle(isDark ? 'light' : 'dark');
      } catch (err) {
        console.warn('NavigationBar apply failed', err);
      }
    })();
  }, [isDark]);

  // Push 알림 탭 시 앱 내부 화면으로 이동
  useEffect(() => {
    let sub: any;
    let Notifications: any;
    (async () => {
      try {
        Notifications = await import('expo-notifications');
        sub = Notifications.addNotificationResponseReceivedListener((response: any) => {
          const url = response?.notification?.request?.content?.data?.url as string | undefined;
          if (url) {
            router.push(url as any);
          } else {
            router.push('/notifications');
          }
        });
      } catch (err) {
        console.warn('push navigation listener failed', err);
      }
    })();
    return () => {
      if (Notifications && sub) {
        Notifications.removeNotificationSubscription(sub);
      }
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <Stack initialRouteName="auth">
            <Stack.Screen name="index" options={{ headerShown: true, title: '홈' }} />
            <Stack.Screen name="auth" options={{ title: '로그인' }} />
            <Stack.Screen name="fc/new" options={{ title: '기본 정보' }} />
            <Stack.Screen name="consent" options={{ title: '동의서 입력' }} />
            <Stack.Screen name="docs-upload" options={{ title: '서류 업로드' }} />
            <Stack.Screen name="dashboard" options={{ title: '총무 대시보드' }} />
            <Stack.Screen name="admin-register" options={{ title: '신규 FC 등록' }} />
            <Stack.Screen name="notifications" options={{ title: '알림' }} />
            <Stack.Screen name="notice" options={{ title: '공지사항' }} />
            <Stack.Screen name="admin-notice" options={{ title: '공지 등록' }} />
          </Stack>
          <StatusBar style={isDark ? 'light' : 'dark'} />
        </ThemeProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
