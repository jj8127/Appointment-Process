import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import * as Notifications from 'expo-notifications';
import { router, useFocusEffect } from 'expo-router';
import { MotiView } from 'moti';
import { useCallback, useEffect, useState } from 'react';
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
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

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

const quickLinksAdmin: QuickLink[] = [
  { href: '/dashboard', stepKey: 'step2', title: '수당 동의 안내', description: '기본 정보 저장 완료 FC' },
  { href: '/dashboard', stepKey: 'step3', title: '서류 안내/검토', description: '제출해야 할 서류 관리' },
  { href: '/dashboard', stepKey: 'step4', title: '위촉 진행', description: '위촉 확인' },
  { href: '/dashboard', stepKey: 'step5', title: '완료 관리', description: '위촉 완료 현황' },
  { href: '/exam-register', title: '생명보험/제3보험 시험', description: '응시일정 · 마감 관리' },
  { href: '/exam-register2', title: '손해보험 시험', description: '응시일정 · 마감 관리' },
  { href: '/exam-manage', title: '생명 신청자', description: '신청 현황 조회' },
  { href: '/exam-manage2', title: '손해 신청자', description: '신청 현황 조회' },
  { href: '/admin-notice', title: '공지 등록', description: '새소식 작성' },
  { href: '/admin-messenger', title: '메신저', description: 'FC 1:1 대화 관리' },
];

const quickLinksFc: QuickLink[] = [
  { href: '/fc/new', title: '기본 정보', description: '인적사항 수정' },
  { href: '/exam-apply', title: '생명 시험 신청', description: '시험 접수하기' },
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
      'id,name,affiliation,status,temp_id,allowance_date,appointment_url,appointment_date,appointment_schedule_life,appointment_schedule_nonlife,appointment_date_life,appointment_date_nonlife,resident_id_masked,email,address,fc_documents(doc_type,storage_path)',
    )
    .eq('phone', residentId)
    .maybeSingle();
  if (error) throw error;
  return data ?? {
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

function calcStep(myFc: any) {
  if (!myFc) return 1;

  const hasBasicInfo =
    Boolean(myFc.name && myFc.affiliation && myFc.resident_id_masked) &&
    Boolean(myFc.email || myFc.address);
  if (!hasBasicInfo) return 1;

  const hasAllowance = Boolean(myFc.allowance_date) && myFc.status !== 'allowance-pending';
  if (!hasAllowance) return 2;

  const docs = myFc.fc_documents ?? [];
  const totalDocs = docs.length;
  const uploaded = docs.filter((d: any) => d.storage_path && d.storage_path !== 'deleted').length;
  const docsComplete = totalDocs > 0 && uploaded === totalDocs;
  if (!docsComplete) return 3;

  const approvedStatuses = ['docs-approved', 'appointment-completed', 'final-link-sent'];
  const isApproved = approvedStatuses.includes(myFc.status);
  if (!isApproved) return 3;

  const appointmentDone =
    (Boolean(myFc.appointment_date_life) && Boolean(myFc.appointment_date_nonlife)) ||
    myFc.status === 'final-link-sent';
  if (!appointmentDone) return 4;

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

  const [refreshing, setRefreshing] = useState(false);

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

  const quickLinks = role === 'admin' ? quickLinksAdmin : quickLinksFc;
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

  const getAppointmentStatus = (date: string | null | undefined, schedule: string | null | undefined) => {
    if (date) return { label: '완료', color: '#ffffff', bg: '#16a34a' }; // 진한 녹색 배경으로 완료 강조
    if (schedule) return { label: `${schedule}월 진행중`, color: '#fcfcfcff', bg: '#f97316' }; // 주황 배경으로 일정 진행중 구분
    return { label: '진행중', color: '#ffffff', bg: '#2563eb' }; // 파란 배경으로 기본 진행중 표시
  };

  const lifeStatus = getAppointmentStatus(myFc?.appointment_date_life, myFc?.appointment_schedule_life);
  const nonLifeStatus = getAppointmentStatus(myFc?.appointment_date_nonlife, myFc?.appointment_schedule_nonlife);

  useEffect(() => {
    if (!hydrated) return;
    if (!role) {
      router.replace('/auth');
    }
  }, [hydrated, role]);

  // 기본 인적사항 미입력 FC는 항상 인적사항 입력 화면으로 이동
  useEffect(() => {
    if (!hydrated || role !== 'fc') return;
    if (!myFc) return;
    const hasBasicInfo =
      Boolean(myFc.name?.trim() && myFc.affiliation?.trim() && myFc.resident_id_masked) &&
      Boolean(myFc.email || myFc.address);
    if (!hasBasicInfo) {
      router.replace('/fc/new');
    }
  }, [hydrated, role, myFc]);

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

        const { error } = await supabase
          .from('device_tokens')
          .upsert(
            { resident_id: residentId, role: 'fc', expo_push_token: token },
            { onConflict: 'resident_id' },
          );
        if (error) {
          console.log('[push] upsert error', error.message ?? error);
        } else {
          console.log('[push] fc token saved', { residentId });
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

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        refetchCounts?.(),
        refetchMyFc?.(),
        refetchLatestNotice?.(),
        refetchLatestAdminMsg?.(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [refetchCounts, refetchLatestNotice, refetchLatestAdminMsg, refetchMyFc]);

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

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <ScrollView
        contentContainerStyle={[styles.container, { paddingBottom: 96 + (insets.bottom || 0) }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
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
            {role === 'fc' ? (
              <Pressable
                style={({ pressed }) => [styles.deleteButton, pressed && styles.pressedOpacity]}
                onPress={handleDeleteRequest}>
                <Feather name="trash-2" size={14} color={HANWHA_ORANGE} />
                {/*<Text style={styles.deleteButtonText}>삭제 요청</Text>*/}
              </Pressable>
            ) : null}
            <RefreshButton />
          </View>
        </View>

        {role === 'fc' && (
          <View style={{ marginBottom: 12, paddingHorizontal: 4, alignItems: 'center' }}>
            <Text style={{ fontSize: 24, fontWeight: '800', color: CHARCOAL, textAlign: 'center' }}>
              {(myFc?.name || displayName || 'FC')}님 환영합니다.
            </Text>
          </View>
        )}

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

        <MotiView from={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', delay: 100 }}>
          {role === 'admin' ? (
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
          ) : (
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
          )}
        </MotiView>

        <MotiView
          from={{ opacity: 0, translateY: 20 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 600, delay: 200 }}
        >
          {role === 'admin' ? (
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
                  style={[styles.glancePill, styles.glancePrimary]}
                  onPress={() => handlePressLink(stepToLink(activeStep.key))}
                  disabled={!stepToLink(activeStep.key)}
                >
                  <Text style={styles.glanceLabel}>다음 단계</Text>
                  <Text style={styles.glanceValue} numberOfLines={1}>
                    {activeStep.fullLabel}
                  </Text>
                </Pressable>
                <View style={[styles.glancePill, styles.glanceGhost]}>
                  <Text style={styles.glanceLabel}>문서 업로드</Text>
                  <Text style={[styles.glanceValue, isAllSubmitted && { fontSize: 13 }]}>
                    {docsStatusText}
                  </Text>
                </View>
              </View>
            </View>
          )}
        </MotiView>

        <View style={styles.linksSection}>
          <Text style={styles.sectionTitle}>바로가기</Text>
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
      </ScrollView>
    </SafeAreaView>
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
});
