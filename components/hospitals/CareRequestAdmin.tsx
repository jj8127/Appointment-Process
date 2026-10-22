import { MaterialIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { FormInput } from '@/components/FormInput';
import { CareStatusBadge } from '@/components/hospitals/HospitalScreen';
import { ChoiceRows } from '@/components/SelectionControls';
import { CARE_STATUS_TONES, formatCareDate } from '@/lib/hospital-care';
import { CARE_REQUEST_STATUSES, CARE_TYPES, type HospitalCareRequest } from '@/lib/platform-api';
import { COLORS } from '@/lib/theme';

export type AdminCareRequest = HospitalCareRequest & {
  memberName: string | null; memberPhone: string | null;
  firstContactDueAt: string; firstContactAt: string | null; decidedAt: string | null; careStartedAt: string | null;
};
export type CareMetrics = {
  requests: number; firstContactDue: number; firstContactOnTime: number; overdueNow: number;
  medianFirstContactMinutes: number | null; medianDecisionMinutes: number | null; confirmed: number; started: number;
};
type Decision = 'reviewing' | 'confirmed' | 'adjusted' | 'declined';
type Milestone = 'first_contact' | 'care_started';
type Tab = 'open' | 'confirmed' | 'all';
const DECISIONS: Decision[] = ['reviewing', 'confirmed', 'adjusted', 'declined'];

function minutesLabel(minutes: number) {
  if (minutes < 60) return `${minutes}분`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}시간`;
  return `${Math.floor(minutes / 1440)}일`;
}

export function elapsedLabel(createdAt: string, now = Date.now()) {
  return `${minutesLabel(Math.max(0, Math.floor((now - Date.parse(createdAt)) / 60000)))} 경과`;
}

/** First-contact countdown for an unanswered request; null once staff reached the member. */
export function firstContactLabel(request: Pick<AdminCareRequest, 'firstContactAt' | 'firstContactDueAt' | 'status'>, now = Date.now()) {
  if (request.firstContactAt || !['requested', 'reviewing'].includes(request.status)) return null;
  const left = Math.floor((Date.parse(request.firstContactDueAt) - now) / 60000);
  return left >= 0 ? `첫 연락 ${minutesLabel(left)} 남음` : `첫 연락 기한 ${minutesLabel(-left)} 초과`;
}

const formatPhone = (phone: string) => phone.replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3');
const percent = (part: number, whole: number) => whole ? `${Math.round((part / whole) * 100)}%` : '-';
const median = (value: number | null) => value === null ? '-' : minutesLabel(Math.round(value));

/** Waiting requests first, by first-contact due time; a row opens its answer panel in place. */
export default function CareRequestAdmin({ requests, metrics, busy, onRespond, onMark }: {
  requests: AdminCareRequest[]; metrics: CareMetrics | null; busy: boolean;
  onRespond: (requestId: string, status: Decision, note: string) => void;
  onMark: (requestId: string, milestone: Milestone) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const open = requests.filter((item) => item.status === 'requested' || item.status === 'reviewing')
    .sort((a, b) => Date.parse(a.firstContactDueAt) - Date.parse(b.firstContactDueAt));
  const rest = requests.filter((item) => !open.includes(item));
  const confirmed = requests.filter((item) => item.status === 'confirmed');
  // Until staff pick a tab, show waiting requests when there are any (data may arrive after the first render).
  const [picked, setTab] = useState<Tab | null>(null);
  const tab = picked ?? (open.length ? 'open' : 'all');
  const shown = tab === 'open' ? open : tab === 'confirmed' ? confirmed : [...open, ...rest];
  const toggle = (request: AdminCareRequest) => {
    const next = selected === request.id ? null : request.id;
    setSelected(next); setDecision(null); setNote(next ? request.staffNote ?? '' : ''); setNoteError(null);
  };
  const respond = (request: AdminCareRequest) => {
    if (!decision) return;
    if ((decision === 'adjusted' || decision === 'declined') && !note.trim()) { setNoteError('일정 조정과 진행 어려움은 회원에게 보낼 안내를 입력해 주세요.'); return; }
    setNoteError(null);
    onRespond(request.id, decision, note.trim());
  };

  const row = (request: AdminCareRequest) => {
    const countdown = firstContactLabel(request);
    const overdue = countdown?.includes('초과');
    const isOpen = selected === request.id;
    return <View key={request.id} style={[local.row, isOpen && local.rowOpen]}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: isOpen }} accessibilityLabel={`${request.memberName ?? '회원'} 요청 ${isOpen ? '접기' : '열기'}`}
        onPress={() => toggle(request)} style={({ pressed }) => [local.rowHead, pressed && { opacity: 0.6 }]}>
        <View style={local.rowCopy}>
          <Text style={local.name}>{request.memberName ?? '회원'}</Text>
          <Text style={local.line}>{formatCareDate(request.desiredStart)} · {CARE_TYPES[request.careType]}</Text>
          <View style={local.dueRow}>
            <MaterialIcons name="alarm" size={17} color={overdue ? CARE_STATUS_TONES.declined.fg : COLORS.gray[500]} accessible={false} />
            <Text style={[local.due, overdue && local.overdue]}>{countdown ?? elapsedLabel(request.createdAt)}{request.careStartedAt ? ' · 간병 시작됨' : ''}</Text>
          </View>
        </View>
        <CareStatusBadge status={request.status} />
        <MaterialIcons name={isOpen ? 'expand-less' : 'chevron-right'} size={24} color={COLORS.gray[400]} accessible={false} />
      </Pressable>
      {isOpen && <View style={local.panel}>
        <View style={local.facts}>
          {([['연락처', request.memberPhone ? formatPhone(request.memberPhone) : '연락처 없음'], ['시작일', formatCareDate(request.desiredStart)], ['형태', CARE_TYPES[request.careType]]] as const)
            .map(([label, value]) => <View key={label} style={local.fact}><Text style={local.factLabel}>{label}</Text><Text selectable style={local.factValue}>{value}</Text></View>)}
          {request.staffNote && <View style={local.fact}><Text style={local.factLabel}>안내</Text><Text style={local.factValue}>{request.staffNote}</Text></View>}
        </View>
        {countdown && <Button variant="outline" disabled={busy} onPress={() => onMark(request.id, 'first_contact')}>첫 연락 완료</Button>}
        {request.status === 'confirmed' && !request.careStartedAt && <Button variant="outline" disabled={busy} onPress={() => onMark(request.id, 'care_started')}>간병 시작 확인</Button>}
        {request.status !== 'cancelled' && <>
          <ChoiceRows label="처리 결정" value={decision ?? ''} disabled={busy} onChange={(status) => { setDecision(status); setNoteError(null); }}
            options={DECISIONS.map((status) => ({ value: status, label: CARE_REQUEST_STATUSES[status], color: CARE_STATUS_TONES[status].fg }))} />
          <FormInput label="회원에게 보낼 안내 (확정 시 선택)" accessibilityLabel="회원 안내" value={note} editable={!busy} maxLength={500} multiline
            onChangeText={(value) => { setNote(value); setNoteError(null); }} />
          {noteError && <Text accessibilityRole="alert" style={local.error}>{noteError}</Text>}
          <Button size="lg" disabled={busy || !decision} onPress={() => respond(request)}>처리하기</Button>
        </>}
      </View>}
    </View>;
  };

  return <View style={local.root}>
    <View style={{ gap: 2 }}>
      <Text style={local.kicker}>간병 예약 요청</Text>
      <View style={local.headline}><Text style={local.count}>{open.length}건</Text><Text style={local.countLabel}>답변 대기</Text></View>
    </View>
    {metrics && <>
      <View style={local.stats}>
        <View style={local.stat}><Text style={local.statValue}>{metrics.requests}건</Text><Text style={local.statLabel}>최근 30일</Text></View>
        <View style={local.stat}><Text style={local.statValue}>{percent(metrics.firstContactOnTime, metrics.firstContactDue)}</Text><Text style={local.statLabel}>기한 준수</Text></View>
        <View style={local.stat}><Text style={[local.statValue, metrics.overdueNow > 0 && local.overdue]}>{metrics.overdueNow}건</Text><Text style={local.statLabel}>기한 초과</Text></View>
      </View>
      <Text style={local.medians}>첫 연락 중앙값 {median(metrics.medianFirstContactMinutes)} · 결정 중앙값 {median(metrics.medianDecisionMinutes)} · 확정 {metrics.confirmed}건 · 시작 {metrics.started}건</Text>
    </>}
    {requests.length === 0 ? <Text style={local.empty}>받은 예약 요청이 없습니다.</Text> : <>
      <View style={local.tabs}>{([['open', `답변 대기 ${open.length}`], ['confirmed', `확정 ${confirmed.length}`], ['all', `전체 ${requests.length}`]] as const).map(([key, label]) =>
        <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: tab === key }} onPress={() => setTab(key)} style={[local.tab, tab === key && local.tabOn]}>
          <Text style={[local.tabText, tab === key && local.tabTextOn]}>{label}</Text>
        </Pressable>)}</View>
      <View>{shown.map(row)}</View>
    </>}
  </View>;
}

const local = StyleSheet.create({
  root: { gap: 16, marginTop: 12, marginBottom: 20 },
  kicker: { fontSize: 15, lineHeight: 22, color: COLORS.text.secondary },
  headline: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  count: { fontSize: 32, lineHeight: 40, fontWeight: '800', letterSpacing: -0.8, color: COLORS.primaryButton, fontVariant: ['tabular-nums'] },
  countLabel: { fontSize: 19, lineHeight: 27, fontWeight: '700', color: COLORS.text.primary },
  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, backgroundColor: COLORS.gray[50], borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, gap: 2 },
  statValue: { fontSize: 18, lineHeight: 24, fontWeight: '700', color: COLORS.text.primary, fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 13, lineHeight: 18, color: COLORS.text.secondary },
  medians: { fontSize: 13, lineHeight: 19, color: COLORS.gray[500] },
  empty: { fontSize: 16, lineHeight: 24, color: COLORS.text.secondary },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tab: { minHeight: 40, paddingHorizontal: 14, borderRadius: 20, justifyContent: 'center', backgroundColor: COLORS.gray[100] },
  tabOn: { backgroundColor: COLORS.text.primary },
  tabText: { fontSize: 15, color: COLORS.text.secondary },
  tabTextOn: { color: COLORS.white, fontWeight: '700' },
  row: { borderBottomWidth: 1, borderBottomColor: COLORS.border.light },
  rowOpen: { borderBottomWidth: 0, borderWidth: 1, borderColor: COLORS.border.light, borderRadius: 18, paddingHorizontal: 14, marginVertical: 8 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 16 },
  rowCopy: { flex: 1, minWidth: 0, gap: 3 },
  name: { fontSize: 17, lineHeight: 24, fontWeight: '700', color: COLORS.text.primary },
  line: { fontSize: 15, lineHeight: 22, color: COLORS.text.secondary },
  dueRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  due: { fontSize: 14, lineHeight: 20, color: COLORS.gray[500] },
  overdue: { color: CARE_STATUS_TONES.declined.fg, fontWeight: '700' },
  panel: { gap: 14, paddingBottom: 16 },
  facts: { gap: 8, backgroundColor: COLORS.gray[50], borderRadius: 14, padding: 14 },
  fact: { flexDirection: 'row', gap: 10 },
  factLabel: { width: 56, fontSize: 15, lineHeight: 22, color: COLORS.gray[500] },
  factValue: { flex: 1, minWidth: 0, fontSize: 16, lineHeight: 22, color: COLORS.text.primary },
  error: { fontSize: 14, lineHeight: 20, color: CARE_STATUS_TONES.declined.fg },
});
