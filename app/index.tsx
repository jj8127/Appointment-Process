import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

import { RefreshButton } from '@/components/RefreshButton';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';

const HANWHA_ORANGE = '#f36f21';
const HANWHA_LIGHT = '#f7b182';
const CHARCOAL = '#111827';
const TEXT_MUTED = '#6b7280';
const BORDER = '#e5e7eb';
const SOFT_BG = '#fff7f0';
const ORANGE_FAINT = '#fff1e6';
const PRIVACY_EMAIL = process.env.EXPO_PUBLIC_PRIVACY_EMAIL ?? 'privacy@example.com';
const CARD_SHADOW = {
  shadowColor: '#000',
  shadowOpacity: 0.06,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 3 },
  elevation: 3,
};

const quickLinksAdmin = [
  { href: '/exam-register', title: '시험 등록', description: '응시일정 · 마감 · 지역 관리' },
  { href: '/dashboard?mode=temp', title: '임시/대기 관리', description: '임시번호 발급 · 현황 조회' },
  { href: '/dashboard?mode=docs', title: '문서 검토', description: '업로드 · 승인 처리' },
  { href: '/admin-notice', title: '공지 업로드', description: '새 공지 작성 · 등록' },
];

const quickLinksFc = [
  { href: '/fc/new', title: '기본 정보', description: '인적사항 · 연락처 입력' },
  { href: '/consent', title: '수당 동의', description: '개인정보 · 약관 동의' },
  { href: '/docs-upload', title: '서류 업로드', description: 'PDF 제출 · 확인' },
];

