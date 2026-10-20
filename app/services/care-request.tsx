import { Feather } from '@expo/vector-icons';
import { randomUUID } from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import HospitalScreen, { hospitalStyles as styles } from '@/components/hospitals/HospitalScreen';
import { useSession } from '@/hooks/use-session';
import { CARE_PRECAUTIONS, careStartOptions, formatCareDate } from '@/lib/hospital-care';
import { registerPlatformMemberPushToken } from '@/lib/notifications';
import {
  CARE_HOSPITAL_ID, CARE_REQUEST_STATUSES, CARE_TYPES, CONTACT_TIMES, PlatformApiError, platformRequest, type HospitalCareRequest,
} from '@/lib/platform-api';
import { COLORS } from '@/lib/theme';
import { useReadAttempt } from '@/lib/use-read-attempt';

const HOSPITAL_NAME = '굿모닝한방병원 청주';
type Draft = { desiredStart: string; careType: HospitalCareRequest['careType'] | ''; contactTime: HospitalCareRequest['contactTime'] | '' };
const EMPTY: Draft = { desiredStart: '', careType: '', contactTime: '' };

function Choice({ label, selected, onPress, detail }: { label: string; selected: boolean; onPress: () => void; detail?: string }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} aria-pressed={selected} onPress={onPress}
    style={({ pressed }) => [styles.chip, selected && styles.selectedChip, pressed && { opacity: 0.7 }, local.choice]}>
    <Text style={[styles.body, selected && styles.selectedText]}>{label}</Text>
    {detail && <Text style={[styles.caption, selected && styles.selectedText]}>{detail}</Text>}
  </Pressable>;
}

