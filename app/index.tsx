import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import * as Notifications from 'expo-notifications';
import { router, useFocusEffect } from 'expo-router';
import { MotiView } from 'moti';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { TourGuideZone, useTourGuideController } from 'rn-tourguide';

import { RefreshButton } from '@/components/RefreshButton';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';

const HANWHA_ORANGE = '#f36f21';
const HANWHA_LIGHT = '#f7b182';
const CHARCOAL = '#111827';
const TEXT_MUTED = '#6b7280';
const BORDER = '#e5e7eb';
const SOFT_BG = '#F9FAFB';
const ORANGE_FAINT = '#fff1e6';
const PRIVACY_EMAIL = process.env.EXPO_PUBLIC_PRIVACY_EMAIL ?? 'privacy@example.com';
const STEP_KEYS = ['step1', 'step2', 'step3', 'step4', 'step5'] as const;
type StepKey = (typeof STEP_KEYS)[number];
type StepCounts = Record<StepKey, number>;
type CountsResult = { total: number; steps: StepCounts };
const EMPTY_STEP_COUNTS: StepCounts = { step1: 0, step2: 0, step3: 0, step4: 0, step5: 0 };
const STEP_LABELS: Record<StepKey, string> = {
  step1: '1단계 인적사항',
  step2: '2단계 수당동의',
  step3: '3단계 문서제출',
  step4: '4단계 위촉 진행',
  step5: '5단계 완료',
};

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
  { href: '/admin-notice', title: '공지 등록', description: '새소식 작성' },
  { href: '/admin-messenger', title: '메신저', description: 'FC 1:1 대화 관리' },
];

const quickLinksAdminExam: QuickLink[] = [
  { href: '/exam-register', title: '생명보험/제3보험 시험', description: '응시일정 · 마감 관리' },
  { href: '/exam-register2', title: '손해보험 시험', description: '응시일정 · 마감 관리' },
  { href: '/exam-manage', title: '생명/제3 신청자', description: '신청 현황 조회' },
  { href: '/exam-manage2', title: '손해 신청자', description: '신청 현황 조회' },
];

const quickLinksFc: QuickLink[] = [
  { href: '/fc/new', title: '기본 정보', description: '인적사항 수정' },
  { href: '/exam-apply', title: '생명/제3 시험 신청', description: '시험 접수하기' },
  { href: '/exam-apply2', title: '손해 시험 신청', description: '시험 접수하기' },
  { href: '/consent', title: '수당 동의', description: '약관 동의 관리' },
  { href: '/docs-upload', title: '서류 업로드', description: '필수 서류 제출' },
  { href: '/appointment', title: '모바일 위촉', description: '위촉 URL 접속 및 완료' },
  { href: '/chat', title: '1:1 문의', description: '총무팀과 대화하기' },
];

