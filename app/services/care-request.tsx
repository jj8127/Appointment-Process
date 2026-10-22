import { MaterialIcons } from '@expo/vector-icons';
import { randomUUID } from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import HospitalScreen, { CareStatusBadge, IconTile, hospitalStyles as styles } from '@/components/hospitals/HospitalScreen';
import { useSession } from '@/hooks/use-session';
import { CARE_PRECAUTIONS, CARE_STATUS_TONES, CARE_WEEKDAYS, careCalendarMonths, careStartOptions, formatCareDate, formatCareTime } from '@/lib/hospital-care';
import { registerPlatformMemberPushToken } from '@/lib/notifications';
import {
  CARE_HOSPITAL_ID, CARE_REQUEST_STATUSES, CARE_TYPES, PlatformApiError, platformRequest, type HospitalCareRequest,
} from '@/lib/platform-api';
import { COLORS } from '@/lib/theme';
import { useReadAttempt } from '@/lib/use-read-attempt';

const HOSPITAL_NAME = '굿모닝한방병원 청주';
// Staff call members directly, so the contact-time question is no longer asked; the request contract keeps the field.
const CONTACT_TIME: HospitalCareRequest['contactTime'] = 'anytime';
const OPEN_STATUSES: HospitalCareRequest['status'][] = ['requested', 'reviewing', 'adjusted'];
const CARE_TYPE_ICONS = { full_day: { name: 'bedtime', tone: 'indigo' }, day_time: { name: 'light-mode', tone: 'amber' } } as const;
type Draft = { desiredStart: string; careType: HospitalCareRequest['careType'] | '' };
const EMPTY: Draft = { desiredStart: '', careType: '' };
type Step = { label: string; time?: string | null; state: 'done' | 'now' | 'next' };

/** Received → current answer → confirmed; a closed request ends at its own status. */
function timeline(request: HospitalCareRequest): Step[] {
  const received = { label: CARE_REQUEST_STATUSES.requested, time: formatCareTime(request.createdAt) };
  const next: Step = { label: CARE_REQUEST_STATUSES.confirmed, state: 'next' };
  if (request.status === 'requested') return [{ ...received, state: 'now' }, { label: CARE_REQUEST_STATUSES.reviewing, state: 'next' }, next];
  const now: Step = { label: CARE_REQUEST_STATUSES[request.status], time: request.respondedAt ? formatCareTime(request.respondedAt) : null, state: 'now' };
  return OPEN_STATUSES.includes(request.status) ? [{ ...received, state: 'done' }, now, next] : [{ ...received, state: 'done' }, now];
}