export default function CareRequest() {
  const { hospitalId } = useLocalSearchParams<{ hospitalId?: string }>();
  const insets = useSafeAreaInsets();
  const session = useSession();
  const token = session.platformSessionToken ?? session.appSessionToken;
  const begin = useReadAttempt();
  const [requests, setRequests] = useState<HospitalCareRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  // One key per draft so a retried submit after a lost response is not stored twice.
  const submitKey = useRef<string | null>(null);
  const dates = useMemo(() => careStartOptions(), []);
  const supported = (hospitalId ?? CARE_HOSPITAL_ID).toLowerCase() === CARE_HOSPITAL_ID;

  const refresh = useCallback(async () => {
    const owns = begin();
    if (!token) { setRequests(null); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const response = await platformRequest<{ requests: HospitalCareRequest[] }>('list_hospital_care', {}, token);
      if (owns()) setRequests(response.requests);
    } catch (cause) {
      if (!owns()) return;
      if (cause instanceof PlatformApiError && (cause.status === 401 || cause.status === 403)) setRequests(null);
      setError(cause instanceof Error ? cause.message : '예약 내역을 불러오지 못했습니다.');
    } finally { if (owns()) setLoading(false); }
  }, [begin, token]);
  useEffect(() => { if (session.hydrated) void refresh(); }, [refresh, session.hydrated]);
  // Keeps an already-allowed device registered; the permission prompt waits for the first request.
  useEffect(() => { if (token) void registerPlatformMemberPushToken(token); }, [token]);

  const update = (next: Partial<Draft>) => { submitKey.current = null; setSubmitError(null); setDraft((current) => ({ ...current, ...next })); };
  const ready = Boolean(draft.desiredStart && draft.careType && draft.contactTime);
  const submit = async () => {
    if (!token || !ready || submitting) return;
    submitKey.current ??= randomUUID();
    setSubmitting(true); setSubmitError(null);
    try {
      await platformRequest('request_hospital_care', { hospitalId: CARE_HOSPITAL_ID, ...draft, idempotencyKey: submitKey.current }, token);
      submitKey.current = null; setDraft(EMPTY);
      void registerPlatformMemberPushToken(token, { requestPermission: true });
      await refresh();
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : '예약 요청을 보내지 못했습니다.');
    } finally { setSubmitting(false); }
  };
  const cancel = async (requestId: string) => {
    if (!token) return;
    try {
      await platformRequest('cancel_hospital_care', { requestId }, token);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '예약 요청을 취소하지 못했습니다.'); }
  };

  return <HospitalScreen detail title="간병 예약">
    <ScrollView contentContainerStyle={{ paddingBottom: 120 + insets.bottom }}>
      <View style={styles.content}>
        <View style={[styles.separator, { gap: 6 }]}>
          <Text style={styles.caption}>{HOSPITAL_NAME}</Text>
          <Text style={styles.title}>간병 예약 요청</Text>
        </View>

        {!supported ? <Text style={styles.body}>이 병원은 아직 간병 예약을 받지 않습니다.</Text>
          : !session.hydrated ? <ActivityIndicator color={COLORS.primary} />
          : !token ? <View style={{ gap: 12 }}>
            <Text style={styles.body}>로그인한 뒤 예약을 요청할 수 있습니다.</Text>
            <Button onPress={() => router.push('/services/login')}>로그인</Button>
          </View>
          : <>
            <View style={{ gap: 10 }}>
              <Text accessibilityRole="header" style={styles.heading}>희망 시작일</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {dates.map((option) => <Choice key={option.value} label={option.label} detail={option.weekday}
                  selected={draft.desiredStart === option.value} onPress={() => update({ desiredStart: option.value })} />)}
              </ScrollView>
            </View>
            <View style={{ gap: 10 }}>
              <Text accessibilityRole="header" style={styles.heading}>간병 형태</Text>
              <View style={local.wrap}>{Object.entries(CARE_TYPES).map(([value, label]) => <Choice key={value} label={label}
                selected={draft.careType === value} onPress={() => update({ careType: value as Draft['careType'] })} />)}</View>
            </View>
            <View style={{ gap: 10 }}>
              <Text accessibilityRole="header" style={styles.heading}>연락받을 시간</Text>
              <View style={local.wrap}>{Object.entries(CONTACT_TIMES).map(([value, label]) => <Choice key={value} label={label}
                selected={draft.contactTime === value} onPress={() => update({ contactTime: value as Draft['contactTime'] })} />)}</View>
            </View>
            {submitError && <Text accessibilityRole="alert" style={styles.body}>{submitError}</Text>}
            <Button disabled={!ready} loading={submitting} onPress={() => void submit()}>예약 요청 보내기</Button>

            <View style={{ gap: 12, marginTop: 12 }}>
              <Text accessibilityRole="header" style={styles.heading}>내 예약 요청</Text>
              {loading && !requests && <ActivityIndicator color={COLORS.primary} />}
              {error && <View style={styles.error}><Text accessibilityRole="alert" style={styles.body}>{error}</Text>
                <Button variant="outline" loading={loading} onPress={() => void refresh()}>다시 확인하기</Button></View>}
              {requests?.length === 0 && <Text style={styles.body}>아직 요청한 내역이 없습니다.</Text>}
              {requests?.map((request) => <View key={request.id} style={local.card}>
                <View style={styles.row}>
                  <Text style={[local.cardTitle, styles.flexible]}>{formatCareDate(request.desiredStart)} 시작</Text>
                  <Text style={[local.status, request.status === 'confirmed' && local.confirmed]}>{CARE_REQUEST_STATUSES[request.status]}</Text>
                </View>
                <Text style={styles.body}>{CARE_TYPES[request.careType]} · 연락 {CONTACT_TIMES[request.contactTime]}</Text>
                {request.staffNote && <View style={local.note}><Feather name="message-circle" size={16} color={COLORS.text.secondary} accessible={false} />
                  <Text style={[styles.body, styles.flexible]}>{request.staffNote}</Text></View>}
                {request.status === 'confirmed' && <View style={{ gap: 8 }}>
                  <Pressable accessibilityRole="button" accessibilityState={{ expanded: expanded === request.id }}
                    onPress={() => setExpanded(expanded === request.id ? null : request.id)} style={[styles.row, local.toggle]}>
                    <Text style={[styles.heading, styles.flexible, { fontSize: 16 }]}>간병 시작 전 확인할 것</Text>
                    <Feather name={expanded === request.id ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.text.secondary} accessible={false} />
                  </Pressable>
                  {expanded === request.id && CARE_PRECAUTIONS.map((item, index) => <View key={item} style={[styles.row, { alignItems: 'flex-start' }]}>
                    <Text style={[styles.body, local.number]}>{index + 1}</Text><Text style={[styles.body, styles.flexible]}>{item}</Text>
                  </View>)}
                </View>}
                {['requested', 'reviewing', 'adjusted'].includes(request.status) && <Button variant="ghost" onPress={() => void cancel(request.id)}>요청 취소</Button>}
              </View>)}
            </View>
          </>}
      </View>
    </ScrollView>
  </HospitalScreen>;
}

const local = StyleSheet.create({
  choice: { alignItems: 'center', minWidth: 64 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card: { borderWidth: 1, borderColor: COLORS.border.light, borderRadius: 14, padding: 16, gap: 8 },
  cardTitle: { fontSize: 16, lineHeight: 24, fontWeight: '700', color: COLORS.text.primary },
  status: { fontSize: 13, fontWeight: '700', color: COLORS.text.secondary, backgroundColor: COLORS.gray[50], borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden' },
  confirmed: { color: COLORS.primaryDark, backgroundColor: COLORS.primaryPale },
  note: { flexDirection: 'row', gap: 8, backgroundColor: COLORS.gray[50], borderRadius: 10, padding: 12 },
  toggle: { minHeight: 44 },
  number: { minWidth: 18, fontWeight: '700' },
});
