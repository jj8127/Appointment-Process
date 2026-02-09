import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import * as Notifications from 'expo-notifications';
import { Stack, router, useFocusEffect } from 'expo-router';
import { MotiView } from 'moti';
import { type ElementRef, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View
} from 'react-native';
import Animated, { useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { TourGuideZone, useTourGuideController } from 'rn-tourguide';

import { ImageTourGuide, TourStep } from '@/components/ImageTourGuide';
import { Skeleton } from '@/components/LoadingSkeleton';
import { RefreshButton } from '@/components/RefreshButton';
import { useIdentityStatus } from '@/hooks/use-identity-status';
import { useSession } from '@/hooks/use-session';
import { useInAppUpdate } from '@/hooks/useInAppUpdate';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import type { FCDocument } from '@/types/dashboard';
import type { FcProfile } from '@/types/fc';

const SHORTCUT_GUIDE_STEPS: TourStep[] = [
  {
    x: 26,
    y: 17,
    width: 46,
    height: 22,
    title: '시험 신청',
    description: '생명/제3보험 및 손해보험 시험을\n여기서 간편하게 신청할 수 있습니다.',
    tooltipPosition: 'bottom',
  },
  {
    x: 75,
    y: 17,
    width: 46,
    height: 22,
    title: '손해 시험 신청',
    description: '손해보험 시험 접수가 필요한 경우\n여기서 진행할 수 있습니다.',
    tooltipPosition: 'bottom',
  },
  {
    x: 26,
    y: 41,
    width: 46,
    height: 22,
    title: '기본 정보',
    description: '이름, 소속, 이메일 등\n인적사항을 관리할 수 있습니다.',
  },
  {
    x: 75,
    y: 41,
    width: 46,
    height: 22,
    title: '수당 동의',
    description: '위촉 과정에 필요한 수당 지급 약관에\n동의하였는지 관리합니다.',
  },
  {
    x: 26,
    y: 64, // Adjusted from 55 to avoid overlap with row 2 (y=50)
    width: 46,
    height: 22,
    title: '서류 업로드',
    description: '합격증, 수료증 등 필수 서류를\n여기서 바로 등록하세요.',
    tooltipPosition: 'top',
  },
  {
    x: 75,
    y: 64, // Adjusted from 55
    width: 46,
    height: 22,
    title: '위촉',
    description: '보험사 위촉 진행을 위한 모바일 URL에\n쉽게 접속할 수 있습니다.',
    tooltipPosition: 'top',
  },
  {
    x: 26,
    y: 87, // Adjusted from 75 to be Row 4
    width: 46,
    height: 22,
    title: '1:1 문의',
    description: '궁금한 점이 있다면 총무팀에게\n언제든지 메시지를 보내보세요.',
    tooltipPosition: 'top',
  },
];

// Android Crash Fix: Strips Moti props on Android to prevent Reanimated from attaching to unmounting views
const AndroidSafeMotiView = ({ from, animate, transition, state, exit, exitTransition, delay, ...props }: any) => {
  if (Platform.OS === 'android') {
    return <View {...props} />;
  }
  return (
    <MotiView
      from={from}
      animate={animate}
      transition={transition}
      state={state}
      exit={exit}
      exitTransition={exitTransition}
      delay={delay}
      {...props}
    />
  );
};
// ... rest of imports/constants ...




const HANWHA_ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const TEXT_MUTED = '#6b7280';
const BORDER = '#e5e7eb';
const ORANGE_FAINT = '#fff1e6';
type StepKey = 'step1' | 'step2' | 'step3' | 'step4' | 'step5';
type StepCounts = Record<StepKey, number>;
type CountsResult = { total: number; steps: StepCounts };
const EMPTY_STEP_COUNTS: StepCounts = { step1: 0, step2: 0, step3: 0, step4: 0, step5: 0 };

const CARD_SHADOW = {
  shadowColor: '#000',
  shadowOpacity: 0.04,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 4 },
  elevation: 3,
};

type QuickLink = { href: string; title: string; description: string; stepKey?: StepKey };

const quickLinksAdminOnboarding: QuickLink[] = [
  { href: '/dashboard', stepKey: 'step2', title: '수당 동의 안내', description: '기본 정보 저장 완료 FC' },
  { href: '/dashboard', stepKey: 'step3', title: '서류 안내/검토', description: '제출해야 할 서류 관리' },
  { href: '/dashboard', stepKey: 'step4', title: '위촉 진행', description: '위촉 확인' },
  { href: '/dashboard', stepKey: 'step5', title: '완료 관리', description: '위촉 완료 현황' },
  { href: '/admin-board', title: '게시판 작성', description: '정보 게시판 글쓰기' },
  { href: '/admin-notice', title: '공지 등록', description: '새소식 작성' },
  { href: '/admin-messenger', title: '메신저', description: 'FC 1:1 대화 관리' },
];

const quickLinksAdminExam: QuickLink[] = [
  { href: '/exams/life', title: '생명보험/제3보험 시험', description: '응시일정 · 마감 관리' },
  { href: '/exams/nonlife', title: '손해보험 시험', description: '응시일정 · 마감 관리' },
  { href: '/exam-manage', title: '생명/제3 신청자', description: '신청 현황 조회' },
  { href: '/exam-manage2', title: '손해 신청자', description: '신청 현황 조회' },
];

const quickLinksFc: QuickLink[] = [
  { href: '/exam-apply', title: '생명/제3 시험 신청', description: '시험 접수하기' },
  { href: '/exam-apply2', title: '손해 시험 신청', description: '시험 접수하기' },
  { href: '/fc/new', title: '기본 정보', description: '인적사항 수정' },
  { href: '/consent', title: '수당 동의', description: '약관 동의 관리' },
  { href: '/docs-upload', title: '서류 업로드', description: '필수 서류 제출' },
  { href: '/appointment', title: '위촉', description: '위촉 URL 접속 및 완료' },
  { href: '/chat', title: '1:1 문의', description: '총무팀과 대화하기' },
];

const steps = [
  { key: 'info', label: '회원가입', fullLabel: '회원가입' },
  { key: 'consent', label: '수당동의', fullLabel: '수당 동의' },
  { key: 'docs', label: '문서제출', fullLabel: '문서 제출' },
  { key: 'url', label: '위촉URL', fullLabel: '위촉 URL 진행' },
  { key: 'final', label: '완료', fullLabel: '최종 완료' },
];

const fetchCounts = async (role: 'admin' | 'fc' | null, residentId: string): Promise<CountsResult> => {
  if (role !== 'admin') {
    return { total: 0, steps: { ...EMPTY_STEP_COUNTS } };
  }

  const { data, error } = await supabase
    .from('fc_profiles')
    .select('name,affiliation,resident_id_masked,email,address,allowance_date,appointment_date,status,fc_documents(doc_type,storage_path,status)');
  if (error) throw error;

  const steps: StepCounts = { ...EMPTY_STEP_COUNTS };
  const profiles = (data ?? []) as FcProfile[];
  profiles.forEach((profile: FcProfile) => {
    const key = getStepKey(profile);
    steps[key] += 1;
  });

  return {
    total: data?.length ?? 0,
    steps,
  };
};

const ADMIN_METRIC_CONFIG: { label: string; key: StepKey }[] = [
  { label: '1단계 수당동의', key: 'step2' },
  { label: '2단계 문서제출', key: 'step3' },
  { label: '3단계 위촉진행', key: 'step4' },
  { label: '4단계 완료', key: 'step5' },
];

const fetchLatestNotice = async () => {
  try {
    const { data, error } = await supabase.functions.invoke('fc-notify', {
      body: { type: 'latest_notice' },
    });
    if (error) throw error;
    if (!data?.ok) {
      throw new Error(data?.message ?? '최신 공지를 불러오지 못했습니다.');
    }
    return data.notice ?? null;
  } catch (err: unknown) {
    logger.debug('[Home] latest notice error', err);
    return null;
  }
};

const fetchLatestAdminMessage = async (residentId: string) => {
  if (!residentId) {
    logger.debug('[Home] residentId 없음');
    return null;
  }
  try {
    const { data: authRes } = await supabase.auth.getUser();
    logger.debug('[Home] latest admin msg start', { supabaseUserId: authRes?.user?.id, residentId });

    const { data, error } = await supabase
      .from('messages') // 테이블명이 다르면 여기 수정 필요
      .select('*') // 컬럼 구조 확인용
      .eq('receiver_id', residentId) // 내가 받은 메시지
      .neq('sender_id', residentId) // 내가 보낸 것은 제외
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      logger.error('[Home] latest admin msg error', error);
      return null;
    }

    logger.debug('[Home] latest admin msg data', data);
    const msg = data?.[0];
    if (!msg) return null;
    const content =
      (msg as any).content || (msg as any).text || (msg as any).message || (msg as any).body || '';
    return { ...msg, content };
  } catch (err) {
    logger.debug('[Home] latest admin msg exception', err);
    return null;
  }
};

