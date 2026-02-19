import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as NavigationBar from 'expo-navigation-bar';
import * as Notifications from 'expo-notifications';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { enableScreens } from 'react-native-screens';
import { TourGuideProvider } from 'rn-tourguide';

import { AppAlertProvider } from '@/components/AppAlertProvider';
import CompactHeader from '@/components/CompactHeader';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import FcTourTooltip from '@/components/FcTourTooltip';
import { ToastProvider } from '@/components/Toast';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SessionProvider } from '@/hooks/use-session';
import { useInAppUpdate } from '@/hooks/useInAppUpdate';
import { logger } from '@/lib/logger';
import { safeStorage } from '@/lib/safe-storage';

import {
  AntDesign,
  Entypo,
  Feather,
  FontAwesome,
  Ionicons,
  MaterialIcons,
} from '@expo/vector-icons';
import type { FontSource } from 'expo-font';
import { loadAsync } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5분 - 데이터가 신선한 것으로 간주되는 시간
      gcTime: 10 * 60 * 1000, // 10분 (구 cacheTime) - 캐시 유지 시간
      refetchOnWindowFocus: false, // 포커스 시 자동 리페치 비활성화
      retry: 1, // 실패 시 1회만 재시도
    },
    mutations: {
      retry: 1, // Mutation 실패 시 1회만 재시도
    },
  },
});

// Disable native screen optimization to avoid Android drawing-order crash
enableScreens(false);

const baseHeader = {
  headerShown: true,
  header: (props: any) => <CompactHeader {...props} />,
} as const;

const ALERTS_CHANNEL_ID = 'alerts';