const steps = [
  { key: 'info', label: '인적사항', fullLabel: '인적사항 등록' },
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
    .select('name,affiliation,resident_id_masked,email,address,allowance_date,appointment_date,status,fc_documents(doc_type,storage_path)');
  if (error) throw error;

  const steps: StepCounts = { ...EMPTY_STEP_COUNTS };
  (data ?? []).forEach((profile: any) => {
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
    const { data, error } = await supabase
      .from('notices')
      .select('title,body,category,created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  } catch (err: any) {
    if (err?.code === '42P01') return null;
    throw err;
  }
};

const fetchLatestAdminMessage = async (residentId: string) => {
  if (!residentId) {
    console.log('[Home] residentId 없음');
    return null;
  }
  try {
    const { data: authRes } = await supabase.auth.getUser();
    console.log('[Home] latest admin msg start', { supabaseUserId: authRes?.user?.id, residentId });

    const { data, error } = await supabase
      .from('messages') // 테이블명이 다르면 여기 수정 필요
      .select('*') // 컬럼 구조 확인용
      .eq('receiver_id', residentId) // 내가 받은 메시지
      .neq('sender_id', residentId) // 내가 보낸 것은 제외
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      console.error('[Home] latest admin msg error', error);
      return null;
    }

    console.log('[Home] latest admin msg data', data);
    const msg = data?.[0];
    if (!msg) return null;
    const content =
      (msg as any).content || (msg as any).text || (msg as any).message || (msg as any).body || '';
    return { ...msg, content };
  } catch (err) {
    console.log('[Home] latest admin msg exception', err);
    return null;
  }
};

const fetchFcStatus = async (residentId: string) => {
  const { data, error } = await supabase
    .from('fc_profiles')
    .select(
      'id,name,affiliation,status,temp_id,allowance_date,appointment_url,appointment_date,appointment_schedule_life,appointment_schedule_nonlife,appointment_date_life,appointment_date_nonlife,resident_id_masked,email,address,fc_documents(doc_type,storage_path,status)',
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
    resident_id_masked: null,
    email: null,
    address: null,
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
    const { count: total, error: totalErr } = await supabase
      .from('exam_registrations')
      .select('id, exam_rounds!inner(exam_type)', { count: 'exact', head: true })
      .eq('exam_rounds.exam_type', examType);
    if (totalErr) throw totalErr;

    const { count: pending, error: pendingErr } = await supabase
      .from('exam_registrations')
      .select('id, exam_rounds!inner(exam_type)', { count: 'exact', head: true })
      .eq('exam_rounds.exam_type', examType)
      .or('is_confirmed.is.null,is_confirmed.eq.false');
    if (pendingErr) throw pendingErr;

    return { total: total ?? 0, pending: pending ?? 0 };
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

  const hasBasicInfo =
    Boolean(myFc.name && myFc.affiliation && myFc.resident_id_masked) &&
    Boolean(myFc.email || myFc.address);
  if (!hasBasicInfo) return 1;

  // [1단계 우선] 수당 동의 완료 여부
  const allowancePassedStatuses: string[] = [
    'allowance-consented',
    'docs-requested',
    'docs-pending',
    'docs-submitted',
    'docs-rejected',
    'docs-approved',
    'appointment-completed',
    'final-link-sent',
  ];
  if (!allowancePassedStatuses.includes(myFc.status)) {
    return 2; // 수당 동의 단계에서 대기
  }

  // [2단계 우선] 서류 승인 여부
  const docs = myFc.fc_documents ?? [];
  const validDocs = docs.filter((d: any) => d.storage_path && d.storage_path !== 'deleted');
  const hasPendingDocs = validDocs.length === 0 || validDocs.some((d: any) => d.status !== 'approved');
  if (hasPendingDocs) {
    return 3; // 서류 단계에서 대기
  }

  // [3단계 우선] 위촉 최종 완료 여부
  if (myFc.status !== 'final-link-sent') {
    return 4; // 위촉 진행 단계에서 대기 (총무 승인 필요)
  }

  // 모두 통과
  return 5;
}

const getStepKey = (profile: any): StepKey => {
  const step = Math.max(1, Math.min(5, calcStep(profile)));
  return `step${step}` as StepKey;
};

const getLinkIcon = (href: string) => {
  // 관리자 메뉴
  if (href.includes('status=step1')) return 'user-plus'; // 인적사항 관리
  if (href.includes('status=step2')) return 'check-square'; // 수당 동의 안내
  if (href.includes('status=step3')) return 'file-text'; // 서류 안내/검토
  if (href.includes('status=step4')) return 'link'; // 위촉 진행
  if (href.includes('status=step5')) return 'award'; // 완료 관리

  if (href.includes('exam-register')) return 'calendar'; // 시험 일정 등록
  if (href.includes('exam-manage')) return 'users'; // 신청자 관리
  if (href.includes('admin-appointment')) return 'send'; // URL 발송
  if (href.includes('admin-notice')) return 'bell'; // 공지 등록

  // FC 메뉴
  if (href.includes('fc/new')) return 'user'; // 기본 정보
  if (href.includes('exam-apply')) return 'edit-3'; // 시험 신청
  if (href.includes('consent')) return 'check-circle'; // 수당 동의
  if (href.includes('docs-upload')) return 'upload-cloud'; // 서류 업로드
  if (href.includes('appointment')) return 'smartphone'; // 모바일 위촉
  if (href.includes('admin-messenger')) return 'message-circle'; // 메신저
  if (href.includes('chat')) return 'message-circle'; // 1:1 문의

  return 'chevron-right';
};

export default function Home() {
  const { role, residentId, residentMask, displayName, logout, hydrated } = useSession();
  const insets = useSafeAreaInsets();

  const [adminHomeTab, setAdminHomeTab] = useState<'onboarding' | 'exam'>('onboarding');
  const [refreshing, setRefreshing] = useState(false);
  const isAdminExam = role === 'admin' && adminHomeTab === 'exam';
  const adminNavItems = [
    { key: 'onboarding' as const, label: '위촉 홈', icon: 'home' as const },
    { key: 'exam' as const, label: '시험 홈', icon: 'book-open' as const },
  ];

  // FC 전용 코치마크
  const { canStart, start, eventEmitter } = useTourGuideController();
  const autoTourStartedRef = useRef(false);
  const isFc = role === 'fc';

  const [tourBlocking, setTourBlocking] = useState(false);

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
  const scrollViewRef = useRef<ScrollView>(null);
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
        console.log(`[scrollToZoneMeasured] zone: ${zone}, measured y: ${y}`);
        const targetY = Math.max(0, y - paddingTop);
        requestAnimationFrame(() => {
          scrollViewRef.current?.scrollTo({ y: targetY, animated: true });
        });
      },
      () => {
        console.log('[measureLayout error]');
      }
    );
  }, []);

  useEffect(() => {
    const handleStepChange = (step: any) => {
      const z = step?.zone;
      console.log('[tour stepChange]', step, 'zone:', z);

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
    setTourBlocking(true); // 먼저 막고
    start();
  }, [isFc, canStart, start]);

  useEffect(() => {
    if (!hydrated) return;
    if (!isFc) return;
    if (!canStart) return;
    if (!residentId) return;
    if (autoTourStartedRef.current) return;

    // Start after entry animation (1000ms delay for safety)
    autoTourStartedRef.current = true;
    setTimeout(async () => {
      try {
        const key = `tour_seen_${residentId}`;
        const hasSeen = await AsyncStorage.getItem(key);
        if (!hasSeen) {
          start();
          await AsyncStorage.setItem(key, 'true');
        }
      } catch (e) {
        console.log('[tour] check error', e);
        // If error, play safe and don't force start, or force start?
        // Let's safe fail and strictly rely on manual if async storage fails
      }
    }, 1000);
  }, [hydrated, isFc, canStart, start, residentId]);

  useEffect(() => {
    if (!isFc) {
      autoTourStartedRef.current = false;
    }
  }, [isFc]);





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
          console.log('[supabase ping] 연결 실패', error.message ?? error);
        } else {
          console.log('[supabase ping] 연결 성공, device_tokens count:', count);
        }
      } catch (err: any) {
        if (active) console.log('[supabase ping] 예외', err?.message ?? err);
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
    data: myFc,
    isLoading: statusLoading,
    refetch: refetchMyFc,
  } = useQuery({
    queryKey: ['my-fc-status', residentId],
    queryFn: () => (residentId ? fetchFcStatus(residentId) : Promise.resolve(null)),
    enabled: role === 'fc' && !!residentId,
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
  const uploadedDocs =
    myFc?.fc_documents?.filter((d: any) => d.storage_path && d.storage_path !== 'deleted').length ?? 0;
  const totalDocs = myFc?.fc_documents?.length ?? 0;
  const isAllSubmitted = totalDocs > 0 && uploadedDocs >= totalDocs;
  const isApproved =
    myFc?.status === 'docs-approved' ||
    myFc?.status === 'appointment-completed' ||
    myFc?.status === 'final-link-sent';

  let docsStatusText = `${uploadedDocs}/${totalDocs || 1} 완료`;
  if (isAllSubmitted) {
    docsStatusText = isApproved ? '모든 문서 제출 완료 [검토 완료]' : '모든 문서 제출 완료 [검토 중]';
  }

  const getAppointmentStatus = (
    date: string | null | undefined,
    schedule: string | null | undefined,
    isFinal: boolean,
  ) => {
    // 완료 표시는 최종 상태일 때만, 그렇지 않으면 "입력됨(승인대기)"로 표시
    if (isFinal && date) return { label: '완료', color: '#ffffff', bg: '#16a34a' };
    if (date) return { label: '입력됨(승인대기)', color: '#ffffff', bg: '#f97316' };
    if (schedule) return { label: `${schedule}월 진행중`, color: '#fcfcfcff', bg: '#f97316' };
    return { label: '진행중', color: '#ffffff', bg: '#2563eb' };
  };

  const isFinal = myFc?.status === 'final-link-sent';
  const lifeStatus = getAppointmentStatus(myFc?.appointment_date_life, myFc?.appointment_schedule_life, isFinal);
  const nonLifeStatus = getAppointmentStatus(
    myFc?.appointment_date_nonlife,
    myFc?.appointment_schedule_nonlife,
    isFinal,
  );

  useEffect(() => {
    if (!hydrated) return;
    if (!role) {
      router.replace('/auth');
    }
  }, [hydrated, role]);

  // 기본 인적사항 미입력 FC는 항상 인적사항 입력 화면으로 이동
  useEffect(() => {
    if (!hydrated || role !== 'fc') return;
    if (statusLoading) return;
    if (!myFc) return;

    const hasBasics = (fc: any) =>
      Boolean(fc?.name?.trim() && fc?.affiliation?.trim() && fc?.resident_id_masked) &&
      Boolean(fc?.email || fc?.address);

    if (hasBasics(myFc)) return;
    if (myFc.status !== 'draft') return;

    // 저장 직후 캐시 불일치로 재입력 화면이 반복되는 문제 방지: 한 번 더 최신 프로필 확인 후 이동
    (async () => {
      const refreshed = await refetchMyFc?.();
      const fresh = refreshed?.data ?? myFc;
      if (!hasBasics(fresh)) {
        router.replace('/fc/new');
      }
    })();
  }, [hydrated, role, myFc, statusLoading, refetchMyFc, router]);

  // FC 푸시 토큰 등록 (배너 알림 수신용)
  useEffect(() => {
    let active = true;
    (async () => {
      if (role !== 'fc' || !residentId) return;
      try {
        const { status } = await Notifications.requestPermissionsAsync();
        if (status !== 'granted') {
          console.log('[push] permission denied');
          return;
        }
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('default', {
            name: 'default',
            importance: Notifications.AndroidImportance.MAX,
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
          console.log('[push] upsert error', error.message ?? error);
        } else {
          console.log('[push] fc token saved', { residentId, token });
        }
      } catch (e: any) {
        console.log('[push] exception', e?.message ?? e);
      }
    })();
    return () => {
      active = false;
    };
  }, [role, residentId]);

  const handleLogout = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    logout();
    router.replace('/auth');
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
    router.push(href as any);
  };

  const handleDeleteRequest = () => {
    const subject = encodeURIComponent('개인정보 삭제 요청');
    const body = encodeURIComponent(
      [
        '수탁 법인에 저장된 개인정보 삭제를 요청합니다.',
        `이름(성함): ${displayName || ''}`,
        `휴대폰번호: ${residentMask || ''}`,
        '생년월일: ',
        '',
        '요청 사유:',
      ].join('\n'),
    );
    const url = `mailto:${PRIVACY_EMAIL}?subject=${subject}&body=${body}`;

    Linking.openURL(url).catch(() => {
      Alert.alert('요청 실패', `이메일(${PRIVACY_EMAIL})로 직접 요청해주세요.`);
    });
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
      <ScrollView
        ref={scrollViewRef}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        scrollEnabled={!tourBlocking}
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
              <Pressable style={styles.bellButton} onPress={() => router.push('/notifications')}>
                <Feather name="bell" size={20} color={CHARCOAL} />
              </Pressable>
            </View>
            <View style={styles.rightActions}>
              {isFc ? (
                <Pressable
                  style={({ pressed }) => [styles.bellButton, pressed && styles.pressedOpacity]}
                  onPress={startFcTour}>
                  <Feather name="help-circle" size={20} color={CHARCOAL} />
                </Pressable>
              ) : null}
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

          {role === 'fc' && (
            <View style={{ marginBottom: 12, paddingHorizontal: 4, alignItems: 'center' }}>
              <Text style={{ fontSize: 24, fontWeight: '800', color: CHARCOAL, textAlign: 'center' }}>
                {(myFc?.name || displayName || 'FC')}님 환영합니다.
              </Text>
            </View>
          )}

          {/* Senior Friendly Guide Card */}
          {role === 'fc' && (
            <MotiView
              from={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', delay: 200 }}
              style={{ marginBottom: 5 }}
            >
              <Pressable
                style={({ pressed }) => [styles.guideCard, pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] }]}
                onPress={startFcTour}
              >
                <View style={styles.guidePressable}>
                  <View style={styles.guideIconCircle}>
                    <Feather name="play" size={16} color="#EA580C" style={{ marginLeft: 2 }} />
                  </View>
                  <View style={styles.guideTextContainer}>
                    <Text style={styles.guideTitle}>앱 사용법 설명 듣기</Text>
                    <Text style={styles.guideSubTitle}>화면의 기능을 다시 확인해보세요</Text>
                  </View>
                  <Feather name="chevron-right" size={16} color="#F97316" />
                </View>
              </Pressable>
            </MotiView>
          )}

          {isFc ? (
            <View collapsable={false}>
              <MotiView from={{ opacity: 0, translateY: -10 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 500 }}>
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
              </MotiView>
            </View>
          ) : (
            <MotiView from={{ opacity: 0, translateY: -10 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 500 }}>
              <Pressable
                style={({ pressed }) => [styles.notice, pressed && styles.pressedOpacity]}
                onPress={() => handlePressLink('/notice')}>
                <View style={styles.noticeDot} />
                <Text style={styles.noticeText} numberOfLines={1}>
                  {latestNotice?.title ? `공지: ${latestNotice.title}` : '공지: 최신 공지사항을 확인하세요'}
                </Text>
                <Feather name="chevron-right" size={16} color={HANWHA_ORANGE} style={{ marginLeft: 'auto' }} />
              </Pressable>
            </MotiView>
          )}

          {!(role === 'admin' && adminHomeTab === 'exam') && (
            <>
              {role === 'admin' ? (
                <MotiView from={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', delay: 100 }}>
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
                </MotiView>
              ) : isFc ? (
                <View ref={zone2Ref} collapsable={false}>
                  <TourGuideZone
                    zone={2}
                    text="총무팀과 1:1 문의를 할 수 있어요. 최근 메시지도 여기서 미리 볼 수 있어요."
                    borderRadius={24}>
                    <MotiView from={{ opacity: 0, translateY: 10 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'spring', delay: 100 }}>
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
                    </MotiView>
                  </TourGuideZone>
                </View>
              ) : (
                <MotiView from={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', delay: 100 }}>
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
                </MotiView>
              )}
            </>
          )}

          <MotiView
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
                    {isLoading && <ActivityIndicator color={HANWHA_LIGHT} />}
                  </View>
                  <View style={styles.metricsGrid}>
                    {!isLoading && counts ? (
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
                            <ActivityIndicator color={HANWHA_LIGHT} style={{ marginVertical: 20 }} />
                          ) : (
                            <>
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
                              <ProgressBar step={currentStep} />
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
                          disabled={!stepToLink(activeStep.key)}
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
                                터치하여 바로 진행하세요
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
                  <ActivityIndicator color={HANWHA_LIGHT} style={{ marginVertical: 20 }} />
                ) : (
                  <>
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
                    <ProgressBar step={currentStep} />
                  </>
                )}
                <View style={styles.glanceRow}>
                  <Pressable
                    onPress={() => handlePressLink(stepToLink(activeStep.key))}
                    disabled={!stepToLink(activeStep.key)}
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
                          터치하여 바로 진행하세요
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
          </MotiView>

          <View style={styles.linksSection}>
            <Text style={styles.sectionTitle}>
              {role === 'admin' && isAdminExam ? '시험 관리 바로가기' : '바로가기'}
            </Text>
            {role === 'admin' && isAdminExam ? (
              <Text style={styles.sectionHint}>시험 등록/신청자 관련 메뉴를 모았습니다</Text>
            ) : null}
          </View>
          <View style={styles.actionGrid}>
            {quickLinks.map((item, index) => (
              <MotiView
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
              </MotiView>
            ))}
          </View>
        </View>
      </ScrollView >

      {
        role === 'admin' ? (
          <View style={[styles.bottomNav, { paddingBottom: Math.max(insets.bottom, 12) }]}>
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
          </View>
        ) : null
      }
      {tourBlocking && (
        <Pressable
          style={[StyleSheet.absoluteFillObject, { zIndex: 9999, elevation: 9999 }]}
          onPress={() => { }}
          onPressIn={() => { }}
        />
      )}
    </SafeAreaView >
  );
}

const ProgressBar = ({ step }: { step: number }) => {
  return (
    <View style={styles.stepContainer}>
      {steps.map((s, idx) => {
        const position = idx + 1;
        const isActive = position === step;
        const isDone = position < step;

        return (
          <View key={s.key} style={styles.stepWrapper}>
            {idx < steps.length - 1 && (
              <View style={[styles.stepConnector, isDone && styles.stepConnectorDone]} />
            )}

            <View
              style={[
                styles.stepCircle,
                isActive && styles.stepCircleActive,
                isDone && styles.stepCircleDone,
              ]}>
              {isDone ? (
                <Feather name="check" size={12} color="#fff" />
              ) : (
                <Text style={[styles.stepNumber, isActive && styles.stepNumberActive]}>
                  {position}
                </Text>
              )}
            </View>
            <Text
              style={[styles.stepLabel, isActive && styles.stepLabelActive]}
              numberOfLines={1}
              adjustsFontSizeToFit>
              {s.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
};

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
    paddingVertical: 12,
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
  deleteButton: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  deleteButtonText: { fontSize: 13, color: HANWHA_ORANGE, fontWeight: '600' },
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
    marginTop: 20,
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
    paddingTop: 10,
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: BORDER,
    ...CARD_SHADOW,
  },
  bottomNavItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10 },
  bottomNavIconWrap: {
    width: 44,
    height: 44,
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
});
