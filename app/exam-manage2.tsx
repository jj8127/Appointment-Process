import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, Feather } from '@expo/vector-icons';

import { RefreshButton } from '@/components/RefreshButton';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';

const ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const MUTED = '#6b7280';
const BORDER = '#e5e7eb';
const BACKGROUND = '#ffffff';
const INPUT_BG = '#F9FAFB';

// 손해보험 전용
const EXAM_TYPE: 'nonlife' = 'nonlife';

type ExamRoundRef = {
  exam_type: 'life' | 'nonlife' | null;
  exam_date: string | null;
  round_label: string | null;
};

type ExamLocationRef = {
  location_name: string | null;
};

type ExamRegistrationRaw = {
  id: string;
  resident_id: string;
  status: string;
  is_confirmed: boolean | null;
  is_third_exam?: boolean | null;
  created_at: string;
  exam_rounds: ExamRoundRef | ExamRoundRef[] | null;
  exam_locations: ExamLocationRef | ExamLocationRef[] | null;
};

type FcProfile = {
  id: string;
  name: string | null;
  resident_number: string | null;
  address: string | null;
  phone: string | null;
};

type ApplicantRow = {
  residentId: string;
  headQuarter: string;
  name: string;
  residentNumber: string;
  address: string;
  phone: string;
  exams: string[];
  isConfirmed: boolean;
  thirdExam: boolean;
  latestRegistrationId: string;
};

function normalizeSingle<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
}

function buildExamInfo(reg: ExamRegistrationRaw): string {
  const round = normalizeSingle(reg.exam_rounds);
  const loc = normalizeSingle(reg.exam_locations);
  const examDateStr = round?.exam_date ?? null;
  let ymPart = '';
  let datePart = '';

  if (examDateStr) {
    const d = new Date(examDateStr);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    ymPart = `${y}년 ${m}월`;
    datePart = `${m}/${day}`;
  }

  const roundLabel = round?.round_label ?? '';
  const locName = loc?.location_name ?? '';

  if (ymPart && datePart && roundLabel && locName) {
    return `${ymPart} ${roundLabel} : ${datePart} [${locName}]`;
  }

  return `${roundLabel || ''} ${datePart ? `: ${datePart}` : ''}${locName ? ` [${locName}]` : ''}`.trim();
}

async function fetchApplicantsNonlife(): Promise<ApplicantRow[]> {
  const { data, error } = await supabase
    .from('exam_registrations')
    .select(
      `
      id, resident_id, status, is_confirmed, is_third_exam, created_at,
      exam_rounds!inner ( exam_type, exam_date, round_label ),
      exam_locations ( location_name )
    `,
    )
    .eq('exam_rounds.exam_type', EXAM_TYPE)
    .order('resident_id', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw error;
  const rows = (data ?? []) as ExamRegistrationRaw[];
  if (rows.length === 0) return [];

  const residentIds = Array.from(new Set(rows.map((r) => r.resident_id).filter((v): v is string => !!v)));

  let profileMap: Record<string, FcProfile> = {};
  if (residentIds.length > 0) {
    const { data: profiles, error: pError } = await supabase
      .from('fc_profiles')
      .select('id, name, resident_number, address, phone')
      .in('phone', residentIds);
    if (pError) throw pError;
    profileMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.phone as string, p as FcProfile]));
  }

  const grouped: Record<string, ApplicantRow> = {};
  for (const reg of rows) {
    const key = reg.resident_id;
    const profile = profileMap[key];
    const examInfo = buildExamInfo(reg);
    if (!grouped[key]) {
      grouped[key] = {
        residentId: key,
        headQuarter: '-',
        name: profile?.name ?? '-',
        residentNumber: profile?.resident_number ?? '-',
        address: profile?.address ?? '-',
        phone: profile?.phone ?? key,
        exams: examInfo ? [examInfo] : [],
        isConfirmed: !!reg.is_confirmed,
        thirdExam: !!reg.is_third_exam,
        latestRegistrationId: reg.id,
      };
    } else {
      if (examInfo) grouped[key].exams.push(examInfo);
      grouped[key].latestRegistrationId = reg.id;
      grouped[key].isConfirmed = !!reg.is_confirmed;
      grouped[key].thirdExam = !!reg.is_third_exam;
    }
  }
  return Object.values(grouped);
}