// Notification handler (banner/list 지원)
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const isWeb = Platform.OS === 'web';
  const enableTourGuide = Platform.OS === 'android';

  useInAppUpdate();
  const fontSources = useMemo<Record<string, FontSource>>(() => {
    if (isWeb) {
      return {
        Feather: '/fonts/Feather.ttf',
        Ionicons: '/fonts/Ionicons.ttf',
        MaterialIcons: '/fonts/MaterialIcons.ttf',
        FontAwesome: '/fonts/FontAwesome.ttf',
        AntDesign: '/fonts/AntDesign.ttf',
        Entypo: '/fonts/Entypo.ttf',
      };
    }
    return {
      ...Feather.font,
      ...Ionicons.font,
      ...MaterialIcons.font,
      ...FontAwesome.font,
      ...AntDesign.font,
      ...Entypo.font,
    } as Record<string, FontSource>;
  }, [isWeb]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  useEffect(() => {
    let isMounted = true;
    loadAsync(fontSources)
      .then(() => {
        if (isMounted) setLoaded(true);
      })
      .catch((err) => {
        if (isMounted) setError(err as Error);
      });
    return () => {
      isMounted = false;
    };
  }, [fontSources]);

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded || isWeb) {
      SplashScreen.hideAsync();
    }
  }, [loaded, isWeb]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    (async () => {
      try {
        // 권한 요청 (Android 13+)
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;
        if (existingStatus !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        logger.debug('[notifications] permission status', { finalStatus });

        // 채널 생성
        await Notifications.setNotificationChannelAsync(ALERTS_CHANNEL_ID, {
          name: '중요 알림',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          sound: 'default',
          lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        });
        const channels = await Notifications.getNotificationChannelsAsync();
        logger.debug('[notifications] android channels', { channels });
        await NavigationBar.setVisibilityAsync('visible');
        await NavigationBar.setStyle(isDark ? 'light' : 'dark');
      } catch (err) {
        logger.warn('NavigationBar/Notification setup failed', err);
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
        logger.warn('push navigation listener failed', err);
      }
    })();
    return () => {
      if (sub?.remove) sub.remove();
    };
  }, []);

  if (!loaded) {
    return null;
  }

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <QueryClientProvider client={queryClient}>
            <SessionProvider>
              <AppAlertProvider>
                <ToastProvider>
                  <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
                    {enableTourGuide ? (
                      <TourGuideProvider
                        borderRadius={16}
                        labels={{ skip: '건너뛰기', previous: '이전', next: '다음', finish: '완료' }}
                        tooltipComponent={FcTourTooltip}
                        androidStatusBarVisible
                        verticalOffset={0}>
                        <Stack
                          initialRouteName="login"
                          screenOptions={{
                            headerShown: false,
                          }}>
                          <Stack.Screen name="index" options={{ ...baseHeader, title: '홈' }} />
                          <Stack.Screen
                            name="home-lite"
                            options={{
                              ...baseHeader,
                              title: '홈',
                              headerLeft: () => (
                                <Pressable
                                  onPress={async () => {
                                    // 로그아웃 처리
                                    await safeStorage.removeItem('session_role');
                                    await safeStorage.removeItem('session_resident');
                                    await safeStorage.removeItem('session_name');
                                    await safeStorage.removeItem('session_readonly');
                                    router.replace('/login');
                                  }}
                                  style={{ padding: 8, marginLeft: -8 }}>
                                  <Feather name="arrow-left" size={24} color="#000" />
                                </Pressable>
                              ),
                            }}
                          />
                          <Stack.Screen name="auth" options={{ headerShown: false }} />
                          <Stack.Screen name="login" options={{ headerShown: false }} />
                          <Stack.Screen
                            name="signup"
                            options={{
                              ...baseHeader,
                              title: '회원가입',
                              headerLeft: () => (
                                <Pressable onPress={() => router.replace('/login')} style={{ padding: 8, marginLeft: -8 }}>
                                  <Feather name="arrow-left" size={24} color="#000" />
                                </Pressable>
                              ),
                            }}
                          />
                          <Stack.Screen
                            name="reset-password"
                            options={{
                              ...baseHeader,
                              title: '비밀번호 재설정',
                              headerLeft: () => (
                                <Pressable onPress={() => router.replace('/login')} style={{ padding: 8, marginLeft: -8 }}>
                                  <Feather name="arrow-left" size={24} color="#000" />
                                </Pressable>
                              ),
                            }}
                          />
                          <Stack.Screen
                            name="signup-verify"
                            options={{
                              ...baseHeader,
                              title: '휴대폰 인증',
                              headerLeft: () => (
                                <Pressable onPress={() => router.replace('/signup')} style={{ padding: 8, marginLeft: -8 }}>
                                  <Feather name="arrow-left" size={24} color="#000" />
                                </Pressable>
                              ),
                            }}
                          />
                          <Stack.Screen
                            name="signup-password"
                            options={{
                              ...baseHeader,
                              title: '비밀번호 설정',
                              headerLeft: () => (
                                <Pressable onPress={() => router.replace('/signup-verify')} style={{ padding: 8, marginLeft: -8 }}>
                                  <Feather name="arrow-left" size={24} color="#000" />
                                </Pressable>
                              ),
                            }}
                          />
                          <Stack.Screen name="apply-gate" options={{ ...baseHeader, title: '위촉 신청 안내' }} />
                          <Stack.Screen name="identity" options={{ ...baseHeader, title: '신원 확인' }} />
                          <Stack.Screen
                            name="fc/new"
                            options={{
                              ...baseHeader,
                              title: '기본 정보',
                              headerLeft: () => (
                                <Pressable onPress={() => router.replace('/')} style={{ padding: 8, marginLeft: -8 }}>
                                  <Feather name="arrow-left" size={24} color="#000" />
                                </Pressable>
                              ),
                            }}
                          />
                          <Stack.Screen name="consent" options={{ ...baseHeader, title: '수당 지급 동의서' }} />
                          <Stack.Screen name="docs-upload" options={{ ...baseHeader, title: '필수 서류 업로드' }} />
                          <Stack.Screen name="exam-apply" options={{ ...baseHeader, title: '생명/제3보험 시험 신청' }} />
                          <Stack.Screen name="exam-apply2" options={{ ...baseHeader, title: '손해보험 시험 신청' }} />
                          <Stack.Screen name="chat" options={{ ...baseHeader, title: '1:1 문의' }} />
                          <Stack.Screen name="settings" options={{ ...baseHeader, title: '설정' }} />

                          <Stack.Screen name="dashboard" options={{ ...baseHeader, title: '전체 현황' }} />
                          <Stack.Screen name="appointment" options={{ ...baseHeader, title: '위촉' }} />
                          <Stack.Screen name="notifications" options={{ ...baseHeader, title: '알림' }} />
                          <Stack.Screen name="notice" options={{ ...baseHeader, title: '공지사항' }} />
                          <Stack.Screen name="notice-detail" options={{ ...baseHeader, title: '공지 상세' }} />
                          <Stack.Screen name="board-detail" options={{ ...baseHeader, title: '게시글 상세' }} />
                          <Stack.Screen name="admin-notice" options={{ ...baseHeader, title: '공지 등록' }} />
                          <Stack.Screen name="exams/life" options={{ ...baseHeader, title: '생명 시험 등록' }} />
                          <Stack.Screen name="exams/nonlife" options={{ ...baseHeader, title: '손해 시험 등록' }} />
                          <Stack.Screen name="exam-register" options={{ ...baseHeader, title: '생명 시험 등록' }} />
                          <Stack.Screen name="exam-register2" options={{ ...baseHeader, title: '손해 시험 등록' }} />
                          <Stack.Screen name="exam-manage" options={{ ...baseHeader, title: '생명/제3 신청자 관리' }} />
                          <Stack.Screen name="exam-manage2" options={{ ...baseHeader, title: '손해 신청자 관리' }} />
                        </Stack>

                        <StatusBar style="dark" backgroundColor="#fff" />
                      </TourGuideProvider>
                    ) : (
                      <>
                        <Stack
                          initialRouteName="login"
                          screenOptions={{
                            headerShown: false,
                          }}>
                          <Stack.Screen name="index" options={{ ...baseHeader, title: '홈' }} />
                          <Stack.Screen
                            name="home-lite"
                            options={{
                              ...baseHeader,
                              title: '홈',
                              headerLeft: () => (
                                <Pressable
                                  onPress={async () => {
                                    // 로그아웃 처리
                                    await safeStorage.removeItem('session_role');
                                    await safeStorage.removeItem('session_resident');
                                    await safeStorage.removeItem('session_name');
                                    await safeStorage.removeItem('session_readonly');
                                    router.replace('/login');
                                  }}
                                  style={{ padding: 8, marginLeft: -8 }}>
                                  <Feather name="arrow-left" size={24} color="#000" />
                                </Pressable>
                              ),
                            }}
                          />
                          <Stack.Screen name="auth" options={{ headerShown: false }} />
                          <Stack.Screen name="login" options={{ headerShown: false }} />
                          <Stack.Screen
                            name="signup"
                            options={{
                              ...baseHeader,
                              title: '회원가입',
                              headerLeft: () => (
                                <Pressable onPress={() => router.replace('/login')} style={{ padding: 8, marginLeft: -8 }}>
                                  <Feather name="arrow-left" size={24} color="#000" />
                                </Pressable>
                              ),
                            }}
                          />
                          <Stack.Screen
                            name="reset-password"
                            options={{
                              ...baseHeader,
                              title: '비밀번호 재설정',
                              headerLeft: () => (
                                <Pressable onPress={() => router.replace('/login')} style={{ padding: 8, marginLeft: -8 }}>
                                  <Feather name="arrow-left" size={24} color="#000" />
                                </Pressable>
                              ),
                            }}
                          />
                          <Stack.Screen
                            name="signup-verify"
                            options={{
                              ...baseHeader,
                              title: '휴대폰 인증',
                              headerLeft: () => (
                                <Pressable onPress={() => router.replace('/signup')} style={{ padding: 8, marginLeft: -8 }}>
                                  <Feather name="arrow-left" size={24} color="#000" />
                                </Pressable>
                              ),
                            }}
                          />
                          <Stack.Screen
                            name="signup-password"
                            options={{
                              ...baseHeader,
                              title: '비밀번호 설정',
                              headerLeft: () => (
                                <Pressable onPress={() => router.replace('/signup-verify')} style={{ padding: 8, marginLeft: -8 }}>
                                  <Feather name="arrow-left" size={24} color="#000" />
                                </Pressable>
                              ),
                            }}
                          />
                          <Stack.Screen name="apply-gate" options={{ ...baseHeader, title: '위촉 신청 안내' }} />
                          <Stack.Screen name="identity" options={{ ...baseHeader, title: '신원 확인' }} />
                          <Stack.Screen name="fc/new" options={{ ...baseHeader, title: '기본 정보' }} />
                          <Stack.Screen name="consent" options={{ ...baseHeader, title: '수당 지급 동의서' }} />
                          <Stack.Screen name="docs-upload" options={{ ...baseHeader, title: '필수 서류 업로드' }} />
                          <Stack.Screen name="exam-apply" options={{ ...baseHeader, title: '생명/제3보험 시험 신청' }} />
                          <Stack.Screen name="exam-apply2" options={{ ...baseHeader, title: '손해보험 시험 신청' }} />
                          <Stack.Screen name="chat" options={{ ...baseHeader, title: '1:1 문의' }} />
                          <Stack.Screen name="settings" options={{ ...baseHeader, title: '설정' }} />

                          <Stack.Screen name="dashboard" options={{ ...baseHeader, title: '전체 현황' }} />
                          <Stack.Screen name="appointment" options={{ ...baseHeader, title: '위촉' }} />
                          <Stack.Screen name="notifications" options={{ ...baseHeader, title: '알림' }} />
                          <Stack.Screen name="notice" options={{ ...baseHeader, title: '공지사항' }} />
                          <Stack.Screen name="notice-detail" options={{ ...baseHeader, title: '공지 상세' }} />
                          <Stack.Screen name="board-detail" options={{ ...baseHeader, title: '게시글 상세' }} />
                          <Stack.Screen name="admin-notice" options={{ ...baseHeader, title: '공지 등록' }} />
                          <Stack.Screen name="exams/life" options={{ ...baseHeader, title: '생명 시험 등록' }} />
                          <Stack.Screen name="exams/nonlife" options={{ ...baseHeader, title: '손해 시험 등록' }} />
                          <Stack.Screen name="exam-register" options={{ ...baseHeader, title: '생명 시험 등록' }} />
                          <Stack.Screen name="exam-register2" options={{ ...baseHeader, title: '손해 시험 등록' }} />
                          <Stack.Screen name="exam-manage" options={{ ...baseHeader, title: '생명/제3 신청자 관리' }} />
                          <Stack.Screen name="exam-manage2" options={{ ...baseHeader, title: '손해 신청자 관리' }} />
                        </Stack>
                        <StatusBar style="dark" backgroundColor="#fff" />
                      </>
                    )}
                  </ThemeProvider>
                </ToastProvider>
              </AppAlertProvider>
            </SessionProvider>
          </QueryClientProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
