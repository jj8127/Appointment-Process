import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as NavigationBar from 'expo-navigation-bar';
import * as Notifications from 'expo-notifications';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { enableScreens } from 'react-native-screens';
import { TourGuideProvider } from 'rn-tourguide';

import CompactHeader from '@/components/CompactHeader';
import FcTourTooltip from '@/components/FcTourTooltip';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SessionProvider } from '@/hooks/use-session';

const queryClient = new QueryClient();

// Disable native screen optimization to avoid Android drawing-order crash
enableScreens(false);

const baseHeader = {
  headerShown: true,
  header: (props: any) => <CompactHeader {...props} />,
} as const;

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
            <TourGuideProvider
              borderRadius={16}
              labels={{ skip: '건너뛰기', previous: '이전', next: '다음', finish: '완료' }}
              tooltipComponent={FcTourTooltip}
              androidStatusBarVisible
              verticalOffset={0}>
              <Stack
                initialRouteName="auth"
                screenOptions={{
                  headerShown: false,
                  statusBarStyle: 'dark',
                  statusBarBackgroundColor: '#fff',
                }}>
                <Stack.Screen name="index" options={{ headerShown: false }} />
                <Stack.Screen name="auth" options={{ headerShown: false }} />
                <Stack.Screen name="fc/new" options={{ ...baseHeader, title: '기본 정보' }} />
                <Stack.Screen name="consent" options={{ ...baseHeader, title: '수당 지급 동의서' }} />
                <Stack.Screen name="docs-upload" options={{ ...baseHeader, title: '필수 서류 업로드' }} />
                <Stack.Screen name="exam-apply" options={{ ...baseHeader, title: '생명/제3보험 시험 신청' }} />
                <Stack.Screen name="exam-apply2" options={{ ...baseHeader, title: '손해보험 시험 신청' }} />
                <Stack.Screen name="chat" options={{ ...baseHeader, title: '1:1 문의' }} />

                <Stack.Screen name="dashboard" options={{ ...baseHeader, title: '전체 현황' }} />
                <Stack.Screen name="appointment" options={{ ...baseHeader, title: '모바일 위촉' }} />
                <Stack.Screen name="notifications" options={{ ...baseHeader, title: '알림' }} />
                <Stack.Screen name="notice" options={{ ...baseHeader, title: '공지사항' }} />
                <Stack.Screen name="admin-notice" options={{ ...baseHeader, title: '공지 등록' }} />
                <Stack.Screen name="exam-register" options={{ ...baseHeader, title: '생명 시험 등록' }} />
                <Stack.Screen name="exam-register2" options={{ ...baseHeader, title: '손해 시험 등록' }} />
                <Stack.Screen name="exam-manage" options={{ ...baseHeader, title: '생명/제3 신청자 관리' }} />
                <Stack.Screen name="exam-manage2" options={{ ...baseHeader, title: '손해 신청자 관리' }} />
              </Stack>

              <StatusBar style="dark" backgroundColor="#fff" />
            </TourGuideProvider>
          </ThemeProvider>
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
