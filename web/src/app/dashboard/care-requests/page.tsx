'use client';

import { Alert, Button, Container, Group, Loader, SegmentedControl, Stack, Text, Textarea, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type CSSProperties } from 'react';

import { QueryErrorAlert } from '@/components/QueryErrorAlert';
import { useSession } from '@/hooks/use-session';
import { QueryReadError } from '@/lib/query-read-error';
import {
  CARE_DECISIONS, CARE_REQUEST_STATUSES, CARE_TYPES, careMedian, carePercent, careQueue, decisionNeedsNote, firstContactMinutesLeft,
  formatCareDate, formatCarePhone, formatCareTime, minutesLabel,
  type AdminCareRequest, type CareDecision, type CareMetrics, type CareMilestone,
} from '@shared/lib/hospital-care-queue';
import surface from '../surface.module.css';
import styles from './page.module.css';

const API = '/api/admin/care-requests';
// Waiting requests are re-read every minute so the deadlines stay current.
const REFRESH_MS = 60_000;
// Rows turn orange once the first-contact deadline is this close.
const SOON_MINUTES = 30;
const STATUS_COLOR: Record<AdminCareRequest['status'], string> = {
  requested: 'gray', reviewing: 'blue', confirmed: 'green', adjusted: 'orange', declined: 'red', cancelled: 'gray',
};
type Tab = 'open' | 'confirmed' | 'all';
type Answer = { action: 'respond'; requestId: string; status: CareDecision; note: string } | { action: 'mark'; requestId: string; milestone: CareMilestone };

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const isCareRequest = (value: unknown): value is AdminCareRequest => isRecord(value)
  && typeof value.id === 'string' && typeof value.hospitalName === 'string' && typeof value.desiredStart === 'string'
  && typeof value.careType === 'string' && value.careType in CARE_TYPES
  && typeof value.status === 'string' && value.status in CARE_REQUEST_STATUSES
  && typeof value.createdAt === 'string' && typeof value.firstContactDueAt === 'string';

async function request(init?: RequestInit): Promise<unknown> {
  const result = await fetch(API, { credentials: 'same-origin', cache: 'no-store', ...init });
  const data: unknown = await result.json().catch(() => null);
  if (!result.ok) {
    if (init?.method === 'POST') throw new Error(isRecord(data) && typeof data.error === 'string' ? data.error : '요청을 처리하지 못했습니다.');
    throw new QueryReadError(result.status);
  }
  return data;
}

function requireQueue(value: unknown): { requests: AdminCareRequest[]; metrics: CareMetrics | null } {
  if (!isRecord(value) || value.ok !== true || !Array.isArray(value.requests) || !value.requests.every(isCareRequest)) throw new QueryReadError();
  return { requests: value.requests, metrics: isRecord(value.metrics) ? value.metrics as CareMetrics : null };
}

export default function CareRequestsPage() {
  const { hydrated, role, isReadOnly, residentId } = useSession();
  if (!hydrated) return <Container py="xl"><Loader aria-label="세션 확인 중" /></Container>;
  if (role !== 'admin' || isReadOnly) return <Container py="xl"><Alert color="orange">간병 예약 요청은 관리자만 처리할 수 있습니다.</Alert></Container>;
  return <CareRequestWorkspace key={residentId ?? 'anonymous'} sessionKey={residentId ?? 'anonymous'} />;
}

