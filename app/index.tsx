import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import * as Haptics from 'expo-haptics';

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

const CARD_SHADOW = {
  shadowColor: '#000',
  shadowOpacity: 0.04,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 4 },
  elevation: 3,
};

const quickLinksAdmin = [
  { href: '/exam-register', title: '생명보험 시험', description: '응시일정 · 마감 관리' },
  { href: '/exam-register2', title: '손해보험 시험', description: '응시일정 · 마감 관리' },
  { href: '/exam-manage', title: '생명 신청자', description: '신청 현황 조회' },
  { href: '/exam-manage2', title: '손해 신청자', description: '신청 현황 조회' },
  { href: '/dashboard?mode=temp', title: '임시/대기', description: '가번호 발급 관리' },
  { href: '/dashboard?mode=docs', title: '문서 검토', description: '승인 및 반려' },
  { href: '/admin-notice', title: '공지 등록', description: '새소식 작성' },
];

const quickLinksFc = [
  { href: '/fc/new', title: '기본 정보', description: '인적사항 수정' },
  { href: '/exam-apply', title: '생명 시험 신청', description: '시험 접수하기' },
  { href: '/exam-apply2', title: '손해 시험 신청', description: '시험 접수하기' },
  { href: '/consent', title: '수당 동의', description: '약관 동의 관리' },
  { href: '/docs-upload', title: '서류 업로드', description: '필수 서류 제출' },
];

const steps = [
  { key: 'info', label: '인적사항', fullLabel: '인적사항 등록' },
  { key: 'consent', label: '수당동의', fullLabel: '수당 동의' },
  { key: 'docs', label: '문서제출', fullLabel: '문서 제출' },
  { key: 'pending', label: '승인대기', fullLabel: '승인 대기' },
  { key: 'final', label: '완료', fullLabel: '최종 완료' },
];

const fetchCounts = async (role: 'admin' | 'fc' | null, residentId: string) => {
  let query = supabase.from('fc_profiles').select('status');
  if (role === 'fc' && residentId) {
    query = query.eq('phone', residentId);
  }
  const { data, error } = await query;
  if (error) throw error;
  const counts = data.reduce(
    (acc: Record<string, number>, row) => {
      acc[row.status] = (acc[row.status] ?? 0) + 1;
      return acc;
    },
    {},
  );
  return {
    total: data.length,
    docsPending: counts['docs-pending'] ?? 0,
    docsRejected: counts['docs-rejected'] ?? 0,
    finalSent: counts['final-link-sent'] ?? 0,
  };
};

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

const fetchFcStatus = async (residentId: string) => {
  const { data, error } = await supabase
    .from('fc_profiles')
    .select('name,status,temp_id,allowance_date,fc_documents(doc_type,storage_path)')
    .eq('phone', residentId)
    .maybeSingle();
  if (error) throw error;
  return data ?? { name: '', status: 'draft', temp_id: null, allowance_date: null, fc_documents: [] };
};

function calcStep(myFc: any) {
  if (!myFc) return 1;
  const docs = myFc.fc_documents ?? [];
  const totalDocs = docs.length;
  const uploaded = docs.filter((d: any) => d.storage_path && d.storage_path !== 'deleted').length;

  let step = 1;
  if (myFc.temp_id) step = 2;
  if (totalDocs > 0 && uploaded === totalDocs) step = 3;
  if (myFc.status === 'docs-approved') step = 4;
  if (myFc.status === 'final-link-sent') step = 5;
  return step;
}

const getLinkIcon = (href: string) => {
  if (href.includes('register') || href.includes('apply')) return 'edit-3';
  if (href.includes('manage')) return 'users';
  if (href.includes('docs')) return 'file-text';
  if (href.includes('notice')) return 'mic';
  if (href.includes('consent')) return 'check-circle';
  if (href.includes('temp')) return 'clock';
  return 'chevron-right';
};

