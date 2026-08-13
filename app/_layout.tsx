import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import * as NavigationBar from 'expo-navigation-bar';
import * as Notifications from 'expo-notifications';
import { Stack, router, useRootNavigationState } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { enableScreens } from 'react-native-screens';
import { TourGuideProvider } from 'rn-tourguide';

import { AppAlertProvider } from '@/components/AppAlertProvider';
import CompactHeader from '@/components/CompactHeader';
import SplashAnimation from '@/components/SplashAnimation';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import FcTourTooltip from '@/components/FcTourTooltip';
import { ToastProvider } from '@/components/Toast';
import { useAppPresenceHeartbeat } from '@/hooks/use-app-presence-heartbeat';
import { SessionProvider, useSession } from '@/hooks/use-session';
import { useInAppUpdate } from '@/hooks/useInAppUpdate';
import { goBackOrReplace } from '@/lib/back-navigation';
import { logger } from '@/lib/logger';
import {
  buildNotificationTargetRoute,
  parseNotificationPushData,
} from '@/lib/notification-target';
import { authorizeNotificationOpen } from '@/lib/notification-open-authorization';
import {
  bootstrapNotificationNavigation,
  clearNativeNotificationResponseIfCurrent,
  notificationCaptureMatches,
  processNotificationResponseSafely,
} from '@/lib/notification-bootstrap';
import {
  markNotificationBootstrapReady,
  markNotificationNavigationIdle,
  markNotificationNavigationPending,
  subscribeNotificationDestinationAcceptance,
} from '@/lib/notification-navigation-coordinator';
import {
  buildPendingNotificationOwnerBinding,
  clearPendingNotificationNavigation,
  createPendingNotificationNavigation,
  getPendingNotificationNavigation,
  pendingNotificationOwnerMatches,
  savePendingNotificationNavigation,
  type PendingNotificationNavigation,
} from '@/lib/pending-notification-navigation';
import { savePendingReferralCode } from '@/lib/referral-deeplink';
import { safeStorage } from '@/lib/safe-storage';
import { withSentryRoot } from '@/lib/sentry';

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

const DEFAULT_SCREEN_BACKGROUND = '#ffffff';
const AUTH_SCREEN_BACKGROUND = '#fff1e6';

const baseHeader = {
  headerShown: true,
  header: (props: any) => <CompactHeader {...props} />,
  contentStyle: { backgroundColor: DEFAULT_SCREEN_BACKGROUND },
} as const;

const authHeader = {
  ...baseHeader,
  contentStyle: { backgroundColor: AUTH_SCREEN_BACKGROUND },
} as const;

const defaultStackScreenOptions = {
  headerShown: false,
  contentStyle: { backgroundColor: DEFAULT_SCREEN_BACKGROUND },
} as const;

const ALERTS_CHANNEL_ID = 'alerts';

const GARAMIN_LIGHT_THEME = {
  ...DefaultTheme,
  dark: false,
  colors: {
    ...DefaultTheme.colors,
    primary: '#f36f21',
    background: DEFAULT_SCREEN_BACKGROUND,
    card: DEFAULT_SCREEN_BACKGROUND,
    text: '#111827',
    border: '#e5e7eb',
    notification: '#f36f21',
  },
};

// Notification handler (banner/list 지원)
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

SplashScreen.preventAutoHideAsync();

function PresenceBootstrap() {
  useAppPresenceHeartbeat();
  return null;
}