export default function CareRequest() {
  const { hospitalId } = useLocalSearchParams<{ hospitalId?: string }>();
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
  const [month, setMonth] = useState(0);
  // One key per draft so a retried submit after a lost response is not stored twice.
  const submitKey = useRef<string | null>(null);
  const months = useMemo(() => careCalendarMonths(careStartOptions()), []);
  const supported = (hospitalId ?? CARE_HOSPITAL_ID).toLowerCase() === CARE_HOSPITAL_ID;
  const shownMonth = months[Math.min(month, months.length - 1)];

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
  const ready = Boolean(draft.desiredStart && draft.careType);
  const submit = async () => {
    if (!token || !ready || submitting) return;
    submitKey.current ??= randomUUID();
    setSubmitting(true); setSubmitError(null);
    try {
      await platformRequest('request_hospital_care', { hospitalId: CARE_HOSPITAL_ID, ...draft, contactTime: CONTACT_TIME, idempotencyKey: submitKey.current }, token);
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
  const confirmCancel = (requestId: string) => Alert.alert('요청 취소', undefined, [
    { text: '닫기', style: 'cancel' },
    { text: '요청 취소', style: 'destructive', onPress: () => void cancel(requestId) },
  ]);

  const card = (request: HospitalCareRequest) => {
    const tone = CARE_STATUS_TONES[request.status];
    return <View key={request.id} style={local.card}>
      <View style={local.cardHead}>
        <View style={styles.row}><Text style={[styles.heading, styles.flexible]}>{formatCareDate(request.desiredStart)} 시작</Text><CareStatusBadge status={request.status} /></View>
        <Text style={local.sub}>{CARE_TYPES[request.careType]}</Text>
      </View>
      <View style={local.steps}>{timeline(request).map((step, index, all) => <View key={step.label} style={local.step}>
        <View style={local.rail}>
          <View style={[local.dot, step.state === 'done' && local.dotDone, step.state === 'now' && { width: 16, height: 16, borderRadius: 8, borderWidth: 0, backgroundColor: tone.fg, boxShadow: `0 0 0 5px ${tone.bg}` }]} />
          {index < all.length - 1 && <View style={[local.line, step.state === 'done' && local.lineDone]} />}
        </View>
        <View style={[local.stepCopy, index === all.length - 1 && { paddingBottom: 0 }]}>
          <Text style={[local.stepText, step.state === 'done' && local.stepDone, step.state === 'now' && local.stepNow]}>{step.label}</Text>
          {!!step.time && <Text style={styles.caption}>{step.time}</Text>}
        </View>
      </View>)}</View>
      {request.staffNote && <View style={local.note}><IconTile name="chat-bubble" tone="orange" size={34} /><Text style={local.noteText}>{request.staffNote}</Text></View>}
      {request.status === 'confirmed' && <View style={local.accordion}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: expanded === request.id }}
          onPress={() => setExpanded(expanded === request.id ? null : request.id)} style={[styles.row, local.toggle]}>
          <IconTile name="checklist" tone="green" size={34} />
          <Text style={[local.toggleText, styles.flexible]}>간병 시작 전 확인할 것</Text>
          <MaterialIcons name={expanded === request.id ? 'expand-less' : 'expand-more'} size={24} color={COLORS.gray[500]} accessible={false} />
        </Pressable>
        {expanded === request.id && <View style={{ gap: 10, paddingBottom: 6 }}>{CARE_PRECAUTIONS.map((item, index) => <View key={item} style={[styles.row, { alignItems: 'flex-start' }]}>
          <Text style={local.number}>{index + 1}</Text><Text style={[local.precaution, styles.flexible]}>{item}</Text>
        </View>)}</View>}
      </View>}
      {OPEN_STATUSES.includes(request.status) && <Button variant="ghost" onPress={() => confirmCancel(request.id)} textStyle={local.cancelText}>요청 취소</Button>}
    </View>;
  };

  return <HospitalScreen detail title="간병 예약">
    <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
      <View style={[styles.content, { gap: 26 }]}>
        <View style={{ gap: 4 }}>
          <Text style={local.sub}>{HOSPITAL_NAME}</Text>
          <Text style={styles.title}>간병 예약 요청</Text>
        </View>

        {!supported ? <Text style={styles.body}>이 병원은 아직 간병 예약을 받지 않습니다.</Text>
          : !session.hydrated ? <ActivityIndicator color={COLORS.primary} />
          : !token ? <View style={{ gap: 12 }}>
            <Text style={styles.body}>로그인한 뒤 예약을 요청할 수 있습니다.</Text>
            <Button size="lg" onPress={() => router.push('/services/login')}>로그인</Button>
          </View>
          : <>
            <View style={{ gap: 8 }}>
              <Text accessibilityRole="header" style={styles.heading}>희망 시작일</Text>
              {shownMonth && <View style={local.monthHead}>
                <Pressable accessibilityRole="button" accessibilityLabel="이전 달" disabled={month === 0} onPress={() => setMonth(month - 1)} style={local.monthButton}>
                  <MaterialIcons name="chevron-left" size={28} color={month === 0 ? COLORS.gray[300] : COLORS.text.primary} accessible={false} />
                </Pressable>
                <Text style={local.monthLabel}>{shownMonth.label}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="다음 달" disabled={month >= months.length - 1} onPress={() => setMonth(month + 1)} style={local.monthButton}>
                  <MaterialIcons name="chevron-right" size={28} color={month >= months.length - 1 ? COLORS.gray[300] : COLORS.text.primary} accessible={false} />
                </Pressable>
              </View>}
              <View style={local.grid}>
                {CARE_WEEKDAYS.map((weekday, index) => <Text key={weekday} style={[local.weekday, index === 0 && local.sunday]}>{weekday}</Text>)}
                {shownMonth?.cells.map((cell, index) => {
                  if (!cell) return <View key={`blank-${index}`} style={local.cell} />;
                  const selected = cell.value !== null && draft.desiredStart === cell.value;
                  const content = <>
                    <Text style={[local.day, !cell.value && local.dayOff, cell.value && cell.sunday && local.sunday, selected && local.daySelected]}>{cell.day}</Text>
                    {cell.today && <Text style={[local.today, selected && local.daySelected]}>오늘</Text>}
                  </>;
                  if (!cell.value) return <View key={cell.day} style={local.cell}>{content}</View>;
                  const value = cell.value;
                  const [, m, d] = value.split('-').map(Number);
                  return <Pressable key={cell.day} accessibilityRole="button" accessibilityState={{ selected }} aria-pressed={selected}
                    accessibilityLabel={`${m}월 ${d}일 ${CARE_WEEKDAYS[(index) % 7]}요일${cell.today ? ', 오늘' : ''}`}
                    onPress={() => update({ desiredStart: value })} style={({ pressed }) => [local.cell, selected && local.cellSelected, pressed && !selected && local.cellPressed]}>{content}</Pressable>;
                })}
              </View>
            </View>
            <View style={{ gap: 12 }}>
              <Text accessibilityRole="header" style={styles.heading}>간병 형태</Text>
              <View style={local.options}>{(Object.keys(CARE_TYPES) as HospitalCareRequest['careType'][]).map((value) => {
                const selected = draft.careType === value;
                return <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected }} aria-pressed={selected} onPress={() => update({ careType: value })}
                  style={({ pressed }) => [local.option, selected && local.optionSelected, pressed && !selected && local.cellPressed]}>
                  <View style={styles.row}>
                    <View style={styles.flexible}><IconTile name={CARE_TYPE_ICONS[value].name} tone={CARE_TYPE_ICONS[value].tone} /></View>
                    <MaterialIcons name="check-circle" size={24} color={selected ? COLORS.primaryButton : COLORS.gray[300]} accessible={false} />
                  </View>
                  <Text style={local.optionText}>{CARE_TYPES[value]}</Text>
                </Pressable>;
              })}</View>
            </View>
            <View style={{ gap: 12 }}>
              <View style={local.summary}>
                {([['희망 시작일', draft.desiredStart && formatCareDate(draft.desiredStart)], ['간병 형태', draft.careType && CARE_TYPES[draft.careType]]] as const).map(([label, value], index) =>
                  <View key={label} style={[local.summaryRow, index > 0 && local.divided]}>
                    <Text style={local.summaryLabel}>{label}</Text>
                    {value ? <Text style={local.summaryValue}>{value}</Text> : <View style={local.missing} />}
                  </View>)}
              </View>
              {submitError && <Text accessibilityRole="alert" style={styles.body}>{submitError}</Text>}
              <Button size="lg" disabled={!ready} loading={submitting} onPress={() => void submit()} style={local.cta} textStyle={local.ctaText}>예약 요청 보내기</Button>
            </View>

            <View style={{ gap: 14, marginTop: 10 }}>
              <Text accessibilityRole="header" style={local.listTitle}>내 예약 요청</Text>
              {loading && !requests && <ActivityIndicator color={COLORS.primary} />}
              {error && <View style={styles.error}><Text accessibilityRole="alert" style={styles.body}>{error}</Text>
                <Button variant="outline" loading={loading} onPress={() => void refresh()}>다시 확인하기</Button></View>}
              {requests?.length === 0 && <Text style={styles.body}>아직 요청한 내역이 없습니다.</Text>}
              {requests?.map((request, index) => index === 0 || OPEN_STATUSES.includes(request.status) ? card(request)
                : <View key={request.id} style={local.past}>
                  <View style={styles.flexible}><Text style={local.pastTitle}>{formatCareDate(request.desiredStart)} 시작</Text><Text style={local.sub}>{CARE_TYPES[request.careType]}</Text></View>
                  <CareStatusBadge status={request.status} />
                </View>)}
            </View>
          </>}
      </View>
    </ScrollView>
  </HospitalScreen>;
}