export default function Home() {
  const { role, residentId, residentMask, displayName, logout, hydrated } = useSession();

  const { data: counts, isLoading } = useQuery({
    queryKey: ['fc-counts', role, residentId],
    queryFn: () => fetchCounts(role, residentId),
    enabled: !!role,
  });

  const { data: myFc, isLoading: statusLoading } = useQuery({
    queryKey: ['my-fc-status', residentId],
    queryFn: () => (residentId ? fetchFcStatus(residentId) : Promise.resolve(null)),
    enabled: role === 'fc' && !!residentId,
  });

  const { data: latestNotice } = useQuery({
    queryKey: ['latest-notice'],
    queryFn: fetchLatestNotice,
  });

  const quickLinks = role === 'admin' ? quickLinksAdmin : quickLinksFc;
  const currentStep = myFc ? calcStep(myFc) : 1;
  const activeStep = steps[Math.min(steps.length - 1, Math.max(0, currentStep - 1))];
  const uploadedDocs =
    myFc?.fc_documents?.filter((d: any) => d.storage_path && d.storage_path !== 'deleted').length ?? 0;
  const totalDocs = myFc?.fc_documents?.length ?? 0;

  useEffect(() => {
    if (!hydrated) return;
    if (!role) {
      router.replace('/auth');
    }
  }, [hydrated, role]);

  const handleLogout = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    logout();
    router.replace('/auth');
  };

  const handlePressLink = (href: string) => {
    Haptics.selectionAsync();
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

  if (!hydrated) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={[styles.container, { alignItems: 'center', justifyContent: 'center', flex: 1 }]}>
          <ActivityIndicator color={HANWHA_ORANGE} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
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
                <Text style={styles.deleteButtonText}>삭제 요청</Text>
              </Pressable>
            ) : null}
            <RefreshButton />
          </View>
        </View>

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
          <Pressable onPress={() => handlePressLink('/dashboard?mode=docs')}>
            <LinearGradient
              colors={['#f36f21', '#fabc3c']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.ctaCard}
            >
              <View style={styles.ctaContent}>
                <View style={styles.ctaBadge}>
                  <Text style={styles.ctaBadgeText}>FC 지원</Text>
                </View>
                <Text style={styles.ctaTitle}>서류 현황 확인하기</Text>
                <Text style={styles.ctaSub}>진행상황을 한 번에 확인하세요.</Text>
              </View>
              <View style={styles.ctaIconCircle}>
                <Feather name="arrow-right" size={24} color={HANWHA_ORANGE} />
              </View>
              <View style={styles.ctaDecoCircle} />
            </LinearGradient>
          </Pressable>
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
                    <MetricCard label="전체 FC" value={`${counts.total}명`} />
                    <MetricCard label="문서 대기" value={`${counts.docsPending}건`} />
                    <MetricCard label="반려" value={`${counts.docsRejected}건`} />
                    <MetricCard label="최종 안내" value={`${counts.finalSent}건`} />
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
                <ProgressBar step={currentStep} />
              )}
              <View style={styles.glanceRow}>
                <View style={[styles.glancePill, styles.glancePrimary]}>
                  <Text style={styles.glanceLabel}>다음 단계</Text>
                  <Text style={styles.glanceValue} numberOfLines={1}>
                    {activeStep.fullLabel}
                  </Text>
                </View>
                <View style={[styles.glancePill, styles.glanceGhost]}>
                  <Text style={styles.glanceLabel}>문서 업로드</Text>
                  <Text style={styles.glanceValue}>
                    {uploadedDocs}/{totalDocs || 1} 완료
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
              key={item.href}
              from={{ opacity: 0, translateY: 20 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'spring', delay: 300 + index * 50 }}
              style={{ width: '48%' }}
            >
              <Pressable
                style={({ pressed }) => [styles.actionCardGrid, pressed && styles.pressedScale]}
                onPress={() => handlePressLink(item.href as any)}>
                <View style={styles.iconCircle}>
                  <Feather name={getLinkIcon(item.href)} size={22} color={HANWHA_ORANGE} />
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

