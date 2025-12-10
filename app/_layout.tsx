import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as NavigationBar from 'expo-navigation-bar';
import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import 'react-native-reanimated';
import { Platform } from 'react-native';
import { enableScreens } from 'react-native-screens';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { SessionProvider } from '@/hooks/use-session';

const queryClient = new QueryClient();

// Disable native screen optimization to avoid Android drawing-order crash
enableScreens(false);

// Notification handler (banner/list 지원)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

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
      if (sub?.remove) sub.remove();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
            <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }} edges={['top', 'left', 'right']}>
              <Stack
                initialRouteName="auth"
                screenOptions={{
                  headerShown: false,
                  statusBarStyle: 'dark',
                  statusBarBackgroundColor: '#fff',
                }}>
                <Stack.Screen name="index" options={{headerTitle: ()=>null,  headerBackVisible: false}} />
                <Stack.Screen name="auth" options={{ title: '로그인' }} />
                <Stack.Screen name="fc/new" options={{ title: '기본 정보' }} />
                <Stack.Screen name="consent" options={{ title: '동의서 입력' }} />
                <Stack.Screen name="docs-upload" options={{ title: '서류 업로드' }} />
                <Stack.Screen name="dashboard" options={{ title: '전체 현황' }} />
                <Stack.Screen name="appointment" options={{ title: '모바일 위촉' }} />
                <Stack.Screen name="notifications" options={{ title: '알림' }} />
                <Stack.Screen name="notice" options={{ title: '공지사항' }} />
                <Stack.Screen name="admin-notice" options={{ title: '공지 등록' }} />
                <Stack.Screen name="exam-register" options={{ title: '생명 시험 등록' }} />
                <Stack.Screen name="exam-register2" options={{ title: '손해 시험 등록' }} />
                <Stack.Screen name="exam-manage" options={{ title: '생명 신청자 관리' }} />
                <Stack.Screen name="exam-manage2" options={{ title: '손해 신청자 관리' }} />
              </Stack>

              <StatusBar style="dark" backgroundColor="#fff" />
            </SafeAreaView>
          </ThemeProvider>
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