const fetchUnreadMessageCount = async (residentId: string) => {
  if (!residentId) return 0;
  const { count, error } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('receiver_id', residentId)
    .eq('is_read', false);
  if (error) {
    logger.debug('[Home] unread msg error', error);
    return 0;
  }
  return count ?? 0;
};

const fetchUnreadNotificationCount = async (role: 'admin' | 'fc' | null, residentId: string | null) => {
  try {
    if (!role) return 0;
    const lastCheck = await AsyncStorage.getItem('lastNotificationCheckTime');
    const lastCheckDate = lastCheck ? new Date(lastCheck) : new Date(0);

    const { data, error } = await supabase.functions.invoke('fc-notify', {
      body: {
        type: 'inbox_unread_count',
        role,
        resident_id: role === 'fc' ? (residentId ?? null) : null,
        since: lastCheckDate.toISOString(),
      },
    });
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.message ?? '알림 개수 조회 실패');
    return Number(data.count ?? 0);
  } catch (e) {
    logger.debug('[Home] unread notif error', e);
    return 0;
  }
};

const fetchFcStatus = async (residentId: string) => {
  const { data, error } = await supabase
    .from('fc_profiles')
    .select(
      'id,name,affiliation,phone,status,temp_id,allowance_date,appointment_url,appointment_date,appointment_schedule_life,appointment_schedule_nonlife,appointment_date_life,appointment_date_nonlife,appointment_date_life_sub,appointment_date_nonlife_sub,resident_id_masked,email,address,is_tour_seen,signup_completed,fc_documents(doc_type,storage_path,status)',
    )
    .eq('phone', residentId)
    .maybeSingle();
  if (error) throw error;
  return data ?? {
    id: null,
    name: '',
    affiliation: '',
    status: 'draft',
    temp_id: null,
    allowance_date: null,
    appointment_url: null,
    appointment_date: null,
    appointment_schedule_life: null,
    appointment_schedule_nonlife: null,
    appointment_date_life: null,
    appointment_date_nonlife: null,
    appointment_date_life_sub: null,
    appointment_date_nonlife_sub: null,
    resident_id_masked: null,
    phone: null,
    email: null,
    address: null,
    is_tour_seen: false,
    fc_documents: [],
  };
};

type ExamStats = {
  lifeTotal: number;
  lifePending: number;
  nonlifeTotal: number;
  nonlifePending: number;
};