const steps = [
  { key: 'info', label: 'Step 1', desc: '기본 입력' },
  { key: 'consent', label: 'Step 2', desc: '수당 동의' },
  { key: 'docs', label: 'Step 3', desc: '서류 제출' },
  { key: 'pending', label: 'Step 4', desc: '결과 대기' },
  { key: 'final', label: 'Step 5', desc: '완료' },
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
    if (err?.code === '42P01') return null; // notices 테이블 없을 때 무시
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

export default function Home() {
  const { role, residentId, residentMask, displayName, logout, hydrated } = useSession();

  const { data: counts, isLoading, isError } = useQuery({
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
  const headline =
    role === 'admin'
      ? '관리자 대시보드'
      : myFc?.name
        ? `${myFc.name}님의 진행 현황`
        : 'FC 업무 돕기';
  const subtext =
    role === 'admin'
      ? '현황을 살피고 필요한 작업을 빠르게 처리하세요.'
      : '오늘 상태를 확인하고 다음 작업을 이어가세요.';

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
    logout();
    router.replace('/auth');
  };

  const handleDeleteRequest = () => {
    const subject = encodeURIComponent('개인정보 삭제 요청');
    const body = encodeURIComponent(
      [
        '수탁 법인에 저장된 개인정보 삭제를 요청합니다.',
        `이름(성함): ${displayName || ''}` ,
        `휴대폰번호: ${residentMask || ''}` ,
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
                style={({ pressed }) => [styles.deleteButton, pressed && styles.deleteButtonPressed]}
                onPress={handleDeleteRequest}>
                <Feather name="trash-2" size={14} color={HANWHA_ORANGE} />
                <Text style={styles.deleteButtonText}>삭제 요청</Text>
              </Pressable>
            ) : null}
            <RefreshButton />
          </View>
        </View>

        <Pressable style={({ pressed }) => [styles.notice, pressed && styles.noticePressed]} onPress={() => router.push('/notice')}>
          <View style={styles.noticeDot} />
          <Text style={styles.noticeText}>
            {latestNotice?.title ? `공지: ${latestNotice.title}` : '공지: 최신 공지를 불러오는 중'}
          </Text>
        </Pressable>

        <Pressable style={styles.ctaCard} onPress={() => router.push('/dashboard?mode=docs')}>
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={styles.ctaLabel}>FC 지원</Text>
            <Text style={styles.ctaTitle}>서류 현황 보기</Text>
            <Text style={styles.ctaSub}>진행상황을 한 번에 확인하세요.</Text>
          </View>
          <View style={styles.ctaPill}>
            <Text style={styles.ctaPillText}>바로 이동</Text>
          </View>
        </Pressable>

        {role === 'admin' ? (
          <View style={styles.metricsCard}>
            <View style={styles.metricsHeader}>
              <Text style={styles.sectionTitle}>현황 요약</Text>
              {isLoading && <ActivityIndicator color={HANWHA_LIGHT} />}
              {isError && <Text style={styles.errorText}>데이터를 불러오지 못했습니다.</Text>}
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
            <View style={styles.progressHeader}>
              <Text style={styles.progressTitle}>내 진행 상황</Text>
              <Text style={styles.progressMeta}>Step {currentStep} / 5</Text>
            </View>
            {statusLoading ? <ActivityIndicator color={HANWHA_LIGHT} /> : <ProgressBar step={currentStep} />}
            <View style={styles.glanceRow}>
              <View style={[styles.glancePill, styles.glancePrimary]}>
                <Text style={styles.glanceLabel}>다음 단계</Text>
                <Text style={styles.glanceValue}>
                  Step {currentStep} - {activeStep.desc}
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

        <View style={styles.linksHeader}>
          <Text style={styles.sectionTitle}>바로가기</Text>
          <Text style={styles.sectionCaption}>
            {role === 'admin' ? '주요 메뉴를 빠르게 이동하세요.' : '필요한 작업을 바로 진행하세요.'}
          </Text>
        </View>
        <View style={styles.actionGrid}>
          {quickLinks.map((item) => (
            <Pressable key={item.href} style={styles.actionCard} onPress={() => router.push(item.href as any)}>
              <Text style={styles.actionTitle}>{item.title}</Text>
              <Text style={styles.actionDesc}>{item.description}</Text>
            </Pressable>
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
        const done = position < step;
        const active = position === step;
        return (
          <View key={s.key} style={styles.stepItem}>
            {idx > 0 ? (
              <View style={[styles.stepLine, done || active ? styles.stepLineActive : styles.stepLineInactive]} />
            ) : null}
            <View style={[styles.stepCircle, done ? styles.stepDone : null, active ? styles.stepActive : null]}>
              <Text style={done || active ? styles.stepTextOn : styles.stepTextOff}>{s.label}</Text>
            </View>
            <Text style={styles.stepDesc}>{s.desc}</Text>
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
    gap: 10,
    paddingTop: 6,
  },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rightActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
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
  deleteButtonPressed: { opacity: 0.7 },
  deleteButtonText: { color: HANWHA_ORANGE, fontWeight: '700', fontSize: 12 },
  logoutButton: {
    height: 38,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: BORDER,
    justifyContent: 'center',
  },
  logoutText: { color: CHARCOAL, fontWeight: '700' },
  bellButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: BORDER,
    ...CARD_SHADOW,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    ...CARD_SHADOW,
  },
  noticePressed: { opacity: 0.9 },
  noticeDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: HANWHA_ORANGE },
  noticeText: { color: HANWHA_ORANGE, fontWeight: '700' },
  ctaCard: {
    backgroundColor: HANWHA_ORANGE,
    borderRadius: 18,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    ...CARD_SHADOW,
  },
  ctaLabel: { color: '#fff4eb', fontWeight: '700', fontSize: 12 },
  ctaTitle: { color: '#fff', fontWeight: '900', fontSize: 20 },
  ctaSub: { color: '#ffe8d2' },
  ctaPill: { backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12 },
  ctaPillText: { color: HANWHA_ORANGE, fontWeight: '800' },
  metricsCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 12,
    ...CARD_SHADOW,
  },
  metricsHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metricCard: {
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 12,
    width: '48%',
    borderWidth: 1,
    borderColor: BORDER,
  },
  metricLabel: { color: TEXT_MUTED },
  metricValue: { color: CHARCOAL, fontSize: 18, fontWeight: '800' },
  progressCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 10,
    ...CARD_SHADOW,
  },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  progressTitle: { color: CHARCOAL, fontSize: 16, fontWeight: '800' },
  progressMeta: { color: TEXT_MUTED, fontWeight: '700' },
  glanceRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  glancePill: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#fff',
  },
  glancePrimary: { backgroundColor: ORANGE_FAINT, borderColor: HANWHA_LIGHT },
  glanceGhost: { backgroundColor: '#f8fafc' },
  glanceLabel: { color: HANWHA_ORANGE, fontWeight: '700', marginBottom: 4 },
  glanceValue: { color: CHARCOAL, fontWeight: '800' },
  linksHeader: { gap: 4 },
  sectionTitle: { fontWeight: '800', fontSize: 18, color: CHARCOAL },
  sectionCaption: { color: TEXT_MUTED },
  actionGrid: { gap: 10 },
  actionCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    ...CARD_SHADOW,
  },
  actionTitle: { color: CHARCOAL, fontSize: 17, fontWeight: '800', marginBottom: 4 },
  actionDesc: { color: TEXT_MUTED },
  stepContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepItem: { alignItems: 'center', flex: 1 },
  stepLine: { height: 4, flex: 1, marginHorizontal: 4, borderRadius: 999 },
  stepLineInactive: { backgroundColor: BORDER },
  stepLineActive: { backgroundColor: HANWHA_ORANGE },
  stepCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  stepActive: { borderColor: HANWHA_ORANGE, backgroundColor: HANWHA_ORANGE },
  stepDone: { borderColor: HANWHA_ORANGE, backgroundColor: '#fff' },
  stepTextOn: { color: CHARCOAL, fontWeight: '700' },
  stepTextOff: { color: TEXT_MUTED, fontWeight: '700' },
  stepDesc: { color: TEXT_MUTED, fontSize: 12, marginTop: 6 },
  errorText: { color: '#dc2626' },
});