const MetricCard = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.metricCard}>
    <Text style={styles.metricLabel}>{label}</Text>
    <Text style={styles.metricValue}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: SOFT_BG },
  container: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 96,
    gap: 16,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rightActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logoutButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: BORDER,
  },
  logoutText: { color: CHARCOAL, fontWeight: '600', fontSize: 13 },
  bellButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: BORDER,
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#fff',
  },
  deleteButtonText: { color: HANWHA_ORANGE, fontWeight: '600', fontSize: 12 },
  pressedOpacity: { opacity: 0.7 },
  pressedScale: { transform: [{ scale: 0.96 }] },

  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.03)',
    ...CARD_SHADOW,
  },
  noticeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: HANWHA_ORANGE },
  noticeText: { color: CHARCOAL, fontWeight: '600', fontSize: 14, flex: 1 },

  ctaCard: {
    borderRadius: 22,
    padding: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    overflow: 'hidden',
    ...CARD_SHADOW,
    shadowColor: HANWHA_ORANGE,
    shadowOpacity: 0.25,
    shadowRadius: 12,
    minHeight: 120,
  },
  ctaContent: { flex: 1, gap: 6, zIndex: 1 },
  ctaBadge: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  ctaBadgeText: { color: '#fff', fontWeight: '700', fontSize: 11 },
  ctaTitle: { color: '#fff', fontWeight: '800', fontSize: 20 },
  ctaSub: { color: '#fff5eb', fontSize: 13 },
  ctaIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  ctaDecoCircle: {
    position: 'absolute',
    right: -30,
    top: -30,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(255,255,255,0.15)',
    zIndex: 0,
  },

  metricsCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    ...CARD_SHADOW,
  },
  progressCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    gap: 16,
    ...CARD_SHADOW,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitle: { fontWeight: '800', fontSize: 17, color: CHARCOAL },
  progressMeta: { color: TEXT_MUTED, fontWeight: '600', fontSize: 13 },

  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metricCard: {
    backgroundColor: '#f8fafc',
    padding: 16,
    borderRadius: 16,
    width: '48%',
  },
  metricLabel: { color: TEXT_MUTED, fontSize: 12, marginBottom: 4 },
  metricValue: { color: CHARCOAL, fontSize: 18, fontWeight: '800' },

  glanceRow: { flexDirection: 'row', gap: 10 },
  glancePill: {
    flex: 1,
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  glancePrimary: { backgroundColor: ORANGE_FAINT, borderColor: 'transparent' },
  glanceGhost: { backgroundColor: '#f8fafc' },
  glanceLabel: { color: HANWHA_ORANGE, fontWeight: '700', fontSize: 11, marginBottom: 4 },
  glanceValue: { color: CHARCOAL, fontWeight: '700', fontSize: 14 },

  linksSection: { marginTop: 8, marginBottom: 4 },
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  actionCardGrid: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 16,
    width: '100%',
    minHeight: 110,
    justifyContent: 'space-between',
    ...CARD_SHADOW,
    shadowOpacity: 0.03,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#feeadd',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  actionTitleGrid: { color: CHARCOAL, fontSize: 15, fontWeight: '700', marginBottom: 2 },
  actionDescGrid: { color: TEXT_MUTED, fontSize: 12, lineHeight: 16 },

  stepContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 0,
    marginVertical: 10,
  },
  stepWrapper: {
    alignItems: 'center',
    width: 58,
    position: 'relative',
    zIndex: 1,
  },
  stepCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#f1f5f9',
    borderWidth: 2,
    borderColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
    zIndex: 2,
  },
  stepCircleActive: {
    backgroundColor: '#fff',
    borderColor: HANWHA_ORANGE,
    transform: [{ scale: 1.1 }],
  },
  stepCircleDone: { backgroundColor: HANWHA_ORANGE, borderColor: HANWHA_ORANGE },
  stepNumber: { fontSize: 11, color: '#94a3b8', fontWeight: '800' },
  stepNumberActive: { color: HANWHA_ORANGE },
  stepLabel: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  stepLabelActive: { color: CHARCOAL, fontWeight: '800' },
  stepConnector: {
    position: 'absolute',
    top: 13,
    left: '50%',
    width: '100%',
    height: 2,
    backgroundColor: '#f1f5f9',
    zIndex: 0,
  },
  stepConnectorDone: { backgroundColor: '#fed7aa' },
});