export default function ExamManageNonlifeScreen() {
  const { role, hydrated } = useSession();
  const queryClient = useQueryClient();
  const [searchText, setSearchText] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'confirmed' | 'pending'>('all');

  const { data: applicants, isLoading, isError, error, refetch } = useQuery<ApplicantRow[]>({
    queryKey: ['exam-applicants', EXAM_TYPE],
    queryFn: () => fetchApplicantsNonlife(),
    enabled: role === 'admin',
  });

  const filteredApplicants = useMemo(() => {
    if (!applicants) return [];
    const keyword = searchText.trim().toLowerCase();
    return applicants.filter((a) => {
      const matchText =
        !keyword ||
        a.name.toLowerCase().includes(keyword) ||
        a.phone.includes(keyword) ||
        a.exams.some((info) => info.toLowerCase().includes(keyword));
      let matchStatus = true;
      if (filterStatus === 'confirmed') matchStatus = a.isConfirmed;
      if (filterStatus === 'pending') matchStatus = !a.isConfirmed;
      return matchText && matchStatus;
    });
  }, [applicants, searchText, filterStatus]);

  useEffect(() => {
    if (!hydrated) return;
    if (role && role !== 'admin') {
      Alert.alert('접근 제한', '총무(관리자)만 접근할 수 있는 페이지입니다.');
      router.back();
    }
  }, [role, hydrated]);

  const toggleMutation = useMutation({
    mutationFn: async (params: { registrationId: string; value: boolean }) => {
      const { error } = await supabase.from('exam_registrations').update({ is_confirmed: params.value }).eq('id', params.registrationId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam-applicants', EXAM_TYPE] });
    },
    onError: (err: any) => {
      Alert.alert('저장 실패', err?.message ?? '오류가 발생했습니다.');
    },
  });

  const handleToggle = (applicant: ApplicantRow) => {
    toggleMutation.mutate({ registrationId: applicant.latestRegistrationId, value: !applicant.isConfirmed });
  };

  const renderCard = (a: ApplicantRow) => {
    return (
      <View key={a.residentId} style={styles.card}>
        <View style={styles.cardHeader}>
          <View>
            <Text style={styles.nameText}>{a.name}</Text>
            <Text style={styles.phoneText}>{a.phone}</Text>
          </View>
          <Pressable
            onPress={() => handleToggle(a)}
            disabled={toggleMutation.isPending}
            style={[
              styles.statusButton,
              a.isConfirmed ? styles.statusButtonConfirmed : styles.statusButtonPending,
              toggleMutation.isPending && { opacity: 0.6 },
            ]}
          >
            <Text style={[styles.statusButtonText, a.isConfirmed ? { color: '#059669' } : { color: '#b45309' }]}>
              {a.isConfirmed ? '접수 완료' : '미접수'}
            </Text>
            <Feather name={a.isConfirmed ? 'check' : 'x'} size={14} color={a.isConfirmed ? '#059669' : '#b45309'} />
          </Pressable>
        </View>

        <View style={styles.divider} />

        <View style={styles.infoGrid}>
          <InfoLabelValue label="주민번호" value={a.residentNumber} />
          <InfoLabelValue label="제3보험" value={a.thirdExam ? '응시' : '-'} />
          <InfoLabelValue label="주소" value={a.address} fullWidth />
        </View>

        {a.exams.length > 0 && (
          <View style={styles.examSection}>
            <Text style={styles.examLabel}>신청 내역</Text>
            {a.exams.map((info, idx) => (
              <Text key={idx} style={styles.examText}>
                • {info}
              </Text>
            ))}
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <Text style={styles.headerTitle}>손해보험 신청자</Text>
            <RefreshButton onPress={() => refetch()} />
          </View>

          <View style={styles.searchBox}>
            <Ionicons name="search" size={18} color="#9CA3AF" />
            <TextInput
              style={styles.searchInput}
              placeholder="이름, 전화번호 검색"
              placeholderTextColor="#9CA3AF"
              value={searchText}
              onChangeText={setSearchText}
            />
          </View>

          <View style={styles.filterRow}>
            {(['all', 'pending', 'confirmed'] as const).map((st) => (
              <Pressable
                key={st}
                style={[styles.filterChip, filterStatus === st && styles.filterChipActive]}
                onPress={() => setFilterStatus(st)}
              >
                <Text style={[styles.filterText, filterStatus === st && styles.filterTextActive]}>
                  {st === 'all' ? '전체' : st === 'pending' ? '미확정' : '확정'}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {isLoading && <ActivityIndicator color={ORANGE} style={{ marginVertical: 20 }} />}

        {!isLoading && filteredApplicants.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>검색 결과가 없습니다.</Text>
          </View>
        )}

        {filteredApplicants.map(renderCard)}
      </ScrollView>
    </SafeAreaView>
  );
}

const InfoLabelValue = ({ label, value, fullWidth }: { label: string; value: string; fullWidth?: boolean }) => (
  <View style={[styles.infoItem, fullWidth && { width: '100%' }]}>
    <Text style={styles.infoLabel}>{label}</Text>
    <Text style={styles.infoValue}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BACKGROUND },
  container: { padding: 20, gap: 12 },

  header: {
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    backgroundColor: '#fff',
  },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  headerTitle: { fontSize: 22, fontWeight: '800', color: CHARCOAL },

  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: INPUT_BG,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 44,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 12,
  },
  searchInput: { flex: 1, marginLeft: 8, fontSize: 15, color: CHARCOAL },

  filterRow: { flexDirection: 'row', gap: 8 },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: INPUT_BG,
    borderWidth: 1,
    borderColor: BORDER,
  },
  filterChipActive: { backgroundColor: CHARCOAL, borderColor: CHARCOAL },
  filterText: { fontSize: 13, color: MUTED, fontWeight: '600' },
  filterTextActive: { color: '#fff' },

  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginTop: 8,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 6,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  nameText: { fontSize: 18, fontWeight: '700', color: CHARCOAL },
  phoneText: { fontSize: 13, color: MUTED, marginTop: 2 },

  statusButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  statusButtonPending: { backgroundColor: '#FFF7ED', borderColor: '#FED7AA' },
  statusButtonConfirmed: { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' },
  statusButtonText: { fontSize: 12, fontWeight: '700' },

  divider: { height: 1, backgroundColor: '#F3F4F6', marginBottom: 10 },

  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  infoItem: { width: '48%' },
  infoLabel: { fontSize: 12, color: MUTED, marginBottom: 2 },
  infoValue: { fontSize: 13, color: CHARCOAL, fontWeight: '500' },

  examSection: { marginTop: 8, backgroundColor: '#F9FAFB', padding: 10, borderRadius: 8 },
  examLabel: { fontSize: 12, fontWeight: '700', color: CHARCOAL, marginBottom: 4 },
  examText: { fontSize: 13, color: '#374151', marginBottom: 2 },

  emptyState: { alignItems: 'center', marginTop: 40 },
  emptyText: { color: MUTED, fontSize: 14 },
});
