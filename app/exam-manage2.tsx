import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RefreshButton } from '@/components/RefreshButton';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';

const ORANGE = '#f36f21';
const ORANGE_LIGHT = '#f7b182';
const CHARCOAL = '#111827';
const MUTED = '#6b7280';
const BORDER = '#e5e7eb';
const SOFT_BG = '#fff7f0';

// 이 페이지는 손해보험 전용
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

  return `${roundLabel || ''} ${datePart ? `: ${datePart}` : ''}${
    locName ? ` [${locName}]` : ''
  }`.trim();
}

async function fetchApplicantsNonlife(): Promise<ApplicantRow[]> {
  const { data, error } = await supabase
    .from('exam_registrations')
    .select(
      `
      id,
      resident_id,
      status,
      is_confirmed,
      is_third_exam,
      created_at,
      exam_rounds!inner (
        exam_type,
        exam_date,
        round_label
      ),
      exam_locations (
        location_name
      )
    `,
    )
    .eq('exam_rounds.exam_type', EXAM_TYPE)
    .order('resident_id', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw error;

  const rows = (data ?? []) as ExamRegistrationRaw[];
  if (rows.length === 0) return [];

  const residentIds = Array.from(
    new Set(
      rows
        .map((r) => r.resident_id)
        .filter((v): v is string => !!v),
    ),
  );

  let profileMap: Record<string, FcProfile> = {};
  if (residentIds.length > 0) {
    const { data: profiles, error: pError } = await supabase
      .from('fc_profiles')
      .select('id, name, resident_number, address, phone')
      .in('phone', residentIds);

    if (pError) throw pError;

    profileMap = Object.fromEntries(
      (profiles ?? []).map((p: any) => [p.phone as string, p as FcProfile]),
    );
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
      if (examInfo) {
        grouped[key].exams.push(examInfo);
      }
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

  const {
    data: applicants,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<ApplicantRow[]>({
    queryKey: ['exam-applicants', EXAM_TYPE],
    queryFn: () => fetchApplicantsNonlife(),
    enabled: role === 'admin',
  });

  useEffect(() => {
    if (!hydrated) return;
    if (role && role !== 'admin') {
      Alert.alert('접근 제한', '총무(관리자)만 접근할 수 있는 페이지입니다.');
      router.back();
    }
  }, [role, hydrated]);

  const toggleMutation = useMutation({
    mutationFn: async (params: { registrationId: string; value: boolean }) => {
      const { error } = await supabase
        .from('exam_registrations')
        .update({ is_confirmed: params.value })
        .eq('id', params.registrationId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam-applicants', EXAM_TYPE] });
    },
    onError: (err: any) => {
      Alert.alert(
        '저장 실패',
        err?.message ?? '응시 접수 여부를 저장하는 중 오류가 발생했습니다.',
      );
    },
  });

  const handleToggle = (applicant: ApplicantRow) => {
    const newValue = !applicant.isConfirmed;
    toggleMutation.mutate({
      registrationId: applicant.latestRegistrationId,
      value: newValue,
    });
  };

  if (!hydrated || role !== 'admin') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.caption}>관리자 정보를 확인하는 중입니다...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <RefreshButton onPress={() => { refetch(); }} />
          <Text style={styles.caption}>신청자 목록을 불러오는 중입니다...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isError) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <RefreshButton onPress={() => { refetch(); }} />
          <Text style={styles.caption}>
            신청자 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.
          </Text>
          {error && (
            <Text style={[styles.caption, { marginTop: 4, fontSize: 11 }]}>
              ({String((error as any).message || '')})
            </Text>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <RefreshButton onPress={() => { refetch(); }} />
          <Text style={styles.headerTitle}>손해보험 신청자 관리</Text>
        </View>

        {(!applicants || applicants.length === 0) && (
          <Text style={styles.caption}>아직 손해보험 시험 신청자가 없습니다.</Text>
        )}

        {applicants?.map((a) => (
          <View key={a.residentId} style={styles.card}>
            <View style={styles.topRow}>
              <Text style={styles.nameText}>{a.name}</Text>
              <Text style={styles.hqText}>{a.headQuarter}</Text>
            </View>

            <Text style={styles.detailText}>주민번호: {a.residentNumber}</Text>
            <Text style={styles.detailText}>주소: {a.address}</Text>
            <Text style={styles.detailText}>전화번호: {a.phone}</Text>
            <Text style={styles.detailText}>제3보험 응시: {a.thirdExam ? 'O' : 'X'}</Text>

            <Text style={[styles.detailLabel, { marginTop: 8 }]}>응시 정보</Text>
            {a.exams.length === 0 && (
              <Text style={styles.examItem}>• 회차 정보 없음</Text>
            )}
            {a.exams.map((info, idx) => (
              <Text key={idx} style={styles.examItem}>
                • {info}
              </Text>
            ))}

            <View style={styles.statusRow}>
              <Text style={styles.detailLabel}>응시 접수 여부</Text>
              <Pressable
                onPress={() => handleToggle(a)}
                disabled={toggleMutation.isPending}
                style={[
                  styles.badge,
                  a.isConfirmed ? styles.badgeOn : styles.badgeOff,
                  toggleMutation.isPending && styles.badgeDisabled,
                ]}
              >
                <Text style={a.isConfirmed ? styles.badgeTextOn : styles.badgeTextOff}>
                  {a.isConfirmed ? 'O' : 'X'}
                </Text>
              </Pressable>
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: SOFT_BG,
  },
  container: {
    padding: 20,
    gap: 12,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: CHARCOAL,
  },
  caption: {
    color: MUTED,
  },
  card: {
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#f3f4f6',
    marginTop: 8,
    gap: 4,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  nameText: {
    fontSize: 18,
    fontWeight: '700',
    color: CHARCOAL,
  },
  hqText: {
    fontSize: 13,
    color: MUTED,
  },
  detailText: {
    fontSize: 13,
    color: CHARCOAL,
    marginTop: 2,
  },
  detailLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: CHARCOAL,
  },
  examItem: {
    fontSize: 13,
    color: CHARCOAL,
    marginTop: 2,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  badge: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeOn: {
    backgroundColor: ORANGE_LIGHT,
    borderColor: ORANGE,
  },
  badgeOff: {
    backgroundColor: 'white',
    borderColor: BORDER,
  },
  badgeDisabled: {
    opacity: 0.5,
  },
  badgeTextOn: {
    color: 'white',
    fontWeight: '800',
  },
  badgeTextOff: {
    color: CHARCOAL,
    fontWeight: '800',
  },
});