const fetchExamStats = async (): Promise<ExamStats> => {
  const countByType = async (examType: 'life' | 'nonlife') => {
    const { data, error } = await supabase
      .from('exam_registrations')
      .select('resident_id, is_confirmed, created_at, exam_rounds!inner(exam_type)')
      .eq('exam_rounds.exam_type', examType)
      .order('resident_id', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw error;

    const rows = data ?? [];
    const residentIds = Array.from(
      new Set(rows.map((row: any) => row.resident_id).filter((v: any): v is string => !!v)),
    );
    const existingResidents = new Set<string>();
    if (residentIds.length > 0) {
      const { data: profiles, error: profileErr } = await supabase
        .from('fc_profiles')
        .select('phone')
        .in('phone', residentIds);
      if (profileErr) throw profileErr;
      (profiles ?? []).forEach((p: any) => {
        if (p.phone) existingResidents.add(p.phone as string);
      });
    }

    const latestByResident = new Map<string, boolean>();
    rows.forEach((row: any) => {
      const residentId = row.resident_id;
      if (!residentId || !existingResidents.has(residentId)) return;
      latestByResident.set(residentId, Boolean(row.is_confirmed));
    });

    const total = latestByResident.size;
    const pending = Array.from(latestByResident.values()).filter((v) => !v).length;
    return { total, pending };
  };

  const [life, nonlife] = await Promise.all([countByType('life'), countByType('nonlife')]);
  return {
    lifeTotal: life.total,
    lifePending: life.pending,
    nonlifeTotal: nonlife.total,
    nonlifePending: nonlife.pending,
  };
};

function calcStep(myFc: any) {
  if (!myFc) return 1;

  // full home에 도달했다는 것은 identity가 완료되었다는 것
  // 신원확인 완료(주민번호 또는 주소 입력) 시 1단계 완료로 간주
  const hasIdentity = Boolean(myFc.resident_id_masked || myFc.address);
  logger.debug('[calcStep] Checking identity', {
    resident_id_masked: myFc.resident_id_masked,
    address: myFc.address,
    hasIdentity
  });
  if (!hasIdentity) return 1;

  // [1단계 우선] 수당 동의 완료 여부
  // 관리자 승인 이후에는 status가 allowance-pending이 아니므로 문서 단계로 진행
  const isAllowanceApproved = Boolean(myFc.allowance_date) && myFc.status !== 'allowance-pending';
  if (!isAllowanceApproved) {
    return 2; // 수당 동의 단계에서 대기
  }

  // [2단계 우선] 서류 승인 여부
  const docs = myFc.fc_documents ?? [];
  const allSubmitted =
    docs.length > 0 && docs.every((d: FCDocument) => d.storage_path && d.storage_path !== 'deleted');
  const allApproved = allSubmitted && docs.every((d: FCDocument) => d.status === 'approved');
  if (!allApproved) {
    return 3; // 서류 단계에서 대기
  }

  // [3단계 우선] 위촉 최종 완료 여부
  if (myFc.status !== 'final-link-sent') {
    return 4; // 위촉 진행 단계에서 대기 (총무 승인 필요)
  }

  // 모두 통과
  return 5;
}

const getStepKey = (profile: FcProfile): StepKey => {
  const step = Math.max(1, Math.min(5, calcStep(profile)));
  return `step${step}` as StepKey;
};

const getLinkIcon = (href: string) => {
  // 관리자 메뉴
  if (href.includes('status=step1')) return 'user-plus'; // 회원가입 관리
  if (href.includes('status=step2')) return 'check-square'; // 수당 동의 안내
  if (href.includes('status=step3')) return 'file-text'; // 서류 안내/검토
  if (href.includes('status=step4')) return 'link'; // 위촉 진행
  if (href.includes('status=step5')) return 'award'; // 완료 관리

  if (href.includes('/exams/')) return 'calendar'; // 시험 일정 등록
  if (href.includes('exam-manage')) return 'users'; // 신청자 관리
  if (href.includes('admin-appointment')) return 'send'; // URL 발송
  if (href.includes('admin-board')) return 'edit'; // 게시판 작성
  if (href.includes('admin-notice')) return 'bell'; // 공지 등록

  // FC 메뉴
  if (href.includes('fc/new')) return 'user'; // 기본 정보
  if (href.includes('exam-apply')) return 'edit-3'; // 시험 신청
  if (href.includes('consent')) return 'check-circle'; // 수당 동의
  if (href.includes('docs-upload')) return 'upload-cloud'; // 서류 업로드
  if (href.includes('appointment')) return 'smartphone'; // 위촉
  if (href.includes('admin-messenger')) return 'message-circle'; // 메신저
  if (href.includes('chat')) return 'message-circle'; // 1:1 문의

  return 'chevron-right';
};

export default function Home() {
  useInAppUpdate(); // Check for Android updates on mount
  const { role, residentId, displayName, logout, hydrated } = useSession();
  const { data: identityStatus, isLoading: identityLoading } = useIdentityStatus();

  const insets = useSafeAreaInsets();

  const lastScrollY = useSharedValue(0);
  const bottomNavTranslateY = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      const currentY = event.contentOffset.y;
      const dy = currentY - lastScrollY.value;

      if (currentY < 0) {
        bottomNavTranslateY.value = withTiming(0);
      } else if (currentY > 0) {
        if (dy > 10) {
          bottomNavTranslateY.value = withTiming(200, { duration: 300 });
        } else if (dy < -10) {
          bottomNavTranslateY.value = withTiming(0, { duration: 300 });
        }
      }
      lastScrollY.value = currentY;
    },
  });

  const bottomNavAnimatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateY: bottomNavTranslateY.value }],
    };
  });

  const [adminHomeTab, setAdminHomeTab] = useState<'onboarding' | 'exam'>('onboarding');
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showShortcutGuide, setShowShortcutGuide] = useState(false);

  const isAdminExam = role === 'admin' && adminHomeTab === 'exam';
  const adminNavItems = [
    { key: 'onboarding' as const, label: '위촉 홈', icon: 'home' as const },
    { key: 'exam' as const, label: '시험 홈', icon: 'book-open' as const },
  ];



  const {
    data: myFc,
    isLoading: statusLoading,
    refetch: refetchMyFc,
  } = useQuery({
    queryKey: ['my-fc-status', residentId],
    queryFn: () => (residentId ? fetchFcStatus(residentId) : Promise.resolve(null)),
    enabled: role === 'fc' && !!residentId,
  });

  // FC 전용 코치마크
  const { canStart, start, eventEmitter } = useTourGuideController();
  const isFc = role === 'fc';

  const [tourBlocking, setTourBlocking] = useState(false);

  useEffect(() => {
    if (!hydrated) return;
    if (role !== 'fc') return;
    if (identityLoading) return;
    if (identityStatus && !identityStatus.identityCompleted) {
      router.replace('/home-lite');
    }
  }, [hydrated, identityLoading, identityStatus, role]);

  useEffect(() => {
    if (!eventEmitter) return;

    const onStart = () => setTourBlocking(true);
    const onStop = () => setTourBlocking(false);

    // 투어 시작/종료 계열 이벤트로 blocking 토글
    eventEmitter.on('start', onStart);
    eventEmitter.on('stop', onStop);
    eventEmitter.on('finish', onStop);

    return () => {
      eventEmitter.off('start', onStart);
      eventEmitter.off('stop', onStop);
      eventEmitter.off('finish', onStop);
    };
  }, [eventEmitter]);

  // Auto-scroll refs
  const scrollViewRef = useRef<ElementRef<typeof Animated.ScrollView>>(null);
  const contentRef = useRef<View>(null);
  const zone2Ref = useRef<View>(null);
  const zone3Ref = useRef<View>(null);
  const zone4Ref = useRef<View>(null);

  const scrollToZoneMeasured = useCallback((zone: number) => {
    if (!contentRef.current) return;

    const targetRef =
      zone === 2 ? zone2Ref.current :
        zone === 3 ? zone3Ref.current :
          zone === 4 ? zone4Ref.current :
            null;

    if (!targetRef) return;

    const paddingTop = 24;

    // 핵심: contentRef(ScrollView 내부 콘텐츠) 기준으로 y를 직접 측정
    targetRef.measureLayout(
      contentRef.current,
      (_x, y) => {
        logger.debug(`[scrollToZoneMeasured] zone: ${zone}, measured y: ${y}`);
        const targetY = Math.max(0, y - paddingTop);
        requestAnimationFrame(() => {
          scrollViewRef.current?.scrollTo({ y: targetY, animated: true });
        });
      },
      () => {
        logger.debug('[measureLayout error]');
      }
    );
  }, []);

  useEffect(() => {
    const handleStepChange = (step: any) => {
      const z = step?.zone;
      logger.debug('[tour stepChange]', { step, zone: z });

      if (role !== 'fc') return;
      if (typeof z !== 'number') return;

      if (z === 2 || z === 3 || z === 4) {
        // 레이스 방지: 한 프레임 뒤에 측정/스크롤
        requestAnimationFrame(() => scrollToZoneMeasured(z));
      }
    };

    if (eventEmitter) {
      eventEmitter.on('stepChange', handleStepChange);
    }
    return () => {
      if (eventEmitter) {
        eventEmitter.off('stepChange', handleStepChange);
      }
    };
  }, [eventEmitter, role, scrollToZoneMeasured]);


  const startFcTour = useCallback(() => {
    if (!isFc) return;
    if (!canStart) return;

    Haptics.selectionAsync();
    start();
  }, [isFc, canStart, start]);







  useEffect(() => {
    if (role !== 'admin') {
      setAdminHomeTab('onboarding');
    }
  }, [role]);

  // 테스트용: Supabase 연결 확인 (컴포넌트 내부에서 실행)
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { count, error } = await supabase
          .from('device_tokens')
          .select('count', { count: 'exact', head: true });
        if (!active) return;
        if (error) {
          logger.debug('[supabase ping] 연결 실패', error.message ?? error);
        } else {
          logger.debug('[supabase ping] 연결 성공, device_tokens count', { count });
        }
      } catch (err: unknown) {
        const error = err as { message?: string };
        if (active) logger.debug('[supabase ping] 예외', error?.message ?? err);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const {
    data: counts,
    isLoading,
    refetch: refetchCounts,
  } = useQuery({
    queryKey: ['fc-counts', role, residentId],
    queryFn: () => fetchCounts(role, residentId),
    enabled: !!role,
  });



  const {
    data: latestNotice,
    refetch: refetchLatestNotice,
  } = useQuery({
    queryKey: ['latest-notice'],
    queryFn: fetchLatestNotice,
  });

  const quickLinks =
    role === 'admin'
      ? adminHomeTab === 'exam'
        ? quickLinksAdminExam
        : quickLinksAdminOnboarding
      : quickLinksFc;
  const {
    data: examStats,
    isLoading: examStatsLoading,
    refetch: refetchExamStats,
  } = useQuery({
    queryKey: ['exam-stats'],
    queryFn: fetchExamStats,
    enabled: role === 'admin',
  });
  const {
    data: latestAdminMsg,
    isLoading: latestAdminMsgLoading,
    refetch: refetchLatestAdminMsg,
  } = useQuery({
    queryKey: ['latest-admin-msg', residentId],
    queryFn: () => fetchLatestAdminMessage(residentId),
    enabled: role === 'fc' && !!residentId,
  });

  const currentStep = myFc ? calcStep(myFc) : 1;
  const activeStep = steps[Math.min(steps.length - 1, Math.max(0, currentStep - 1))];
  const profileName = typeof myFc?.name === 'string' ? myFc.name.trim() : '';
  const sessionName = displayName?.trim() ?? '';
  const fcWelcomeName = profileName || sessionName || 'FC';

  const uploadedDocs =
    myFc?.fc_documents?.filter((d: FCDocument) => d.storage_path && d.storage_path !== 'deleted').length ?? 0;
  const totalDocs = myFc?.fc_documents?.length ?? 0;
  const isAllSubmitted = totalDocs > 0 && uploadedDocs >= totalDocs;

  const isConsentStep = activeStep.key === 'consent';
  const isDocsStep = activeStep.key === 'docs';
  const isUrlStep = activeStep.key === 'url';

  const hasTempId = !!myFc?.temp_id;
  const hasAllowanceDate = !!myFc?.allowance_date;
  const hasUnapprovedDocs = myFc?.fc_documents?.some((d: FCDocument) => d.status !== 'approved');

  const schedLife = myFc?.appointment_schedule_life;
  const schedNon = myFc?.appointment_schedule_nonlife;
  // 기존 approved 날짜 or 제출한 날짜 있으면 입력 완료로 간주
  const dateLife = myFc?.appointment_date_life || myFc?.appointment_date_life_sub;
  const dateNon = myFc?.appointment_date_nonlife || myFc?.appointment_date_nonlife_sub;

  // Unread Counts
  const { data: unreadMsgCount = 0, refetch: refetchMsgCount } = useQuery({
    queryKey: ['unread-msg-count', residentId],
    queryFn: () => fetchUnreadMessageCount(residentId),
    enabled: !!residentId,
    refetchInterval: 5000,
  });

  const { data: unreadNotifCount = 0, refetch: refetchNotifCount } = useQuery({
    queryKey: ['unread-notif-count', role, residentId],
    queryFn: () => fetchUnreadNotificationCount(role, residentId),
    enabled: !!role,
    refetchInterval: 5000, // Poll every 5s for notifications
  });

  // Refresh counts on focus
  useFocusEffect(
    useCallback(() => {
      refetchMsgCount();
      refetchNotifCount();
    }, [refetchMsgCount, refetchNotifCount])
  );




  const hasAnySchedule = !!schedLife || !!schedNon;
  const isMissingDates = (!!schedLife && !dateLife) || (!!schedNon && !dateNon);

  let nextStepSubText = '터치하여 바로 진행하세요';
  let isNextStepDisabled = !stepToLink(activeStep.key);

  if (isConsentStep) {
    if (hasAllowanceDate) {
      nextStepSubText = '총무가 검토 중입니다. 기다려주세요.';
    } else if (!hasTempId) {
      nextStepSubText = '총무가 임시사번을 발급중입니다. 기다려주세요.';
    } else {
      nextStepSubText = '터치하여 바로 진행하세요';
    }
  } else if (isDocsStep) {
    if (totalDocs === 0) {
      nextStepSubText = '총무가 필요한 서류들을 검토 중입니다.';
    } else if (!isAllSubmitted) {
      nextStepSubText = '모든 문서를 제출하세요.';
    } else if (hasUnapprovedDocs) {
      nextStepSubText = '서류를 검토중입니다.';
    }
  } else if (isUrlStep) {
    if (!hasAnySchedule) {
      nextStepSubText = '위촉 차수를 입력중입니다. 기다려주세요.';
    } else if (isMissingDates) {
      nextStepSubText = '터치하여 위촉을 진행해 주세요';
    } else {
      nextStepSubText = '위촉 완료 여부를 검토중입니다.';
    }
  } else if (activeStep.key === 'final') {
    nextStepSubText = '모든 위촉 과정이 끝났습니다.';
  }
  const getAppointmentStatus = (
    date: string | null | undefined,
    submittedDate: string | null | undefined,
    schedule: string | null | undefined,
  ) => {
    if (date) return { label: '완료', color: '#ffffff', bg: '#16a34a' };
    if (submittedDate) return { label: '입력됨(승인대기)', color: '#ffffff', bg: '#f97316' };
    if (schedule) return { label: `${schedule}진행중`, color: '#fcfcfcff', bg: '#f97316' };
    return { label: '진행중', color: '#ffffff', bg: '#2563eb' };
  };

  const lifeStatus = getAppointmentStatus(
    myFc?.appointment_date_life,
    myFc?.appointment_date_life_sub,
    myFc?.appointment_schedule_life,
  );
  const nonLifeStatus = getAppointmentStatus(
    myFc?.appointment_date_nonlife,
    myFc?.appointment_date_nonlife_sub,
    myFc?.appointment_schedule_nonlife,
  );

  useEffect(() => {
    if (!hydrated) return;
    if (!role) {
      router.replace('/login');
    }
  }, [hydrated, role]);

  // 기본정보는 회원가입 시 이미 저장되므로 강제 리다이렉트 제거
  // 사용자가 홈 화면의 "기본 정보" 버튼을 눌러 자발적으로 편집 가능

  // FC 푸시 토큰 등록 (배너 알림 수신용)
  const PUSH_CHANNEL_ID = 'alerts';

  useEffect(() => {
    let active = true;
    (async () => {
      if (role !== 'fc' || !residentId) return;
      try {
        const { status } = await Notifications.requestPermissionsAsync();
        if (status !== 'granted') {
          logger.debug('[push] permission denied');
          return;
        }
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync(PUSH_CHANNEL_ID, {
            name: '중요 알림',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            sound: 'default',
            lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
          });
        }

        const { data: token } = await Notifications.getExpoPushTokenAsync({
          projectId: Constants.expoConfig?.extra?.eas?.projectId,
        });
        if (!active || !token) return;

        // 디바이스 중복 방지: 기존 토큰 제거 후 upsert (unique constraint 대응)
        await supabase.from('device_tokens').delete().eq('expo_push_token', token);
        const { error } = await supabase
          .from('device_tokens')
          .upsert(
            { resident_id: residentId, role: 'fc', expo_push_token: token },
            { onConflict: 'expo_push_token' }
          );
        if (error) {
          logger.debug('[push] upsert error', error.message ?? error);
        } else {
          logger.debug('[push] fc token saved', { residentId, token });
        }
      } catch (e: unknown) {
        const error = e as { message?: string };
        logger.debug('[push] exception', error?.message ?? e);
      }
    })();
    return () => {
      active = false;
    };
  }, [role, residentId]);

  const handleLogout = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (Platform.OS === 'android') {
      setIsLoggingOut(true);
      setTimeout(() => {
        logout();
      }, 100);
    } else {
      logout();
    }
  };

  const handleAdminTabChange = (tab: 'onboarding' | 'exam') => {
    if (tab === adminHomeTab) return;
    Haptics.selectionAsync();
    setAdminHomeTab(tab);
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        refetchCounts?.(),
        refetchMyFc?.(),
        refetchLatestNotice?.(),
        refetchLatestAdminMsg?.(),
        refetchExamStats?.(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [refetchCounts, refetchLatestNotice, refetchLatestAdminMsg, refetchMyFc, refetchExamStats]);

  const handlePressLink = (href: string, stepKey?: StepKey) => {
    Haptics.selectionAsync();
    if (stepKey) {
      router.push(`/dashboard?status=${stepKey}` as any);
      return;
    }
    if (href === '/fc/new') {
      router.push({ pathname: '/fc/new', params: { from: 'home' } } as any);
      return;
    }
    router.push(href as any);
  };

  const handleStatClick = (stepKey: StepKey) => {
    Haptics.selectionAsync();
    router.push(`/dashboard?status=${stepKey}` as any);
  };

  // 채팅에서 돌아올 때 최신 메시지 갱신
  useFocusEffect(
    useCallback(() => {
      if (role === 'fc' && residentId) {
        refetchLatestAdminMsg?.();
      }
    }, [refetchLatestAdminMsg, residentId, role]),
  );

  // 실시간: 새 메시지 도착 시 미리보기 즉시 갱신
  useEffect(() => {
    if (role !== 'fc' || !residentId) return;
    const channel = supabase
      .channel(`home-messages-${residentId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `receiver_id=eq.${residentId}` },
        (payload) => {
          const newMsg: any = payload.new;
          const content = newMsg?.content || newMsg?.text || newMsg?.message || newMsg?.body;
          if (content) {
            refetchLatestAdminMsg?.();
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refetchLatestAdminMsg, residentId, role]);

  // 실시간: 내 프로필 변경 시 진행도 갱신
  useEffect(() => {
    if (role !== 'fc' || !residentId) return;
    const profileChannel = supabase
      .channel(`home-profile-${residentId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'fc_profiles', filter: `phone=eq.${residentId}` },
        () => refetchMyFc?.(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(profileChannel);
    };
  }, [role, residentId, refetchMyFc]);

  // 실시간: 내 서류 상태 변경 시 진행도 갱신
  useEffect(() => {
    if (role !== 'fc' || !myFc?.id) return;
    const docChannel = supabase
      .channel(`home-docs-${myFc.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'fc_documents', filter: `fc_id=eq.${myFc.id}` },
        () => refetchMyFc?.(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(docChannel);
    };
  }, [role, myFc?.id, refetchMyFc]);

  // Android Crash Fix: Wait for all hooks to be valid, then short-circuit layout
  if (isLoggingOut) {
    return (
      <View style={{ flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={HANWHA_ORANGE} />
      </View>
    );
  }

  if (!hydrated) {
    return (
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <View style={[styles.container, { alignItems: 'center', justifyContent: 'center', flex: 1 }]}>
          <ActivityIndicator color={HANWHA_ORANGE} />
        </View>
      </SafeAreaView>
    );
  }

  const contentBottomPadding = (role === 'admin' ? 160 : 96) + (insets.bottom || 0);

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <Animated.ScrollView
        ref={scrollViewRef}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        scrollEnabled={!tourBlocking}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
      >

        <View
          ref={contentRef}
          collapsable={false}
          style={[styles.container, { paddingBottom: contentBottomPadding }]}
        >
          <View style={styles.topBar}>
            <View style={styles.topActions}>
              <Pressable style={styles.logoutButton} onPress={handleLogout}>
                <Text style={styles.logoutText}>로그아웃</Text>
              </Pressable>
              <Pressable style={styles.bellButton} onPress={() => router.push('/settings')}>
                <Feather name="settings" size={20} color={CHARCOAL} />
              </Pressable>
              <Pressable style={styles.bellButton} onPress={() => router.push('/notifications')}>
                <Feather name="bell" size={20} color={CHARCOAL} />
                {unreadNotifCount > 0 && (
                  <View
                    style={{
                      position: 'absolute',
                      top: -8,
                      right: -8,
                      minWidth: 24,
                      height: 24,
                      borderRadius: 12,
                      backgroundColor: '#EF4444',
                      justifyContent: 'center',
                      alignItems: 'center',
                      borderWidth: 1,
                      borderColor: '#fff',
                    }}
                  >
                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>
                      {unreadNotifCount > 99 ? '99+' : unreadNotifCount}
                    </Text>
                  </View>
                )}
              </Pressable>
            </View>
            <View style={styles.rightActions}>
              <RefreshButton />
            </View>
          </View>

          {role === 'admin' && (
            <View style={styles.homeTitleWrap}>
              <Text style={styles.homeTitle}>{adminHomeTab === 'exam' ? '시험 홈' : '위촉 홈'}</Text>
              <Text style={styles.homeSubtitleText}>
                {adminHomeTab === 'exam'
                  ? '시험 일정 등록과 신청자 관리 메뉴를 모았습니다.'
                  : '위촉/서류 진행 현황과 주요 업무를 확인하세요.'}
              </Text>
            </View>
          )}

          {role === 'fc' ? (
            <Stack.Screen
              options={{
                title: `${fcWelcomeName}님 환영합니다`,
                headerLeft: () => null,
              }}
            />
          ) : (
            <Stack.Screen
              options={{
                headerLeft: () => null,
              }}
            />
          )}



          {isFc ? (
            <View collapsable={false}>
              <AndroidSafeMotiView from={{ opacity: 0, translateY: -10 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 500 }}>
                <TourGuideZone
                  zone={1}
                  text="여기서 최신 공지를 확인해요. 눌러서 상세로 이동할 수 있어요."
                  borderRadius={12}>
                  <Pressable
                    style={({ pressed }) => [styles.notice, pressed && styles.pressedOpacity]}
                    onPress={() => handlePressLink('/notice')}>
                    <View style={styles.noticeDot} />
                    <Text style={styles.noticeText} numberOfLines={1}>
                      {latestNotice?.title ? `공지: ${latestNotice.title}` : '공지: 최신 공지사항을 확인하세요'}
                    </Text>
                    <Feather name="chevron-right" size={16} color={HANWHA_ORANGE} style={{ marginLeft: 'auto' }} />
                  </Pressable>
                </TourGuideZone>
              </AndroidSafeMotiView>
            </View>
          ) : (
            <AndroidSafeMotiView from={{ opacity: 0, translateY: -10 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 500 }}>
              <Pressable
                style={({ pressed }) => [styles.notice, pressed && styles.pressedOpacity]}
                onPress={() => handlePressLink('/notice')}>
                <View style={styles.noticeDot} />
                <Text style={styles.noticeText} numberOfLines={1}>
                  {latestNotice?.title ? `공지: ${latestNotice.title}` : '공지: 최신 공지사항을 확인하세요'}
                </Text>
                <Feather name="chevron-right" size={16} color={HANWHA_ORANGE} style={{ marginLeft: 'auto' }} />
              </Pressable>
            </AndroidSafeMotiView>
          )}

          {/* Guide Card (Modern) - Moved below Notice */}
          {role === 'fc' && (
            <AndroidSafeMotiView
              from={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', delay: 180 }}
              style={{ marginBottom: 10 }}
            >
              <Pressable
                onPress={startFcTour}
                accessibilityRole="button"
                accessibilityLabel="앱 사용 가이드 시작"
                style={({ pressed }) => [
                  styles.guideCardNew,
                  pressed && styles.guideCardNewPressed,
                ]}
              >
                {/* Left icon */}
                <View style={styles.guideIconWrapNew}>
                  <LinearGradient
                    colors={['#fff7ed', '#ffffff']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.guideIconGradientNew}
                  >
                    <Feather name="play" size={16} color={HANWHA_ORANGE} style={{ marginLeft: 1 }} />
                  </LinearGradient>
                </View>

                {/* Text */}
                <View style={styles.guideTextWrapNew}>
                  <View style={styles.guideBadgeRowNew}>
                    <View style={styles.guideBadgeNew}>
                      <Text style={styles.guideBadgeTextNew}>GUIDE</Text>
                    </View>
                    <Text style={styles.guideBadgeHintNew}>처음 오셨나요?</Text>
                  </View>

                  <Text style={styles.guideTitleNew} numberOfLines={1}>
                    앱 사용법 안내 시작하기
                  </Text>
                </View>

                {/* CTA */}
                <View style={styles.guideCtaNew}>
                  <View style={styles.guideCtaChipNew}>
                    <Text style={styles.guideCtaTextNew}>시작</Text>
                    <Feather name="chevron-right" size={16} color="#fff" />
                  </View>
                </View>
              </Pressable>
            </AndroidSafeMotiView>
          )}

          {!(role === 'admin' && adminHomeTab === 'exam') && (
            <>
              {role === 'admin' ? (
                <AndroidSafeMotiView from={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', delay: 100 }}>
                  <Pressable onPress={() => handlePressLink('/dashboard', 'step4')}>
                    <LinearGradient
                      colors={['#f36f21', '#fabc3c']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.ctaCard}
                    >
                      <View style={styles.ctaContent}>
                        <View style={[styles.ctaBadge, { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
                          <Text style={styles.ctaBadgeText}>관리자 할 일</Text>
                        </View>
                        <Text style={styles.ctaTitle}>
                          {isLoading ? '현황 조회 중...' : `서류 대기 ${counts?.steps?.step4 ?? 0}건`}
                        </Text>
                        <Text style={styles.ctaSub}>승인을 기다리는 FC 서류를 검토해주세요.</Text>
                      </View>
                      <View style={[styles.ctaIconCircle, { backgroundColor: 'rgba(255,255,255,0.1)' }]}>
                        <Feather name="file-text" size={24} color="#fff" />
                      </View>
                      <View style={styles.ctaDecoCircle} />
                    </LinearGradient>
                  </Pressable>
                </AndroidSafeMotiView>
              ) : isFc ? (
                <View ref={zone2Ref} collapsable={false}>
                  <TourGuideZone
                    zone={2}
                    text="총무팀과 1:1 문의를 할 수 있어요. 최근 메시지도 여기서 미리 볼 수 있어요."
                    borderRadius={24}>
                    <AndroidSafeMotiView from={{ opacity: 0, translateY: 10 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'spring', delay: 100 }}>
                      <Pressable onPress={() => handlePressLink('/chat')}>
                        <LinearGradient
                          colors={['#f36f21', '#fabc3c']}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={styles.ctaCard}
                        >
                          <View style={styles.ctaContent}>
                            <View style={styles.ctaBadge}>
                              <Text style={styles.ctaBadgeText}>1:1 문의</Text>
                            </View>
                            <Text style={styles.ctaTitle}>총무팀과 대화하기</Text>
                            <Text style={styles.ctaSub} numberOfLines={2}>
                              {latestAdminMsgLoading
                                ? '메시지 불러오는 중...'
                                : latestAdminMsg?.content
                                  ? latestAdminMsg.content
                                  : '최근 총무팀 메시지를 확인하세요.'}
                            </Text>
                          </View>
                          <View style={styles.ctaIconCircle}>
                            <Feather name="message-circle" size={24} color={HANWHA_ORANGE} />
                            {unreadMsgCount > 0 && (
                              <View
                                style={{
                                  position: 'absolute',
                                  top: -8,
                                  right: -8,
                                  minWidth: 24,
                                  height: 24,
                                  borderRadius: 12,
                                  backgroundColor: '#EF4444',
                                  justifyContent: 'center',
                                  alignItems: 'center',
                                  borderWidth: 1.5,
                                  borderColor: '#fff',
                                }}
                              >
                                <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>
                                  {unreadMsgCount > 99 ? '99+' : unreadMsgCount}
                                </Text>
                              </View>
                            )}
                          </View>
                          <View style={styles.ctaDecoCircle} />
                        </LinearGradient>
                      </Pressable>
                    </AndroidSafeMotiView>
                  </TourGuideZone>
                </View>
              ) : (
                <AndroidSafeMotiView from={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', delay: 100 }}>
                  <Pressable onPress={() => handlePressLink('/chat')}>
                    <LinearGradient
                      colors={['#f36f21', '#fabc3c']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.ctaCard}
                    >
                      <View style={styles.ctaContent}>
                        <View style={styles.ctaBadge}>
                          <Text style={styles.ctaBadgeText}>1:1 문의</Text>
                        </View>
                        <Text style={styles.ctaTitle}>총무팀과 대화하기</Text>
                        <Text style={styles.ctaSub} numberOfLines={2}>
                          {latestAdminMsgLoading
                            ? '메시지 불러오는 중...'
                            : latestAdminMsg?.content
                              ? latestAdminMsg.content
                              : '최근 총무팀 메시지를 확인하세요.'}
                        </Text>
                      </View>
                      <View style={styles.ctaIconCircle}>
                        <Feather name="message-circle" size={24} color={HANWHA_ORANGE} />
                      </View>
                      <View style={styles.ctaDecoCircle} />
                    </LinearGradient>
                  </Pressable>
                </AndroidSafeMotiView>
              )}
            </>
          )}

          <AndroidSafeMotiView
            from={{ opacity: 0, translateY: 20 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 600, delay: 200 }}
          >
            {role === 'admin' ? (
              isAdminExam ? (
                <View style={styles.examSummaryCard}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.sectionTitle}>시험 관리 요약</Text>
                    <Text style={styles.sectionHint}>등록 · 신청자 메뉴만 모았습니다</Text>
                  </View>
                  <Pressable
                    style={({ pressed }) => [styles.examStatRow, pressed && styles.pressedOpacity]}
                    onPress={() => handlePressLink('/exam-manage')}
                  >
                    <View style={styles.examStatTitleWrap}>
                      <Text style={styles.examStatTitle}>생명/제3보험</Text>
                      {examStatsLoading && <ActivityIndicator size="small" color={HANWHA_ORANGE} />}
                    </View>
                    <View style={styles.examStatChips}>
                      <View style={styles.examStatChip}>
                        <Text style={styles.examStatChipLabel}>응시자</Text>
                        <Text style={styles.examStatChipValue}>{examStats?.lifeTotal ?? 0}명</Text>
                      </View>
                      <View style={[styles.examStatChip, styles.examStatChipPending]}>
                        <Text style={styles.examStatChipLabel}>미접수</Text>
                        <Text style={[styles.examStatChipValue, styles.examStatChipValuePending]}>
                          {examStats?.lifePending ?? 0}명
                        </Text>
                      </View>
                    </View>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.examStatRow, pressed && styles.pressedOpacity]}
                    onPress={() => handlePressLink('/exam-manage2')}
                  >
                    <View style={styles.examStatTitleWrap}>
                      <Text style={styles.examStatTitle}>손해보험</Text>
                      {examStatsLoading && <ActivityIndicator size="small" color={HANWHA_ORANGE} />}
                    </View>
                    <View style={styles.examStatChips}>
                      <View style={styles.examStatChip}>
                        <Text style={styles.examStatChipLabel}>응시자</Text>
                        <Text style={styles.examStatChipValue}>{examStats?.nonlifeTotal ?? 0}명</Text>
                      </View>
                      <View style={[styles.examStatChip, styles.examStatChipPending]}>
                        <Text style={styles.examStatChipLabel}>미접수</Text>
                        <Text style={[styles.examStatChipValue, styles.examStatChipValuePending]}>
                          {examStats?.nonlifePending ?? 0}명
                        </Text>
                      </View>
                    </View>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.metricsCard}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.sectionTitle}>현황 요약</Text>
                  </View>
                  <View style={styles.metricsGrid}>
                    {isLoading ? (
                      <>
                        <Skeleton width="48%" height={90} />
                        <Skeleton width="48%" height={90} />
                        <Skeleton width="48%" height={90} />
                        <Skeleton width="48%" height={90} />
                      </>
                    ) : counts ? (
                      <>
                        {ADMIN_METRIC_CONFIG.map((metric) => (
                          <MetricCard
                            key={metric.label}
                            label={metric.label}
                            value={`${counts?.steps?.[metric.key] ?? 0}명`}
                            onPress={() => handleStatClick(metric.key)}
                          />
                        ))}
                      </>
                    ) : null}
                  </View>
                </View>
              )
            ) : isFc ? (
              <View>
                <View style={styles.progressCard}>
                  <View style={{ marginBottom: 5 }} collapsable={false}>
                    <View ref={zone3Ref} collapsable={false}>
                      <TourGuideZone
                        zone={3}
                        text="현재 위촉 진행 단계를 여기서 확인해요."
                        borderRadius={20}
                        maskOffset={8}
                      >
                        <View style={{ width: '100%' }}>
                          <View style={styles.cardHeader} collapsable={false}>
                            <Text style={styles.sectionTitle}>내 진행 상황</Text>
                            <Text style={styles.progressMeta}>Step {currentStep}/5</Text>
                          </View>
                          {statusLoading ? (
                            <View style={{ marginVertical: 20 }}>
                              <Skeleton width="100%" height={60} style={{ marginBottom: 12 }} />
                              <View style={{ flexDirection: 'row', gap: 8 }}>
                                <Skeleton width="48%" height={80} />
                                <Skeleton width="48%" height={80} />
                              </View>
                            </View>
                          ) : (
                            <>
                              {/* 위촉 상태 배지 행 */}
                              <View style={styles.statusRow}>
                                <View style={styles.statusItem}>
                                  <Text style={styles.statusLabel}>생명 위촉</Text>
                                  <View style={[styles.statusBadge, { backgroundColor: lifeStatus.bg }]}>
                                    <Text style={[styles.statusText, { color: lifeStatus.color }]}>{lifeStatus.label}</Text>
                                  </View>
                                </View>
                                <View style={styles.statusDivider} />
                                <View style={styles.statusItem}>
                                  <Text style={styles.statusLabel}>손해 위촉</Text>
                                  <View style={[styles.statusBadge, { backgroundColor: nonLifeStatus.bg }]}>
                                    <Text style={[styles.statusText, { color: nonLifeStatus.color }]}>{nonLifeStatus.label}</Text>
                                  </View>
                                </View>
                              </View>
                              {/* 진행 단계 (기존 Stepper) */}
                              <View style={[styles.stepContainer, { marginTop: 8 }]}>
                                {steps.map((step, index) => {
                                  const stepNum = index + 1;
                                  const isActive = stepNum === currentStep;
                                  const isDone = stepNum < currentStep;
                                  return (
                                    <View key={step.key} style={styles.stepWrapper}>
                                      {index < steps.length - 1 && (
                                        <View style={[styles.stepConnector, isDone && styles.stepConnectorDone]} />
                                      )}
                                      <View style={[styles.stepCircle, isActive && styles.stepCircleActive, isDone && styles.stepCircleDone]}>
                                        {isDone ? (
                                          <Feather name="check" size={14} color="#fff" />
                                        ) : (
                                          <Text style={[styles.stepNumber, isActive && styles.stepNumberActive]}>{stepNum}</Text>
                                        )}
                                      </View>
                                      <Text style={[styles.stepLabel, isActive && styles.stepLabelActive]}>{step.label}</Text>
                                    </View>
                                  );
                                })}
                              </View>
                            </>
                          )}
                        </View>
                      </TourGuideZone>
                    </View>
                  </View>

                  {/* Spacer to prevent Step 3 highlight from bleeding into Step 4 */}
                  <View style={{ height: 15 }} collapsable={false} />

                  <View style={styles.glanceRow}>
                    <View ref={zone4Ref} style={{ flex: 1 }} collapsable={false}>
                      <TourGuideZone
                        zone={4}
                        text="지금 해야 할 ‘다음 단계’로 바로 이동할 수 있어요."
                        borderRadius={20}
                        style={{ flex: 1 }}>
                        <Pressable
                          onPress={() => handlePressLink(stepToLink(activeStep.key))}
                          disabled={isNextStepDisabled}
                          style={({ pressed }) => [{ flex: 1 }, pressed && styles.pressedScale]}
                        >
                          <LinearGradient
                            colors={['#f36f21', '#fabc3c']}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={styles.premiumStepCard}
                          >
                            <View style={styles.premiumStepContent}>
                              <View style={styles.premiumStepHeader}>
                                <View style={styles.premiumStepBadge}>
                                  <Text style={styles.premiumStepBadgeText}>다음 단계</Text>
                                </View>
                                <View style={styles.premiumStepIcon}>
                                  <Feather name="arrow-right" size={20} color="#fff" />
                                </View>
                              </View>
                              <Text style={styles.premiumStepTitle} numberOfLines={1}>
                                {activeStep.fullLabel}
                              </Text>
                              <Text style={styles.premiumStepSub}>
                                {nextStepSubText}
                              </Text>
                            </View>
                            <View style={styles.premiumStepDeco1} />
                            <View style={styles.premiumStepDeco2} />
                          </LinearGradient>
                        </Pressable>
                      </TourGuideZone>
                    </View>
                  </View>
                </View>
              </View>
            ) : (
              <View style={styles.progressCard}>
                <View style={styles.cardHeader}>
                  <Text style={styles.sectionTitle}>내 진행 상황</Text>
                  <Text style={styles.progressMeta}>Step {currentStep}/5</Text>
                </View>
                {statusLoading ? (
                  <View style={{ marginVertical: 20 }}>
                    <Skeleton width="100%" height={60} style={{ marginBottom: 12 }} />
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Skeleton width="48%" height={80} />
                      <Skeleton width="48%" height={80} />
                    </View>
                  </View>
                ) : (
                  <View style={styles.stepContainer}>
                    {steps.map((step, index) => {
                      const stepNum = index + 1;
                      const isActive = stepNum === currentStep;
                      const isDone = stepNum < currentStep;
                      return (
                        <View key={step.key} style={styles.stepWrapper}>
                          {index < steps.length - 1 && (
                            <View style={[styles.stepConnector, isDone && styles.stepConnectorDone]} />
                          )}
                          <View style={[styles.stepCircle, isActive && styles.stepCircleActive, isDone && styles.stepCircleDone]}>
                            {isDone ? (
                              <Feather name="check" size={14} color="#fff" />
                            ) : (
                              <Text style={[styles.stepNumber, isActive && styles.stepNumberActive]}>{stepNum}</Text>
                            )}
                          </View>
                          <Text style={[styles.stepLabel, isActive && styles.stepLabelActive]}>{step.label}</Text>
                        </View>
                      );
                    })}
                  </View>
                )}
                <View style={styles.glanceRow}>
                  <Pressable
                    onPress={() => handlePressLink(stepToLink(activeStep.key))}
                    disabled={isNextStepDisabled}
                    style={({ pressed }) => [{ flex: 1 }, pressed && styles.pressedScale]}
                  >
                    <LinearGradient
                      colors={['#f36f21', '#fabc3c']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.premiumStepCard}
                    >
                      <View style={styles.premiumStepContent}>
                        <View style={styles.premiumStepHeader}>
                          <View style={styles.premiumStepBadge}>
                            <Text style={styles.premiumStepBadgeText}>다음 단계</Text>
                          </View>
                          <View style={styles.premiumStepIcon}>
                            <Feather name="arrow-right" size={20} color="#fff" />
                          </View>
                        </View>
                        <Text style={styles.premiumStepTitle} numberOfLines={1}>
                          {activeStep.fullLabel}
                        </Text>
                        <Text style={styles.premiumStepSub}>
                          {nextStepSubText}
                        </Text>
                      </View>
                      <View style={styles.premiumStepDeco1} />
                      <View style={styles.premiumStepDeco2} />
                    </LinearGradient>
                  </Pressable>
                </View>
              </View>
            )
            }
          </AndroidSafeMotiView>

          <View style={styles.linksSection}>
            <Text style={styles.sectionTitle}>
              {role === 'admin' && isAdminExam ? '시험 관리 바로가기' : '바로가기'}
            </Text>
            {role === 'admin' && isAdminExam ? (
              <Text style={styles.sectionHint}>시험 등록/신청자 관련 메뉴를 모았습니다</Text>
            ) : null}
          </View>

          {/* Guide Banner Button (Modern) */}
          {role === 'fc' && (
            <AndroidSafeMotiView
              from={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', delay: 180 }}
              style={{ marginBottom: 20 }}
            >
              <Pressable
                onPress={() => setShowShortcutGuide(true)}
                accessibilityRole="button"
                accessibilityLabel="바로가기 사용법 설명 듣기"
                style={({ pressed }) => [
                  styles.guideCardNew,
                  pressed && styles.guideCardNewPressed,
                ]}
              >
                {/* Left icon */}
                <View style={styles.guideIconWrapNew}>
                  <LinearGradient
                    colors={['#fff7ed', '#ffffff']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.guideIconGradientNew}
                  >
                    <Feather name="play" size={16} color={HANWHA_ORANGE} style={{ marginLeft: 1 }} />
                  </LinearGradient>
                </View>

                {/* Text */}
                <View style={styles.guideTextWrapNew}>
                  <View style={styles.guideBadgeRowNew}>
                    <View style={styles.guideBadgeNew}>
                      <Text style={styles.guideBadgeTextNew}>SHORTCUT</Text>
                    </View>
                    <Text style={styles.guideBadgeHintNew}>기능이 궁금한가요?</Text>
                  </View>

                  <Text style={styles.guideTitleNew} numberOfLines={1}>
                    바로가기 사용법 설명 듣기
                  </Text>
                </View>

                {/* CTA */}
                <View style={styles.guideCtaNew}>
                  <View style={styles.guideCtaChipNew}>
                    <Text style={styles.guideCtaTextNew}>시작</Text>
                    <Feather name="chevron-right" size={16} color="#fff" />
                  </View>
                </View>
              </Pressable>
            </AndroidSafeMotiView>
          )}
          <View style={styles.actionGrid}>
            {quickLinks.map((item, index) => (
              <AndroidSafeMotiView
                key={`${item.href}-${item.stepKey ?? 'default'}`}
                from={{ opacity: 0, translateY: 20 }}
                animate={{ opacity: 1, translateY: 0 }}
                transition={{ type: 'spring', delay: 300 + index * 50 }}
                style={{ width: '48%' }}
              >
                <Pressable
                  style={({ pressed }) => [styles.actionCardGrid, pressed && styles.pressedScale]}
                  onPress={() => handlePressLink(item.href as any, item.stepKey)}>
                  <View style={styles.iconCircle}>
                    <Feather
                      name={getLinkIcon(item.stepKey ? `${item.href}?status=${item.stepKey}` : item.href)}
                      size={22}
                      color={HANWHA_ORANGE}
                    />
                  </View>
                  <Text style={styles.actionTitleGrid} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.actionDescGrid} numberOfLines={2}>{item.description}</Text>
                </Pressable>
              </AndroidSafeMotiView>
            ))}
          </View>
        </View >
      </Animated.ScrollView >

      {
        role === 'admin' ? (
          <Animated.View style={[styles.bottomNav, { paddingBottom: Math.max(insets.bottom, 12) }, bottomNavAnimatedStyle]}>
            {adminNavItems.map((item) => {
              const isActive = adminHomeTab === item.key;
              return (
                <Pressable
                  key={item.key}
                  style={({ pressed }) => [styles.bottomNavItem, pressed && styles.pressedOpacity]}
                  onPress={() => handleAdminTabChange(item.key)}
                >
                  <View style={[styles.bottomNavIconWrap, isActive && styles.bottomNavIconWrapActive]}>
                    <Feather name={item.icon} size={20} color={isActive ? '#fff' : HANWHA_ORANGE} />
                  </View>
                  <Text style={[styles.bottomNavLabel, isActive && styles.bottomNavLabelActive]}>{item.label}</Text>
                </Pressable>
              );
            })}
            <Pressable
              style={({ pressed }) => [styles.bottomNavItem, pressed && styles.pressedOpacity]}
              onPress={() => router.push('/admin-board-manage')}
            >
              <View style={styles.bottomNavIconWrap}>
                <Feather name="clipboard" size={20} color={HANWHA_ORANGE} />
              </View>
              <Text style={styles.bottomNavLabel}>게시판</Text>
            </Pressable>
          </Animated.View>
        ) : role === 'fc' ? (
          <Animated.View style={[styles.bottomNav, { paddingBottom: Math.max(insets.bottom, 12) }, bottomNavAnimatedStyle]}>
            <Pressable
              style={({ pressed }) => [styles.bottomNavItem, pressed && styles.pressedOpacity]}
            >
              <View style={[styles.bottomNavIconWrap, styles.bottomNavIconWrapActive]}>
                <Feather name="home" size={20} color="#fff" />
              </View>
              <Text style={[styles.bottomNavLabel, styles.bottomNavLabelActive]}>홈</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.bottomNavItem, pressed && styles.pressedOpacity]}
              onPress={() => router.push('/board')}
            >
              <View style={styles.bottomNavIconWrap}>
                <Feather name="clipboard" size={20} color={HANWHA_ORANGE} />
              </View>
              <Text style={styles.bottomNavLabel}>게시판</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.bottomNavItem, pressed && styles.pressedOpacity]}
              onPress={() => router.push('/notice')}
            >
              <View style={styles.bottomNavIconWrap}>
                <Feather name="bell" size={20} color={HANWHA_ORANGE} />
              </View>
              <Text style={styles.bottomNavLabel}>공지</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.bottomNavItem, pressed && styles.pressedOpacity]}
              onPress={() => router.push('/settings')}
            >
              <View style={styles.bottomNavIconWrap}>
                <Feather name="settings" size={20} color={HANWHA_ORANGE} />
              </View>
              <Text style={styles.bottomNavLabel}>설정</Text>
            </Pressable>
          </Animated.View>
        ) : null
      }
      {
        tourBlocking && (
          <Pressable
            style={[StyleSheet.absoluteFillObject, { zIndex: 9999, elevation: 9999 }]}
            onPress={() => { }}
            onPressIn={() => { }}
          />
        )
      }
      {role === 'fc' && (
        <ImageTourGuide
          visible={showShortcutGuide}
          onClose={() => setShowShortcutGuide(false)}
          imageSource={require('@/assets/guide/shortcuts-guide.png')}
          steps={SHORTCUT_GUIDE_STEPS}
        />
      )}
    </SafeAreaView >
  );
}

const stepToLink = (key: string) => {
  switch (key) {
    case 'info':
      return '/fc/new';
    case 'consent':
      return '/consent';
    case 'docs':
      return '/docs-upload';
    case 'url':
      return '/appointment';
    case 'final':
      return '';
    default:
      return '';
  }
};

const MetricCard = ({ label, value, onPress }: { label: string; value: string; onPress: () => void }) => {
  return (
    <Pressable style={styles.metricItem} onPress={onPress}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  container: {
    paddingBottom: 20,
    backgroundColor: '#fff',
  },
  topBar: {
    paddingHorizontal: 20,
    paddingVertical: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logoutButton: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  logoutText: { fontSize: 14, color: TEXT_MUTED, fontWeight: '600' },
  bellButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  rightActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  homeTitleWrap: { marginHorizontal: 20, marginBottom: 6 },
  homeTitle: { fontSize: 26, fontWeight: '800', color: CHARCOAL },
  homeSubtitleText: { marginTop: 4, color: TEXT_MUTED, fontSize: 14 },
  notice: {
    marginHorizontal: 20,
    marginBottom: 20,
    padding: 16, // Increased padding
    backgroundColor: ORANGE_FAINT,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  noticeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: HANWHA_ORANGE,
  },
  noticeText: {
    flex: 1,
    fontSize: 16, // 13 -> 16
    color: CHARCOAL,
    fontWeight: '500',
  },
  pressedOpacity: { opacity: 0.7 },
  pressedScale: { transform: [{ scale: 0.98 }] },
  // CTA
  ctaCard: {
    marginHorizontal: 20,
    borderRadius: 24,
    padding: 24,
    marginBottom: 24,
    position: 'relative',
    overflow: 'hidden',
  },
  ctaContent: { zIndex: 1 },
  ctaBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 12,
  },
  ctaBadgeText: { color: '#fff', fontWeight: '700', fontSize: 13 }, // 11 -> 13
  ctaTitle: {
    fontSize: 26, // 22 -> 26
    fontWeight: '800',
    color: '#fff',
    marginBottom: 6,
  },
  ctaSub: {
    fontSize: 16, // 14 -> 16
    color: 'rgba(255,255,255,0.9)',
    lineHeight: 22,
  },
  examPillRow: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  examPill: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  examPillText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  ctaIconCircle: {
    position: 'absolute',
    right: 20,
    top: 24,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    ...CARD_SHADOW,
  },
  ctaDecoCircle: {
    position: 'absolute',
    right: -40,
    bottom: -40,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  // Metrics
  metricsCard: {
    marginHorizontal: 20,
    marginBottom: 24,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 20, // 18 -> 20
    fontWeight: '700',
    color: CHARCOAL,
  },
  sectionHint: { fontSize: 13, color: TEXT_MUTED, marginTop: 4 },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metricItem: {
    width: '48%',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
    ...CARD_SHADOW,
    alignItems: 'center',
  },
  metricValue: {
    fontSize: 24, // 20 -> 24
    fontWeight: '800',
    color: HANWHA_ORANGE,
    marginBottom: 4,
  },
  metricLabel: {
    fontSize: 15, // 13 -> 15
    color: TEXT_MUTED,
    fontWeight: '500',
  },
  examSummaryCard: {
    marginHorizontal: 20,
    marginBottom: 24,
    padding: 20,
    backgroundColor: '#fff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    ...CARD_SHADOW,
  },
  examSummaryGrid: { gap: 12 },
  examSummaryItem: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  examSummaryIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: ORANGE_FAINT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  examSummaryTitle: { fontSize: 16, fontWeight: '700', color: CHARCOAL },
  examSummaryDesc: { fontSize: 14, color: TEXT_MUTED, lineHeight: 20 },
  examStatRow: {
    padding: 12,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    marginBottom: 12,
    backgroundColor: '#fff',
  },
  examStatTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  examStatTitle: { fontSize: 15, fontWeight: '800', color: CHARCOAL },
  examStatChips: { flexDirection: 'row', gap: 10 },
  examStatChip: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: '#F9FAFB',
    padding: 10,
    borderWidth: 1,
    borderColor: BORDER,
  },
  examStatChipPending: {
    backgroundColor: '#FFF7ED',
    borderColor: '#FED7AA',
  },
  examStatChipLabel: { fontSize: 12, color: TEXT_MUTED, marginBottom: 6, fontWeight: '700' },
  examStatChipValue: { fontSize: 18, fontWeight: '800', color: CHARCOAL },
  examStatChipValuePending: { color: '#b45309' },
  // Progress
  progressCard: {
    marginHorizontal: 20,
    marginBottom: 24,
    padding: 20,
    backgroundColor: '#fff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    ...CARD_SHADOW,
  },
  progressMeta: { fontSize: 15, fontWeight: '700', color: HANWHA_ORANGE }, // 13 -> 15
  statusRow: { flexDirection: 'row', marginBottom: 20, alignItems: 'center' },
  statusItem: { flex: 1, alignItems: 'center' },
  statusLabel: { fontSize: 14, color: TEXT_MUTED, marginBottom: 6 }, // 12 -> 14
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  statusText: { fontSize: 13, fontWeight: '700' }, // 11 -> 13
  statusDivider: { width: 1, height: 24, backgroundColor: BORDER, marginHorizontal: 12 },
  glanceRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 1,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  glancePill: {
    flex: 1,
    borderRadius: 12,
    padding: 12,
  },
  glancePrimary: { backgroundColor: ORANGE_FAINT },
  glanceGhost: { backgroundColor: '#F9FAFB' },
  glanceLabel: { fontSize: 13, color: TEXT_MUTED, marginBottom: 4 }, // 11 -> 13
  glanceValue: { fontSize: 16, fontWeight: '700', color: CHARCOAL }, // 14 -> 16
  // Links
  linksSection: {
    marginHorizontal: 20,
    marginBottom: 12,
  },
  actionGrid: {
    marginHorizontal: 20,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  actionCardGrid: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: BORDER,
    ...CARD_SHADOW,
    minHeight: 120, // Increased height to accommodate larger text
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: ORANGE_FAINT,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  actionTitleGrid: {
    fontSize: 17, // 15 -> 17
    fontWeight: '700',
    color: CHARCOAL,
    marginBottom: 4,
  },
  actionDescGrid: {
    fontSize: 14, // 12 -> 14
    color: TEXT_MUTED,
    lineHeight: 18,
  },
  bottomNav: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingTop: 0,
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: BORDER,
    ...CARD_SHADOW,
  },
  bottomNavItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 3 },
  bottomNavIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomNavIconWrapActive: { backgroundColor: HANWHA_ORANGE, borderColor: HANWHA_ORANGE },
  bottomNavLabel: { fontSize: 13, color: TEXT_MUTED, fontWeight: '700' },
  bottomNavLabelActive: { color: CHARCOAL },
  // Step
  stepContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepWrapper: { flex: 1, alignItems: 'center', position: 'relative' },
  stepConnector: {
    position: 'absolute',
    top: 12,
    left: '50%',
    width: '100%',
    height: 2,
    backgroundColor: '#E5E7EB',
    zIndex: -1,
  },
  stepConnectorDone: { backgroundColor: HANWHA_ORANGE },
  stepCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
    zIndex: 1,
  },
  stepCircleActive: { borderColor: HANWHA_ORANGE, backgroundColor: '#fff' },
  stepCircleDone: { backgroundColor: HANWHA_ORANGE, borderColor: HANWHA_ORANGE },
  stepNumber: { fontSize: 12, color: '#6B7280', fontWeight: '700' }, // 11 -> 12
  stepNumberActive: { color: HANWHA_ORANGE },
  stepLabel: { fontSize: 12, color: '#9CA3AF' }, // 11 -> 12
  stepLabelActive: { color: CHARCOAL, fontWeight: '700' },
  premiumStepCard: {
    borderRadius: 20,
    padding: 20,
    overflow: 'hidden',
    position: 'relative',
    height: 120, // Taller for impact
    justifyContent: 'center',
    shadowColor: '#f36f21',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 8,
  },
  premiumStepContent: {
    zIndex: 10,
    position: 'relative',
  },
  premiumStepHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  premiumStepBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  premiumStepBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  premiumStepIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  premiumStepTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 4,
    letterSpacing: -0.5,
  },
  premiumStepSub: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.9)',
    fontWeight: '500',
  },
  premiumStepDeco1: {
    position: 'absolute',
    top: -20,
    right: -20,
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  premiumStepDeco2: {
    position: 'absolute',
    bottom: -30,
    left: -10,
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  // Guide Card (Senior Friendly)
  guideCard: {
    marginHorizontal: 20,
    marginBottom: 5,
    borderRadius: 20,
    backgroundColor: '#FFF7ED', // Light Orange (Warm)
    borderWidth: 1,
    borderColor: '#FED7AA', // Orange-200
    overflow: 'hidden',
    ...CARD_SHADOW,
  },
  guidePressable: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12, // 24 -> 12
    gap: 10, // 16 -> 10
  },
  guideIconCircle: {
    width: 36, // 64 -> 36
    height: 36,
    borderRadius: 18,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#FED7AA',
    shadowColor: '#EA580C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  guideTextContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  guideTitle: {
    fontSize: 15, // 20 -> 15
    fontWeight: '800',
    color: '#9A3412', // Orange-900 (High contrast)
    marginBottom: 2,
  },
  guideSubTitle: {
    fontSize: 12, // 15 -> 12
    color: '#C2410C', // Orange-700
    fontWeight: '500',
    lineHeight: 16,
  },

  guideCardNew: {
    marginHorizontal: 20,
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#F1F5F9', // Slate-100 느낌
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },

  guideCardNewPressed: {
    transform: [{ scale: 0.985 }],
    opacity: 0.95,
  },

  guideIconWrapNew: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginRight: 12,
  },

  guideIconGradientNew: {
    flex: 1,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#FFEDD5', // Orange-100
  },

  guideTextWrapNew: {
    flex: 1,
    paddingRight: 10,
  },

  guideBadgeRowNew: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },

  guideBadgeNew: {
    backgroundColor: ORANGE_FAINT,
    borderWidth: 1,
    borderColor: '#FFEDD5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },

  guideBadgeTextNew: {
    color: '#9A3412', // Orange-900
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
  },

  guideBadgeHintNew: {
    color: '#6B7280',
    fontSize: 12,
    fontWeight: '600',
  },

  guideTitleNew: {
    fontSize: 16,
    fontWeight: '800',
    color: CHARCOAL,
    letterSpacing: -0.2,
    marginBottom: 2,
  },

  guideSubTitleNew: {
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 18,
    fontWeight: '500',
  },

  guideCtaNew: {
    justifyContent: 'center',
    alignItems: 'flex-end',
  },

  guideCtaChipNew: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: HANWHA_ORANGE,
    shadowColor: '#f36f21',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },

  guideCtaTextNew: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
  },
});