function NotificationNavigationBootstrap() {
  const {
    hydrated,
    role,
    residentId,
    appSessionToken,
  } = useSession();
  const rootNavigationState = useRootNavigationState();
  const [pending, setPending] =
    useState<PendingNotificationNavigation | null>(null);
  const [invalidTargetPending, setInvalidTargetPending] = useState(false);
  const handledResponseIdsRef = useRef(new Map<string, number>());
  const acceptedNotificationIdsRef = useRef(new Set<string>());
  const dispatchedNotificationIdsRef = useRef(new Set<string>());
  const verifyingNotificationIdsRef = useRef(new Set<string>());
  const responseQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingRef = useRef<PendingNotificationNavigation | null>(null);
  const mountedRef = useRef(true);
  const ownerBinding = useMemo(
    () => buildPendingNotificationOwnerBinding({
      role,
      residentId,
      appSessionToken,
    }),
    [appSessionToken, residentId, role],
  );
  const ownerBindingRef = useRef(ownerBinding);
  const sessionBindingKey = JSON.stringify(ownerBinding ?? null);
  const sessionBindingKeyRef = useRef(sessionBindingKey);
  pendingRef.current = pending;
  ownerBindingRef.current = ownerBinding;
  sessionBindingKeyRef.current = sessionBindingKey;

  const getResponseKey = useCallback((response: unknown) => {
    const candidate = response as {
      notification?: {
        request?: {
          identifier?: string;
          content?: { data?: unknown };
        };
      };
      actionIdentifier?: string;
    } | null;
    const request = candidate?.notification?.request;
    const parsed = parseNotificationPushData(request?.content?.data);
    return String(
      request?.identifier
      ?? parsed?.notificationId
      ?? candidate?.actionIdentifier
      ?? '',
    ).trim();
  }, []);

  const clearNativeResponseIfCurrent = useCallback(async (response: unknown) => {
    if (
      typeof Notifications.clearLastNotificationResponseAsync !== 'function'
    ) {
      return;
    }
    await clearNativeNotificationResponseIfCurrent({
      capturedResponse: response,
      getResponseKey,
      getCurrentResponse: () => (
        typeof Notifications.getLastNotificationResponse === 'function'
          ? Notifications.getLastNotificationResponse()
          : Notifications.getLastNotificationResponseAsync()
      ),
      clearCurrentResponse: () =>
        Notifications.clearLastNotificationResponseAsync(),
    });
  }, [getResponseKey]);

  const clearForUnavailableTarget = useCallback(async (expected?: {
    notificationId: string;
    target: PendingNotificationNavigation['target'];
  }) => {
    if (
      expected
      && !notificationCaptureMatches(pendingRef.current, expected)
    ) {
      return;
    }
    markNotificationNavigationPending();
    pendingRef.current = null;
    setPending(null);
    acceptedNotificationIdsRef.current.clear();
    dispatchedNotificationIdsRef.current.clear();
    verifyingNotificationIdsRef.current.clear();
    await clearPendingNotificationNavigation(expected);
    if (mountedRef.current) setInvalidTargetPending(true);
  }, []);

  const captureResponse = useCallback(async (response: unknown) => {
    const responseCandidate = response as {
      notification?: {
        request?: {
          content?: { data?: unknown };
        };
      };
    } | null;
    const responseKey = getResponseKey(response);
    const handledAt = responseKey
      ? handledResponseIdsRef.current.get(responseKey)
      : undefined;
    if (handledAt !== undefined && Date.now() - handledAt < 2_000) return;

    const parsed = parseNotificationPushData(
      responseCandidate?.notification?.request?.content?.data,
    );
    if (!parsed) {
      await clearForUnavailableTarget();
      if (responseKey) handledResponseIdsRef.current.set(responseKey, Date.now());
      return;
    }
    markNotificationNavigationPending();
    acceptedNotificationIdsRef.current.delete(parsed.notificationId);
    dispatchedNotificationIdsRef.current.delete(parsed.notificationId);
    const candidate = createPendingNotificationNavigation({
      ...parsed,
      owner: ownerBindingRef.current,
    });
    setInvalidTargetPending(false);
    pendingRef.current = candidate;
    setPending(candidate);
    if (responseKey) handledResponseIdsRef.current.set(responseKey, Date.now());
    try {
      const saved = await savePendingNotificationNavigation({
        ...parsed,
        owner: ownerBindingRef.current,
      });
      if (
        !mountedRef.current
        || !notificationCaptureMatches(pendingRef.current, candidate)
      ) {
        return;
      }
      pendingRef.current = saved;
      setPending(saved);
    } catch {
      await clearForUnavailableTarget({
        notificationId: candidate.notificationId,
        target: candidate.target,
      });
    }
  }, [clearForUnavailableTarget, getResponseKey]);

  const enqueueResponse = useCallback((response: unknown) => {
    const process = () =>
      processNotificationResponseSafely({
        response,
        captureResponse,
        clearNativeResponseIfCurrent,
        onCleanupFailure: () => {
          logger.warn('[notification-navigation] native response cleanup failed');
        },
      });
    const next = responseQueueRef.current.then(process, process);
    responseQueueRef.current = next.catch(() => undefined);
    return next;
  }, [captureResponse, clearNativeResponseIfCurrent]);

  useEffect(() => {
    mountedRef.current = true;
    const subscription =
      Notifications.addNotificationResponseReceivedListener((response) => {
        void enqueueResponse(response).catch(() => {
          logger.warn('[notification-navigation] response capture failed');
        });
      });

    const restore = async () => {
      const restored = await getPendingNotificationNavigation();
      if (!mountedRef.current) return;
      if (!pendingRef.current && restored) {
        pendingRef.current = restored;
        setPending(restored);
        markNotificationNavigationPending();
      }
    };
    const restoredTask = responseQueueRef.current.then(restore, restore);
    responseQueueRef.current = restoredTask.catch(() => undefined);

    void bootstrapNotificationNavigation({
      restorePending: () => restoredTask,
      getInitialResponse: () => (
        typeof Notifications.getLastNotificationResponse === 'function'
          ? Notifications.getLastNotificationResponse()
          : Notifications.getLastNotificationResponseAsync()
      ),
      isNotificationResponse: (response) =>
        Boolean((response as { notification?: unknown } | null)?.notification),
      enqueueResponse,
      hasPending: () => Boolean(pendingRef.current),
      markReady: markNotificationBootstrapReady,
      onRestoreFailure: () => {
        logger.warn('[notification-navigation] pending restore failed');
      },
      onInitialResponseFailure: () => {
        logger.warn('[notification-navigation] initial response capture failed');
      },
    });
    return () => {
      mountedRef.current = false;
      subscription?.remove?.();
    };
  }, [clearForUnavailableTarget, enqueueResponse]);

  useEffect(
    () => subscribeNotificationDestinationAcceptance((notificationId) => {
      dispatchedNotificationIdsRef.current.delete(notificationId);
      acceptedNotificationIdsRef.current.add(notificationId);
      if (pendingRef.current?.notificationId !== notificationId) return;
      pendingRef.current = null;
      setPending(null);
    }),
    [],
  );

  useEffect(() => {
    if (!hydrated || !role || !rootNavigationState?.key) return;
    if (invalidTargetPending) {
      setInvalidTargetPending(false);
      router.push('/notifications?targetError=unavailable');
      markNotificationNavigationIdle();
      return;
    }
    if (!pending) return;
    if (
      acceptedNotificationIdsRef.current.has(pending.notificationId)
      || dispatchedNotificationIdsRef.current.has(pending.notificationId)
    ) {
      return;
    }
    if (!pending.owner) {
      if (!ownerBinding) {
        void clearForUnavailableTarget({
          notificationId: pending.notificationId,
          target: pending.target,
        });
        return;
      }
      const rebound = createPendingNotificationNavigation({
        notificationId: pending.notificationId,
        target: pending.target,
        owner: ownerBinding,
      });
      pendingRef.current = rebound;
      setPending(rebound);
      void savePendingNotificationNavigation({
        notificationId: rebound.notificationId,
        target: rebound.target,
        owner: ownerBinding,
      }).catch(() =>
        clearForUnavailableTarget({
          notificationId: rebound.notificationId,
          target: rebound.target,
        })
      );
      return;
    }
    if (!pendingNotificationOwnerMatches(pending.owner, ownerBinding)) {
      void clearForUnavailableTarget({
        notificationId: pending.notificationId,
        target: pending.target,
      });
      return;
    }
    const verificationKey = `${pending.notificationId}:${sessionBindingKey}`;
    if (verifyingNotificationIdsRef.current.has(verificationKey)) return;
    verifyingNotificationIdsRef.current.add(verificationKey);
    const pendingAtStart = pending;
    const sessionAtStart = sessionBindingKey;

    void (async () => {
      const authorization = await authorizeNotificationOpen({
        notificationId: pendingAtStart.notificationId,
        target: pendingAtStart.target,
      });
      verifyingNotificationIdsRef.current.delete(verificationKey);
      if (
        !mountedRef.current
        || sessionBindingKeyRef.current !== sessionAtStart
        || pendingRef.current?.notificationId !== pendingAtStart.notificationId
      ) {
        return;
      }
      if (!authorization.ok) {
        await clearForUnavailableTarget({
          notificationId: pendingAtStart.notificationId,
          target: pendingAtStart.target,
        });
        return;
      }
      const route = buildNotificationTargetRoute({
        target: pendingAtStart.target,
        notificationId: pendingAtStart.notificationId,
        viewerRole: role,
      });
      if (!route) {
        await clearForUnavailableTarget({
          notificationId: pendingAtStart.notificationId,
          target: pendingAtStart.target,
        });
        return;
      }
      dispatchedNotificationIdsRef.current.add(pendingAtStart.notificationId);
      router.push(route as never);
    })();
  }, [
    clearForUnavailableTarget,
    hydrated,
    invalidTargetPending,
    ownerBinding,
    pending,
    role,
    rootNavigationState?.key,
    sessionBindingKey,
  ]);

  return null;
}