function CareRequestWorkspace({ sessionKey }: { sessionKey: string }) {
  const queryClient = useQueryClient();
  const queryKey = ['care-requests', sessionKey] as const;
  const query = useQuery({ queryKey, queryFn: async ({ signal }) => requireQueue(await request({ signal })), refetchInterval: REFRESH_MS, retry: false });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const requests = query.data?.requests ?? [];
  const metrics = query.data?.metrics ?? null;
  const { open, confirmed, all } = careQueue(requests);
  const overdue = open.filter((item) => (firstContactMinutesLeft(item, now) ?? 0) < 0).length;
  // Until staff pick a tab or a row, show waiting requests and the most urgent one.
  const [pickedTab, setTab] = useState<Tab | null>(null);
  const tab = pickedTab ?? (open.length ? 'open' : 'all');
  const shown = tab === 'open' ? open : tab === 'confirmed' ? confirmed : all;
  const [pickedId, setPickedId] = useState<string | null>(null);
  const selected = shown.find((item) => item.id === pickedId) ?? shown[0] ?? null;

  const answer = useMutation({
    mutationFn: async (body: Answer) => request({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    onSuccess: async (_, body) => {
      notifications.show({ color: 'green', message: body.action === 'respond' ? '응답을 보냈습니다.' : body.milestone === 'first_contact' ? '첫 연락을 기록했습니다.' : '간병 시작을 기록했습니다.' });
      // A final answer moves the request out of the waiting queue, so the next urgent one opens.
      if (body.action === 'respond' && body.status !== 'reviewing') setPickedId(null);
      await queryClient.invalidateQueries({ queryKey });
    },
  });

  return (
    <div className={surface.page}>
      <div className={surface.head} style={{ '--i': 0 } as CSSProperties}>
        <div>
          <Title order={1} className={surface.title}>간병 예약 요청</Title>
          <div className={surface.headMeta}>
            <span className={surface.metaChip} data-tone={!query.data ? undefined : open.length ? 'hot' : 'ok'}><i />답변 대기 <b>{query.data ? `${open.length}건` : '-'}</b></span>
            {overdue ? <span className={surface.metaChip} data-tone="hot"><i />첫 연락 기한 초과 <b>{overdue}건</b></span> : null}
          </div>
        </div>
      </div>
      {metrics ? (
        <div className={surface.statGroup} style={{ '--cols': 4, '--i': 1 } as CSSProperties} aria-label="최근 30일 처리 현황">
          {([
            ['최근 30일 요청', `${metrics.requests}건`, `확정 ${metrics.confirmed}건 · 시작 ${metrics.started}건`],
            ['첫 연락 기한 준수', carePercent(metrics.firstContactOnTime, metrics.firstContactDue), `${metrics.firstContactOnTime} / ${metrics.firstContactDue}건`],
            ['첫 연락까지', careMedian(metrics.medianFirstContactMinutes), '중앙값'],
            ['결정까지', careMedian(metrics.medianDecisionMinutes), '중앙값'],
          ] as const).map(([label, value, foot]) => (
            <div key={label} className={surface.statTile} style={{ minHeight: 0 }}>
              <span className={surface.statLabel}>{label}</span>
              <span className={surface.statValue}>{value}</span>
              <span className={surface.statFoot}>{foot}</span>
            </div>
          ))}
        </div>
      ) : null}
      {query.error ? <QueryErrorAlert error={query.error} onRetry={query.refetch} isFetching={query.isFetching} hasData={Boolean(query.data)} subject="간병 요청 자료" /> : null}
      {query.error && !query.data ? null : <div className={styles.layout}>
        <section className={surface.tableCard} style={{ '--i': 2 } as CSSProperties} aria-label="요청 목록">
          <div className={styles.queueHead}>
            <SegmentedControl radius="xl" value={tab} onChange={(value) => { setTab(value as Tab); setPickedId(null); }}
              data={[{ value: 'open', label: `답변 대기 ${open.length}` }, { value: 'confirmed', label: `확정 ${confirmed.length}` }, { value: 'all', label: `전체 ${requests.length}` }]} />
            {query.isFetching ? <Loader size="xs" aria-label="새로 불러오는 중" /> : null}
          </div>
          {query.isPending ? <div className={styles.empty}><Loader aria-label="요청 목록 조회 중" /></div>
            : !shown.length ? <p className={styles.empty}>{tab === 'open' ? '답변을 기다리는 요청이 없습니다.' : '받은 예약 요청이 없습니다.'}</p>
              : <div className={styles.queue}>{shown.map((item) => <QueueRow key={item.id} item={item} now={now} active={item.id === selected?.id} onSelect={() => { setPickedId(item.id); answer.reset(); }} />)}</div>}
        </section>
        <section className={`${surface.card} ${styles.panel}`} style={{ '--i': 3 } as CSSProperties} aria-label="응답">
          {selected ? <AnswerPanel key={selected.id} item={selected} now={now} busy={answer.isPending}
            error={answer.error?.message ?? null} onAnswer={(body) => answer.mutate(body)} />
            : <p className={styles.empty}>요청을 선택하세요.</p>}
        </section>
      </div>}
    </div>
  );
}

function QueueRow({ item, now, active, onSelect }: { item: AdminCareRequest; now: number; active: boolean; onSelect: () => void }) {
  const left = firstContactMinutesLeft(item, now);
  const tone = left === null ? undefined : left < 0 ? 'late' : left <= SOON_MINUTES ? 'soon' : undefined;
  // The box shows time since the request; its color still follows the first-contact deadline.
  const elapsed = Math.max(0, Math.floor((now - Date.parse(item.createdAt)) / 60000));
  return (
    <button type="button" className={styles.row} data-active={active || undefined} aria-current={active || undefined} onClick={onSelect}>
      <span className={styles.due} data-tone={tone}>
        <span className={styles.dueValue}>{minutesLabel(elapsed)}</span><span className={styles.dueUnit}>전</span>
      </span>
      <span className={styles.who}>
        <span className={styles.name}>{item.memberName ?? '회원'}</span>
        <span className={styles.line}>{item.hospitalName} · {formatCareDate(item.desiredStart)} · {CARE_TYPES[item.careType]}</span>
      </span>
      <span className={surface.pill} data-color={STATUS_COLOR[item.status]}>{CARE_REQUEST_STATUSES[item.status]}</span>
    </button>
  );
}

function AnswerPanel({ item, now, busy, error, onAnswer }: {
  item: AdminCareRequest; now: number; busy: boolean; error: string | null; onAnswer: (body: Answer) => void;
}) {
  const [decision, setDecision] = useState<CareDecision | null>(null);
  const [note, setNote] = useState(item.staffNote ?? '');
  const [noteError, setNoteError] = useState<string | null>(null);
  const left = firstContactMinutesLeft(item, now);
  const answerable = item.status !== 'cancelled';
  const send = () => {
    if (!decision) return;
    if (decisionNeedsNote(decision) && !note.trim()) { setNoteError('회원에게 보낼 안내를 입력해 주세요.'); return; }
    onAnswer({ action: 'respond', requestId: item.id, status: decision, note: note.trim() });
  };
  const steps: { label: string; time: string | null; late?: boolean }[] = [
    { label: '요청 접수', time: formatCareTime(item.createdAt) },
    { label: '첫 연락', time: item.firstContactAt ? formatCareTime(item.firstContactAt) : null, late: left !== null && left < 0 },
    { label: '결정', time: item.decidedAt ? formatCareTime(item.decidedAt) : null },
    { label: '간병 시작', time: item.careStartedAt ? formatCareTime(item.careStartedAt) : null },
  ];

  return (
    <Stack gap={18}>
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <div>
          <Title order={2} fz={20} fw={650}>{item.memberName ?? '회원'}</Title>
          {item.memberPhone ? <a className={styles.phone} href={`tel:${item.memberPhone}`}>{formatCarePhone(item.memberPhone)}</a> : <Text c="dimmed">연락처 없음</Text>}
        </div>
        <span className={surface.pill} data-color={STATUS_COLOR[item.status]}>{CARE_REQUEST_STATUSES[item.status]}</span>
      </Group>
      <dl className={`${surface.well} ${styles.facts}`}>
        <dt>병원</dt><dd>{item.hospitalName}</dd>
        <dt>희망 시작</dt><dd>{formatCareDate(item.desiredStart)}</dd>
        <dt>간병 형태</dt><dd>{CARE_TYPES[item.careType]}</dd>
        {item.staffNote ? <><dt>보낸 안내</dt><dd>{item.staffNote}</dd></> : null}
      </dl>
      {/* Secondary to 응답 보내기; turns red once the deadline has passed. */}
      {left !== null ? <Button color={left < 0 ? 'red' : 'dark'} radius="xl" size="md" variant="light" loading={busy}
        onClick={() => onAnswer({ action: 'mark', requestId: item.id, milestone: 'first_contact' })}>첫 연락 완료</Button> : null}
      {item.status === 'confirmed' && !item.careStartedAt ? <Button color="dark" radius="xl" size="md" variant="light" loading={busy}
        onClick={() => onAnswer({ action: 'mark', requestId: item.id, milestone: 'care_started' })}>간병 시작 확인</Button> : null}
      {answerable ? (
        <Stack gap={10}>
          <Text fw={600} size="sm" id="care-decision">처리 결정</Text>
          <SegmentedControl aria-labelledby="care-decision" fullWidth radius="xl" disabled={busy} value={decision ?? ''}
            onChange={(value) => { setDecision(value as CareDecision); setNoteError(null); }}
            data={CARE_DECISIONS.map((value) => ({ value, label: CARE_REQUEST_STATUSES[value] }))} />
          <Textarea label="회원 안내" withAsterisk={decision ? decisionNeedsNote(decision) : false} autosize minRows={3} maxRows={8} maxLength={500}
            value={note} disabled={busy} error={noteError} onChange={(event) => { setNote(event.currentTarget.value); setNoteError(null); }} />
          {error ? <Alert color="red" role="alert">{error}</Alert> : null}
          <Button color="dark" radius="xl" size="md" disabled={!decision} loading={busy} onClick={send}>응답 보내기</Button>
        </Stack>
      ) : null}
      <ol className={styles.steps} aria-label="진행 상황">
        {steps.map((step) => <li key={step.label} data-done={step.time ? '' : undefined} data-late={!step.time && step.late ? '' : undefined}>
          <span>{step.label}</span>{step.time ? <time>{step.time}</time> : <span />}
        </li>)}
      </ol>
    </Stack>
  );
}
