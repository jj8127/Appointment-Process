import { useState } from 'react';
import { Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { FormInput } from '@/components/FormInput';
import { informationStyles as styles } from '@/components/ServiceInformation';
import { formatCareDate } from '@/lib/hospital-care';
import { CARE_REQUEST_STATUSES, CARE_TYPES, CONTACT_TIMES, type HospitalCareRequest } from '@/lib/platform-api';

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

/** Open requests first so staff answer the oldest waiting member before anything else. */
export default function CareRequestAdmin({ requests, metrics, busy, onRespond, onMark }: {
  requests: AdminCareRequest[]; metrics: CareMetrics | null; busy: boolean;
  onRespond: (requestId: string, status: Decision, note: string) => void;
  onMark: (requestId: string, milestone: Milestone) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const open = requests.filter((item) => item.status === 'requested' || item.status === 'reviewing')
    .sort((a, b) => Date.parse(a.firstContactDueAt) - Date.parse(b.firstContactDueAt));
  const rest = requests.filter((item) => !open.includes(item));
  const respond = (request: AdminCareRequest, status: Decision) => {
    if ((status === 'adjusted' || status === 'declined') && !note.trim()) { setNoteError('일정 조정과 진행 어려움은 회원에게 보낼 안내를 입력해 주세요.'); return; }
    setNoteError(null);
    onRespond(request.id, status, note.trim());
  };
  const row = (request: AdminCareRequest) => {
    const countdown = firstContactLabel(request);
    return <View key={request.id} style={styles.list}>
      <Text style={styles.item}>{request.hospitalName} · {formatCareDate(request.desiredStart)} 시작 · {CARE_TYPES[request.careType]}</Text>
      <Text style={styles.item}>{request.memberName ?? '회원'} · {request.memberPhone ? formatPhone(request.memberPhone) : '연락처 없음'} · 연락 {CONTACT_TIMES[request.contactTime]}</Text>
      <Text style={styles.item}>{CARE_REQUEST_STATUSES[request.status]} · {countdown ?? elapsedLabel(request.createdAt)}{request.careStartedAt ? ' · 간병 시작됨' : ''}{request.staffNote ? ` · 안내: ${request.staffNote}` : ''}</Text>
      {countdown && <Button variant="outline" disabled={busy} onPress={() => onMark(request.id, 'first_contact')}>첫 연락 완료</Button>}
      {request.status === 'confirmed' && !request.careStartedAt && <Button variant="outline" disabled={busy} onPress={() => onMark(request.id, 'care_started')}>간병 시작 확인</Button>}
      {request.status !== 'cancelled' && (selected === request.id ? <>
        <FormInput label="회원에게 보낼 안내 (확정 시 선택)" accessibilityLabel="회원 안내" value={note} editable={!busy} maxLength={500} multiline
          onChangeText={(value) => { setNote(value); setNoteError(null); }} />
        {noteError && <Text accessibilityRole="alert" style={styles.item}>{noteError}</Text>}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {DECISIONS.map((status) => <Button key={status} variant={status === 'confirmed' ? 'primary' : 'outline'} disabled={busy}
            onPress={() => respond(request, status)}>{CARE_REQUEST_STATUSES[status]}</Button>)}
        </View>
        <Button variant="ghost" disabled={busy} onPress={() => setSelected(null)}>닫기</Button>
      </> : <Button variant="outline" disabled={busy} onPress={() => { setSelected(request.id); setNote(request.staffNote ?? ''); setNoteError(null); }}>처리하기</Button>)}
    </View>;
  };
  return <>
    <Text style={styles.sectionTitle}>간병 예약 요청 · 답변 대기 {open.length}건</Text>
    {metrics && <View style={styles.list}>
      <Text style={styles.item}>최근 30일 {metrics.requests}건 · 첫 연락 기한 준수 {percent(metrics.firstContactOnTime, metrics.firstContactDue)} · 지금 기한 초과 {metrics.overdueNow}건</Text>
      <Text style={styles.item}>첫 연락 중앙값 {median(metrics.medianFirstContactMinutes)} · 결정 중앙값 {median(metrics.medianDecisionMinutes)} · 확정 {metrics.confirmed}건 · 시작 {metrics.started}건</Text>
    </View>}
    {requests.length === 0 && <Text style={styles.body}>받은 예약 요청이 없습니다.</Text>}
    {open.map(row)}
    {rest.map(row)}
  </>;
}