function RootLayout() {
  const isWeb = Platform.OS === 'web';
  const enableTourGuide = Platform.OS === 'android';

  useInAppUpdate();

  useEffect(() => {
    function extractReferralCode(url: string | null): string | null {
      if (!url) return null;
      try {
        const parsed = Linking.parse(url);
        const code = parsed.queryParams?.code;
        if (typeof code !== 'string' || !code.trim()) return null;
        if (parsed.path === 'signup' || parsed.hostname === 'signup') return code.trim();
      } catch {}
      return null;
    }

    // cold start: expo-router가 이미 /signup으로 라우팅하므로 코드 저장만
    Linking.getInitialURL().then((url) => {
      const code = extractReferralCode(url);
      if (code) savePendingReferralCode(code).catch(() => {});
    }).catch(() => {});

    // warm start: 코드 저장 후 /signup으로 이동
    const sub = Linking.addEventListener('url', (event) => {
      const code = extractReferralCode(event.url);
      if (code) {
        savePendingReferralCode(code).then(() => {
          router.replace({
            pathname: '/signup',
            params: { referralNonce: `${Date.now()}` },
          });
        }).catch(() => {});
      }
    });
    return () => sub.remove();
  }, []);

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
  const [showSplash, setShowSplash] = useState(true);
  const [error, setError] = useState<Error | null>(null);

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
    if (error) {
      logger.warn('[font] failed to load fonts, continuing without custom fonts', error);
      setLoaded(true);
    }
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
        await NavigationBar.setBackgroundColorAsync(DEFAULT_SCREEN_BACKGROUND);
        await NavigationBar.setStyle('dark');
      } catch (err) {
        logger.warn('NavigationBar/Notification setup failed', err);
      }
    })();
  }, []);

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1, position: 'relative', backgroundColor: DEFAULT_SCREEN_BACKGROUND }}>
        <SafeAreaProvider>
          <QueryClientProvider client={queryClient}>
            <SessionProvider>
              <NotificationNavigationBootstrap />
              <PresenceBootstrap />
              <AppAlertProvider>
                <ToastProvider>
                  <ThemeProvider value={GARAMIN_LIGHT_THEME}>
                    {enableTourGuide ? (
                      <TourGuideProvider
                        borderRadius={16}
                        labels={{ skip: '건너뛰기', previous: '이전', next: '다음', finish: '완료' }}
                        tooltipComponent={FcTourTooltip}
                        androidStatusBarVisible
                        verticalOffset={0}>
                        <Stack
                          initialRouteName="login"
                          screenOptions={defaultStackScreenOptions}>
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
                          <Stack.Screen name="login" options={{ headerShown: false }} />
                          <Stack.Screen
                            name="signup"
                            options={{
                              ...authHeader,
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
                              ...authHeader,
                              title: '비밀번호 재설정',
                              headerLeft: () => (
                                <Pressable onPress={() => router.replace('/login')} style={{ padding: 8, marginLeft: -8 }}>
                                  <Feather name="arrow-left" size={24} color="#000" />
                                </Pressable>
                              ),
                            }}
                          />
                          <Stack.Screen
                            name="first-password-change"
                            options={{
                              ...authHeader,
                              title: '새 비밀번호 설정',
                              headerBackVisible: false,
                              gestureEnabled: false,
                            }}
                          />
                          <Stack.Screen
                            name="signup-verify"
                            options={{
                              ...authHeader,
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
                              ...authHeader,
                              title: '비밀번호 설정',
                              headerLeft: () => (
                                <Pressable onPress={() => router.replace('/signup-verify')} style={{ padding: 8, marginLeft: -8 }}>
                                  <Feather name="arrow-left" size={24} color="#000" />
                                </Pressable>
                              ),
                            }}
                          />
                          <Stack.Screen name="apply-gate" options={{ ...baseHeader, title: '추가 정보 입력 안내' }} />
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
                          <Stack.Screen name="consent" options={{ ...baseHeader, title: '보증 보험 동의' }} />
                          <Stack.Screen name="docs-upload" options={{ ...baseHeader, title: '필수 서류 업로드' }} />
                          <Stack.Screen name="exam-apply" options={{ ...baseHeader, title: '생명/제3보험 시험 신청' }} />
                          <Stack.Screen name="exam-apply2" options={{ ...baseHeader, title: '손해보험 시험 신청' }} />
                          <Stack.Screen
                            name="messenger"
                            options={{
                              ...baseHeader,
                              headerShown: false,
                              title: '메신저',
                              headerLeft: () => (
                                <Pressable
                                  onPress={() => goBackOrReplace(router, '/')}
                                  style={{ padding: 8, marginLeft: -8 }}
                                >
                                  <Feather name="arrow-left" size={24} color="#000" />
                                </Pressable>
                              ),
                            }}
                          />
                          <Stack.Screen name="group-chat" options={{ headerShown: false }} />
                          <Stack.Screen name="chat" options={{ headerShown: false }} />
                          <Stack.Screen name="messenger-search" options={{ headerShown: false }} />
                          <Stack.Screen name="new-conversation" options={{ headerShown: false }} />
                          <Stack.Screen name="settings" options={{ ...baseHeader, title: '설정' }} />
                          <Stack.Screen name="notification-settings" options={{ headerShown: false }} />
                          <Stack.Screen name="muted-conversations" options={{ headerShown: false }} />

                          <Stack.Screen name="dashboard" options={{ ...baseHeader, title: '전체 현황' }} />
                          <Stack.Screen name="appointment" options={{ ...baseHeader, title: '생명/손해 위촉' }} />
                          <Stack.Screen name="notifications" options={{ ...baseHeader, title: '알림' }} />
                          <Stack.Screen name="notice" options={{ ...baseHeader, title: '공지사항' }} />
                          <Stack.Screen name="notice-detail" options={{ ...baseHeader, title: '공지 상세' }} />
                          <Stack.Screen name="board-detail" options={{ ...baseHeader, title: '게시글 상세' }} />
                          <Stack.Screen name="request-board" options={{ ...baseHeader, title: '설계 요청' }} />
                          <Stack.Screen name="request-board-create" options={{ ...baseHeader, title: '설계 요청 작성' }} />

                          <Stack.Screen name="request-board-messenger" options={{ ...baseHeader, title: '설계요청 메신저' }} />
                          <Stack.Screen name="admin-notice" options={{ ...baseHeader, title: '공지 등록' }} />
                          <Stack.Screen name="exams/life" options={{ ...baseHeader, title: '생명 시험 등록' }} />
                          <Stack.Screen name="exams/nonlife" options={{ ...baseHeader, title: '손해 시험 등록' }} />
                          <Stack.Screen name="exam-register" options={{ ...baseHeader, title: '생명 시험 등록' }} />
                          <Stack.Screen name="exam-register2" options={{ ...baseHeader, title: '손해 시험 등록' }} />
                          <Stack.Screen name="exam-manage" options={{ ...baseHeader, title: '생명/제3 신청자 관리' }} />
                          <Stack.Screen name="exam-manage2" options={{ ...baseHeader, title: '손해 신청자 관리' }} />
                          <Stack.Screen name="referral" options={{ ...baseHeader, title: '추천인 코드' }} />
                          <Stack.Screen name="referral-tree" options={{ ...baseHeader, title: '추천 관계 전체 보기' }} />
                          <Stack.Screen name="referral-graph" options={{ ...baseHeader, title: '추천 관계 그래프' }} />
                          <Stack.Screen name="referral-revenue-graph" options={{ ...baseHeader, title: '매출 기여 그래프' }} />
                        </Stack>

                        <StatusBar style="dark" backgroundColor={DEFAULT_SCREEN_BACKGROUND} />
                      </TourGuideProvider>
                    ) : (
                      <>
                        <Stack
                          initialRouteName="login"
                          screenOptions={defaultStackScreenOptions}>
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
                          <Stack.Screen name="login" options={{ headerShown: false }} />
                          <Stack.Screen
                            name="signup"
                            options={{
                              ...authHeader,
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
                              ...authHeader,
                              title: '비밀번호 재설정',
                              headerLeft: () => (
                                <Pressable onPress={() => router.replace('/login')} style={{ padding: 8, marginLeft: -8 }}>
                                  <Feather name="arrow-left" size={24} color="#000" />
                                </Pressable>
                              ),
                            }}
                          />
                          <Stack.Screen
                            name="first-password-change"
                            options={{
                              ...authHeader,
                              title: '새 비밀번호 설정',
                              headerBackVisible: false,
                              gestureEnabled: false,
                            }}
                          />
                          <Stack.Screen
                            name="signup-verify"
                            options={{
                              ...authHeader,
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
                              ...authHeader,
                              title: '비밀번호 설정',
                              headerLeft: () => (
                                <Pressable onPress={() => router.replace('/signup-verify')} style={{ padding: 8, marginLeft: -8 }}>
                                  <Feather name="arrow-left" size={24} color="#000" />
                                </Pressable>
                              ),
                            }}
                          />
                          <Stack.Screen name="apply-gate" options={{ ...baseHeader, title: '추가 정보 입력 안내' }} />
                          <Stack.Screen name="identity" options={{ ...baseHeader, title: '신원 확인' }} />
                          <Stack.Screen name="fc/new" options={{ ...baseHeader, title: '기본 정보' }} />
                          <Stack.Screen name="consent" options={{ ...baseHeader, title: '보증 보험 동의' }} />
                          <Stack.Screen name="docs-upload" options={{ ...baseHeader, title: '필수 서류 업로드' }} />
                          <Stack.Screen name="exam-apply" options={{ ...baseHeader, title: '생명/제3보험 시험 신청' }} />
                          <Stack.Screen name="exam-apply2" options={{ ...baseHeader, title: '손해보험 시험 신청' }} />
                          <Stack.Screen
                            name="messenger"
                            options={{
                              ...baseHeader,
                              headerShown: false,
                              title: '메신저',
                              headerLeft: () => (
                                <Pressable
                                  onPress={() => goBackOrReplace(router, '/')}
                                  style={{ padding: 8, marginLeft: -8 }}
                                >
                                  <Feather name="arrow-left" size={24} color="#000" />
                                </Pressable>
                              ),
                            }}
                          />
                          <Stack.Screen name="group-chat" options={{ headerShown: false }} />
                          <Stack.Screen name="chat" options={{ headerShown: false }} />
                          <Stack.Screen name="messenger-search" options={{ headerShown: false }} />
                          <Stack.Screen name="new-conversation" options={{ headerShown: false }} />
                          <Stack.Screen name="settings" options={{ ...baseHeader, title: '설정' }} />
                          <Stack.Screen name="notification-settings" options={{ headerShown: false }} />
                          <Stack.Screen name="muted-conversations" options={{ headerShown: false }} />

                          <Stack.Screen name="dashboard" options={{ ...baseHeader, title: '전체 현황' }} />
                      <Stack.Screen name="appointment" options={{ ...baseHeader, title: '생명/손해 위촉' }} />
                          <Stack.Screen name="notifications" options={{ ...baseHeader, title: '알림' }} />
                          <Stack.Screen name="notice" options={{ ...baseHeader, title: '공지사항' }} />
                          <Stack.Screen name="notice-detail" options={{ ...baseHeader, title: '공지 상세' }} />
                          <Stack.Screen name="board-detail" options={{ ...baseHeader, title: '게시글 상세' }} />
                          <Stack.Screen name="request-board" options={{ ...baseHeader, title: '설계 요청' }} />
                          <Stack.Screen name="request-board-create" options={{ ...baseHeader, title: '설계 요청 작성' }} />

                          <Stack.Screen name="request-board-messenger" options={{ ...baseHeader, title: '설계요청 메신저' }} />
                          <Stack.Screen name="admin-notice" options={{ ...baseHeader, title: '공지 등록' }} />
                          <Stack.Screen name="exams/life" options={{ ...baseHeader, title: '생명 시험 등록' }} />
                          <Stack.Screen name="exams/nonlife" options={{ ...baseHeader, title: '손해 시험 등록' }} />
                          <Stack.Screen name="exam-register" options={{ ...baseHeader, title: '생명 시험 등록' }} />
                          <Stack.Screen name="exam-register2" options={{ ...baseHeader, title: '손해 시험 등록' }} />
                          <Stack.Screen name="exam-manage" options={{ ...baseHeader, title: '생명/제3 신청자 관리' }} />
                          <Stack.Screen name="exam-manage2" options={{ ...baseHeader, title: '손해 신청자 관리' }} />
                          <Stack.Screen name="referral" options={{ ...baseHeader, title: '추천인 코드' }} />
                          <Stack.Screen name="referral-tree" options={{ ...baseHeader, title: '추천 관계 전체 보기' }} />
                          <Stack.Screen name="referral-graph" options={{ ...baseHeader, title: '추천 관계 그래프' }} />
                          <Stack.Screen name="referral-revenue-graph" options={{ ...baseHeader, title: '매출 기여 그래프' }} />
                        </Stack>
                        <StatusBar style="dark" backgroundColor={DEFAULT_SCREEN_BACKGROUND} />
                      </>
                    )}
                  </ThemeProvider>
                </ToastProvider>
              </AppAlertProvider>
            </SessionProvider>
          </QueryClientProvider>
        </SafeAreaProvider>
        {showSplash && <SplashAnimation onDone={() => setShowSplash(false)} />}
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}

export default withSentryRoot(RootLayout);