const local = StyleSheet.create({
  sub: { fontSize: 15, lineHeight: 22, color: COLORS.text.secondary },
  monthHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14 },
  monthButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  monthLabel: { minWidth: 96, textAlign: 'center', fontSize: 20, lineHeight: 28, fontWeight: '800', color: COLORS.text.primary, fontVariant: ['tabular-nums'] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 4 },
  weekday: { width: '14.2857%', textAlign: 'center', fontSize: 14, lineHeight: 30, color: COLORS.gray[500] },
  cell: { width: '14.2857%', height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cellSelected: { backgroundColor: COLORS.primaryButton },
  cellPressed: { backgroundColor: COLORS.gray[100] },
  day: { fontSize: 17, lineHeight: 22, color: COLORS.text.primary, fontVariant: ['tabular-nums'] },
  dayOff: { color: COLORS.gray[300] },
  sunday: { color: '#d93a3a' },
  daySelected: { color: COLORS.white, fontWeight: '700' },
  today: { fontSize: 11, lineHeight: 13, fontWeight: '700', color: COLORS.primaryDark },
  options: { flexDirection: 'row', gap: 10 },
  option: { flex: 1, borderWidth: 1.5, borderColor: COLORS.border.light, borderRadius: 18, padding: 16, gap: 14 },
  optionSelected: { borderColor: COLORS.primary, backgroundColor: '#fffaf6' },
  optionText: { fontSize: 17, lineHeight: 24, fontWeight: '700', color: COLORS.text.primary },
  summary: { backgroundColor: COLORS.gray[50], borderRadius: 18, paddingHorizontal: 18 },
  summaryRow: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summaryLabel: { fontSize: 15, color: COLORS.text.secondary },
  summaryValue: { fontSize: 16, fontWeight: '700', color: COLORS.text.primary },
  missing: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.primary },
  divided: { borderTopWidth: 1, borderTopColor: COLORS.border.light },
  cta: { borderRadius: 16 },
  ctaText: { fontSize: 17, fontWeight: '700' },
  listTitle: { fontSize: 22, lineHeight: 30, fontWeight: '800', letterSpacing: -0.6, color: COLORS.text.primary },
  card: { borderWidth: 1, borderColor: COLORS.border.light, borderRadius: 22, paddingHorizontal: 18, paddingTop: 18, paddingBottom: 8, gap: 16 },
  cardHead: { gap: 4 },
  steps: {},
  step: { flexDirection: 'row', gap: 12 },
  rail: { width: 22, alignItems: 'center' },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: COLORS.gray[300], backgroundColor: COLORS.white, marginTop: 6 },
  dotDone: { backgroundColor: COLORS.gray[400], borderColor: COLORS.gray[400] },
  line: { flex: 1, width: 2, marginVertical: 3, backgroundColor: COLORS.border.light },
  lineDone: { backgroundColor: COLORS.gray[400] },
  stepCopy: { flex: 1, paddingBottom: 16 },
  stepText: { fontSize: 16, lineHeight: 24, color: COLORS.gray[500] },
  stepDone: { color: COLORS.text.secondary },
  stepNow: { color: COLORS.text.primary, fontWeight: '700' },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: COLORS.gray[50], borderRadius: 16, padding: 14 },
  noteText: { flex: 1, minWidth: 0, fontSize: 15, lineHeight: 24, color: COLORS.text.primary, paddingTop: 4 },
  accordion: { borderTopWidth: 1, borderTopColor: COLORS.border.light },
  toggle: { minHeight: 60 },
  toggleText: { fontSize: 16, lineHeight: 24, fontWeight: '700', color: COLORS.text.primary },
  number: { minWidth: 20, fontSize: 15, lineHeight: 24, fontWeight: '700', color: COLORS.text.primary },
  precaution: { fontSize: 15, lineHeight: 24, color: COLORS.text.secondary },
  cancelText: { fontSize: 15, fontWeight: '500', color: COLORS.gray[500] },
  past: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 68, borderBottomWidth: 1, borderBottomColor: COLORS.border.light },
  pastTitle: { fontSize: 16, lineHeight: 24, fontWeight: '600', color: COLORS.text.primary },
});
