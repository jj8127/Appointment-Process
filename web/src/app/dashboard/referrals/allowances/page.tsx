'use client';

import { Alert, Badge, Button, Checkbox, Container, Divider, FileInput, Group, Loader, Paper, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type CSSProperties } from 'react';
import surface from '../../surface.module.css';

import { useSession } from '@/hooks/use-session';
import { QueryErrorAlert } from '@/components/QueryErrorAlert';
import { QueryReadError } from '@/lib/query-read-error';
import { requireMutationSuccess } from '@/lib/user-intent-policy';
import {
  parseReferralAllowanceAdminMutationReceipt,
  parseReferralAllowanceStatement,
  parseReferralAllowanceSummary,
} from '@shared/lib/referral-allowance-response.ts';
import type { ReferralAllowanceAdminMutationExpectation } from '@shared/lib/referral-allowance-response.ts';
import type { ReferralAllowanceStatement } from '@shared/types/referral-allowance';

const API = '/api/admin/referral-allowance';
type Pilot = { manager_account_id: string | null; beneficiary_fc_id: string; employee_code: string; enabled: boolean; revision: number; name: string };
type ImportBase = { id: string; status: 'draft' | 'published' | 'superseded'; revision: number; source_sha256: string; performance_month: string; payment_date: string; genealogy_as_of: string; pilot_revision: number; created_at: string };
type ImportRow = ImportBase & { summary: ReferralAllowanceStatement['summary'] | null };
type ImportDetail = ImportBase & { snapshot: ReferralAllowanceStatement };
type Candidate = { managerAccountId: string | null; beneficiaryFcId: string; name: string; affiliation: string };
type AdminData = { recipients: Pilot[]; pilot: Pilot | null; imports: ImportRow[] };
const krw = (value: number) => `${value.toLocaleString('ko-KR')}원`;
const statusLabel = { draft: '검토 중', published: '앱 게시됨', superseded: '이전 자료' };
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNonNegativeSafeInteger = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const isPilot = (value: unknown): value is Pilot => isRecord(value)
  && (value.manager_account_id === null || typeof value.manager_account_id === 'string')
  && typeof value.beneficiary_fc_id === 'string'
  && typeof value.employee_code === 'string'
  && typeof value.enabled === 'boolean'
  && isNonNegativeSafeInteger(value.revision)
  && typeof value.name === 'string';
const isAllowanceSummary = (value: unknown): value is ReferralAllowanceStatement['summary'] => {
  try {
    parseReferralAllowanceSummary(value);
    return true;
  } catch {
    return false;
  }
};
const isImportBase = (value: unknown): value is ImportBase => isRecord(value)
  && typeof value.id === 'string'
  && ['draft', 'published', 'superseded'].includes(String(value.status))
  && isNonNegativeSafeInteger(value.revision)
  && typeof value.source_sha256 === 'string'
  && typeof value.performance_month === 'string'
  && typeof value.payment_date === 'string'
  && typeof value.genealogy_as_of === 'string'
  && isNonNegativeSafeInteger(value.pilot_revision)
  && typeof value.created_at === 'string';
const isImportRow = (value: unknown): value is ImportRow => isImportBase(value) && 'summary' in value
  && (value.summary === null || isAllowanceSummary(value.summary));
const isCandidate = (value: unknown): value is Candidate => isRecord(value)
  && (value.managerAccountId === null || typeof value.managerAccountId === 'string')
  && typeof value.beneficiaryFcId === 'string'
  && typeof value.name === 'string'
  && typeof value.affiliation === 'string';

async function request(url: string, init?: RequestInit): Promise<unknown> {
  const result = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...init });
  const data: unknown = await result.json().catch(() => null);
  if (!result.ok) {
    if (init?.method === 'POST') {
      throw new Error(isRecord(data) && typeof data.error === 'string' ? data.error : '요청을 처리하지 못했습니다.');
    }
    throw new QueryReadError(result.status);
  }
  return data;
}

function requireAdminData(value: unknown): AdminData {
  if (!isRecord(value) || value.ok !== true || !Array.isArray(value.recipients) || !Array.isArray(value.imports)
    || !value.recipients.every(isPilot) || !value.imports.every(isImportRow)
    || (value.pilot !== null && !isPilot(value.pilot))) throw new QueryReadError();
  return value as unknown as AdminData;
}

function requireCandidates(value: unknown): { candidates: Candidate[] } {
  if (!isRecord(value) || value.ok !== true || !Array.isArray(value.candidates) || !value.candidates.every(isCandidate)) throw new QueryReadError();
  return value as unknown as { candidates: Candidate[] };
}

function requireImportDetail(value: unknown): { import: ImportDetail } {
  const detailImport = isRecord(value) && isRecord(value.import) ? value.import : null;
  const snapshot = detailImport?.snapshot;
  if (!isRecord(value) || value.ok !== true || !detailImport || !isImportBase(detailImport)) throw new QueryReadError();
  try {
    parseReferralAllowanceStatement(snapshot);
  } catch {
    throw new QueryReadError();
  }
  return value as unknown as { import: ImportDetail };
}

function allowanceMutationExpectation(body: object | FormData): ReferralAllowanceAdminMutationExpectation {
  if (body instanceof FormData) {
    return {
      action: 'upload',
      beneficiaryFcId: String(body.get('beneficiaryFcId') ?? ''),
      performanceMonth: String(body.get('performanceMonth') ?? ''),
      expectedPilotRevision: Number(body.get('expectedPilotRevision')),
    };
  }
  if (!isRecord(body)) throw new Error('증원수당 저장 요청이 올바르지 않습니다.');
  if (body.action === 'configure') {
    if ((body.managerAccountId !== null && typeof body.managerAccountId !== 'string')
      || typeof body.beneficiaryFcId !== 'string'
      || typeof body.employeeCode !== 'string'
      || typeof body.enabled !== 'boolean'
      || typeof body.expectedRevision !== 'number') {
      throw new Error('대상자 연결 저장 요청이 올바르지 않습니다.');
    }
    return {
      action: 'configure',
      managerAccountId: body.managerAccountId,
      beneficiaryFcId: body.beneficiaryFcId,
      employeeCode: body.employeeCode,
      enabled: body.enabled,
      expectedRevision: body.expectedRevision,
    };
  }
  if (body.action === 'publish'
    && typeof body.importId === 'string'
    && typeof body.sourceSha256 === 'string'
    && typeof body.expectedRevision === 'number'
    && typeof body.expectedPilotRevision === 'number') {
    return {
      action: 'publish',
      importId: body.importId,
      sourceSha256: body.sourceSha256,
      expectedRevision: body.expectedRevision,
      expectedPilotRevision: body.expectedPilotRevision,
    };
  }
  throw new Error('증원수당 게시 요청이 올바르지 않습니다.');
}

export default function AllowanceAdminPage() {
  const { hydrated, role, isReadOnly, residentId } = useSession();
  if (!hydrated) return <Container py="xl"><Loader aria-label="세션 확인 중" /></Container>;
  if (role !== 'admin' || isReadOnly) return <Container py="xl"><Alert color="orange">증원수당 업로드는 관리자만 이용할 수 있습니다.</Alert></Container>;
  return <AllowanceAdminWorkspace key={residentId ?? 'anonymous'} sessionKey={residentId ?? 'anonymous'} />;
}

function AllowanceAdminWorkspace({ sessionKey }: { sessionKey: string }) {
  const queryClient = useQueryClient();
  const [recipientId, setRecipientId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch] = useDebouncedValue(search, 250);
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [employeeCode, setEmployeeCode] = useState('');
  const [mappingConfirmed, setMappingConfirmed] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [month, setMonth] = useState('');
  const [paymentDate, setPaymentDate] = useState('');
  const [genealogyAsOf, setGenealogyAsOf] = useState('');
  const [personnelSourceDate, setPersonnelSourceDate] = useState('');
  const [sourceConfirmed, setSourceConfirmed] = useState(false);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [selectedImportId, setSelectedImportId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const queryKey = ['allowance-admin', sessionKey, recipientId] as const;
  const query = useQuery({ queryKey, queryFn: async ({ signal }) => requireAdminData(await request(`${API}${recipientId ? `?beneficiaryFcId=${encodeURIComponent(recipientId)}` : ''}`, { signal })), gcTime: 0, staleTime: 0, retry: false });
  const candidates = useQuery({ queryKey: [...queryKey, 'candidates', debouncedSearch],
    queryFn: async ({ signal }) => requireCandidates(await request(`${API}?search=${encodeURIComponent(debouncedSearch)}`, { signal })),
    enabled: debouncedSearch.trim().length >= 2, gcTime: 0, retry: false });
  const pilot = query.data?.pilot;
  const detail = useQuery({ queryKey: [...queryKey, 'detail', selectedImportId, pilot?.revision],
    queryFn: async ({ signal }) => requireImportDetail(await request(`${API}?importId=${encodeURIComponent(selectedImportId!)}&beneficiaryFcId=${encodeURIComponent(pilot!.beneficiary_fc_id)}`, { signal })),
    enabled: Boolean(selectedImportId && pilot), gcTime: 0, staleTime: 0, retry: false });
  const mutate = useMutation({
    mutationFn: async (body: object | FormData) => {
      const expected = allowanceMutationExpectation(body);
      const data = await request(API, body instanceof FormData
        ? { method: 'POST', body } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      requireMutationSuccess(data);
      try {
        return parseReferralAllowanceAdminMutationReceipt(data, expected);
      } catch {
        throw new Error(expected.action === 'configure'
          ? '대상자 연결 저장 응답이 올바르지 않습니다.'
          : '증원수당 자료 저장 응답이 올바르지 않습니다.');
      }
    },
    onSuccess: async (data) => {
      setMessage(data.import?.status === 'draft'
        ? '검토 자료를 저장했습니다. 산정 내역을 확인해주세요.'
        : data.import ? '이미 처리된 동일 자료를 확인했습니다. 현재 상태와 산정 내역을 확인해주세요.'
          : '저장했습니다. 현재 계정과 산정 내역을 확인해주세요.');
      setMappingConfirmed(false); setSourceConfirmed(false); setReviewConfirmed(false);
      if (data.import) setSelectedImportId(data.import.id);
      if (data.pilot) { setRecipientId(data.pilot.beneficiaryFcId); setSelectedImportId(null); }
      await queryClient.invalidateQueries({ queryKey: ['allowance-admin', sessionKey] });
    },
  });
  const upload = () => {
    if (!file || !pilot) return;
    const data = new FormData();
    data.set('file', file); data.set('performanceMonth', month); data.set('paymentDate', paymentDate);
    data.set('genealogyAsOf', genealogyAsOf); data.set('expectedPilotRevision', String(pilot.revision));
    data.set('personnelSourceDate', personnelSourceDate);
    data.set('beneficiaryFcId', pilot.beneficiary_fc_id);
    data.set('sourceConfirmed', String(sourceConfirmed)); setMessage(''); mutate.mutate(data);
  };
  const selected = candidates.data?.candidates.find((candidate) => candidate.beneficiaryFcId === candidateId);
  const selectedRevision = query.data?.recipients.find((item) => item.beneficiary_fc_id === candidateId)?.revision ?? 0;
  const statement = detail.data?.import.snapshot;
  const reviewed = detail.data?.import;
  return (
    <div className={surface.page} style={{ maxWidth: 1200 }}>
      <Stack gap={14}>
        <div className={surface.head} style={{ '--i': 0 } as CSSProperties}>
          <div><Title order={1} className={surface.title}>증원수당 월별 관리</Title><Text className={surface.subtitle}>대상자를 선택하고 월별 자료를 검토·게시합니다. 각 계정은 본인 수당만 조회합니다.</Text></div>
          <Badge color="dark" variant="white" size="xl" radius="xl">등록 대상 {query.data ? `${query.data.recipients.length}명` : query.isPending ? '조회 중' : '확인 불가'}</Badge>
        </div>
        <Alert color="orange" radius="lg" title="당월 신규 산정 내역">
          하위 FP별 최종 대상업적의 10%를 만원 단위로 절사하고 업로드한 계보 기준 상위 10단계에 반영합니다.
          전월 이월금 합산, 본부지원금과 별도 시상은 포함하지 않습니다. 앱 게시는 실제 지급 승인이 아닙니다.
        </Alert>
        {query.isPending ? <Loader aria-label="수당 설정 조회 중" /> : null}
        {query.error ? <QueryErrorAlert error={query.error} onRetry={query.refetch} isFetching={query.isFetching} hasData={Boolean(query.data)} subject="수당 설정" /> : null}
        {mutate.error ? <Alert color="red" title="저장하지 못했습니다">{mutate.error.message}</Alert> : null}
        {message ? <Alert color="green" role="status">{message}</Alert> : null}
        <Paper p="lg" radius={24} className={surface.card} style={{ '--i': 1 } as CSSProperties}>
          <Stack>
            <Title order={3}>대상자 계정 연결</Title>
            <Select label="조회·업로드할 대상자" searchable value={pilot?.beneficiary_fc_id ?? recipientId}
              disabled={mutate.isPending} data={(query.data?.recipients ?? []).map((item) => ({ value: item.beneficiary_fc_id, label: `${item.name} · ${item.employee_code}` }))}
              onChange={(value) => { setRecipientId(value); setSelectedImportId(null); setFile(null); setReviewConfirmed(false); setSourceConfirmed(false); setMappingConfirmed(false); }} />
            {pilot ? <Group justify="space-between"><Text fw={600}>{pilot.name} · 원본 사번 {pilot.employee_code}</Text><Badge color={pilot.enabled ? 'green' : 'gray'}>{pilot.enabled ? '사용 중' : '중지됨'}</Badge></Group> : query.data ? <Text c="dimmed">연결된 계정이 없습니다. 계정과 원본 파일의 사번을 확인해주세요.</Text> : <Text c="dimmed">연결된 계정을 확인 중이거나 조회에 실패했습니다.</Text>}
            <Text size="sm" c="dimmed">이름은 계정을 찾는 용도로만 사용합니다. 연결할 계정과 원본 사번이 같은 사람인지 확인해주세요. 연결 설정을 저장하면 기존 게시 자료는 다시 검토·게시해야 합니다.</Text>
            <TextInput label="FC·본부장 계정 검색" placeholder="이름 2글자 이상" value={search} onChange={(event) => { setSearch(event.currentTarget.value); setCandidateId(null); setMappingConfirmed(false); }} autoComplete="off" />
            <Select label="연결할 계정" placeholder={candidates.isFetching ? '계정 검색 중' : '검색한 계정을 선택해주세요'}
              data={(candidates.data?.candidates ?? []).map((candidate) => ({ value: candidate.beneficiaryFcId, label: `${candidate.name}${candidate.affiliation ? ` · ${candidate.affiliation}` : ''}` }))}
              value={candidateId} onChange={(value) => { setCandidateId(value); setMappingConfirmed(false); }} nothingFoundMessage="연결 가능한 계정이 없습니다" />
            {candidates.error ? <Text c="red" size="sm">계정 검색에 실패했습니다. 다시 검색해주세요.</Text> : null}
            <TextInput label="원본 파일의 사번" description="추천코드나 임시사번이 아닌, 월별 엑셀의 사번입니다." value={employeeCode} onChange={(event) => { setEmployeeCode(event.currentTarget.value); setMappingConfirmed(false); }} autoComplete="off" />
            <Checkbox label="선택한 계정과 원본 사번이 같은 사람임을 확인했습니다." checked={mappingConfirmed} onChange={(event) => setMappingConfirmed(event.currentTarget.checked)} />
            <Group>
              <Button color="dark" radius="xl" disabled={!selected || !employeeCode.trim() || !mappingConfirmed || !query.data} loading={mutate.isPending}
                onClick={() => selected && mutate.mutate({ action: 'configure', managerAccountId: selected.managerAccountId, beneficiaryFcId: selected.beneficiaryFcId, employeeCode: employeeCode.trim(), enabled: true, expectedRevision: selectedRevision, mappingConfirmed: true })}>대상자 등록·갱신</Button>
              {pilot?.enabled ? <Button variant="default" loading={mutate.isPending} onClick={() => mutate.mutate({ action: 'configure', managerAccountId: pilot.manager_account_id, beneficiaryFcId: pilot.beneficiary_fc_id, employeeCode: pilot.employee_code, enabled: false, expectedRevision: pilot.revision, mappingConfirmed: true })}>이 대상자 조회 중지</Button> : null}
            </Group>
          </Stack>
        </Paper>
        <Paper p="lg" radius={24} className={surface.card} style={{ '--i': 2 } as CSSProperties}>
          <Stack>
            <Group justify="space-between"><Title order={3}>월별 엑셀 업로드</Title><Button component="a" href={`${API}/template`} variant="subtle">입력 양식 내려받기</Button></Group>
            <Text size="sm" c="dimmed">월별 산정자료 양식 또는 ‘FP 기초산정’과 ‘계보 매핑’이 포함된 계보10단계 재계산 파일을 지원합니다. 납기별 보험료를 그대로 넣지 말고, 검토된 최종 대상업적을 입력해주세요.</Text>
            <Group grow align="flex-start">
              <TextInput type="month" label="업적월" value={month} onChange={(event) => { setMonth(event.currentTarget.value); setSourceConfirmed(false); }} />
              <TextInput type="date" label="실제 지급일" value={paymentDate} onChange={(event) => { setPaymentDate(event.currentTarget.value); setSourceConfirmed(false); }} />
              <TextInput type="date" label="계보 기준일" value={genealogyAsOf} onChange={(event) => { setGenealogyAsOf(event.currentTarget.value); setSourceConfirmed(false); }} />
              <TextInput type="date" label="인사 원본 기준일" value={personnelSourceDate} onChange={(event) => { setPersonnelSourceDate(event.currentTarget.value); setSourceConfirmed(false); }} />
            </Group>
            <FileInput label="산정자료 엑셀" placeholder=".xlsx 파일 선택 (최대 8MB)" accept=".xlsx" value={file} onChange={(value) => { setFile(value); setSourceConfirmed(false); }} clearable />
            <Checkbox label="업적월과 실제 지급일을 확인했고, 업로드한 계보 기준 재적·직급·계보가 반영된 자료입니다." checked={sourceConfirmed} onChange={(event) => setSourceConfirmed(event.currentTarget.checked)} />
            <Group><Button color="dark" radius="xl" onClick={upload} loading={mutate.isPending} disabled={!pilot?.enabled || !file || !month || !paymentDate || !genealogyAsOf || !personnelSourceDate || !sourceConfirmed || !query.data}>검증하고 검토 자료 저장</Button><Text size="sm" c="dimmed">업로드만으로 앱에 게시되지 않습니다.</Text></Group>
          </Stack>
        </Paper>
        <Paper p="lg" radius={24} className={surface.card} style={{ '--i': 3 } as CSSProperties}>
          <Stack>
            <Title order={3}>검토 및 앱 게시</Title>
            {!query.data ? <Text c="dimmed">검토 자료를 확인하지 못했습니다.</Text> : !query.data.imports.length ? <Text c="dimmed">아직 검토할 자료가 없습니다. 먼저 월별 엑셀을 업로드해주세요.</Text> : (
              <Table.ScrollContainer minWidth={600}><Table className={surface.table}><Table.Thead><Table.Tr><Table.Th>업적월</Table.Th><Table.Th>지급일</Table.Th><Table.Th>신규 지급예정</Table.Th><Table.Th>상태</Table.Th><Table.Th>검토</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>{query.data!.imports.map((row) => <Table.Tr key={row.id}><Table.Td>{row.performance_month}</Table.Td><Table.Td>{row.payment_date}</Table.Td><Table.Td>{row.summary ? krw(row.summary.newPaymentKrw) : '확인 필요'}</Table.Td><Table.Td>{statusLabel[row.status]}</Table.Td><Table.Td><Button size="compact-sm" variant="subtle" onClick={() => { setSelectedImportId(row.id); setReviewConfirmed(false); }}>내역 보기</Button></Table.Td></Table.Tr>)}</Table.Tbody>
              </Table></Table.ScrollContainer>
            )}
            {detail.isFetching ? <Loader aria-label="산정 상세 조회 중" /> : null}
            {detail.error ? <QueryErrorAlert error={detail.error} onRetry={detail.refetch} isFetching={detail.isFetching} hasData={Boolean(detail.data)} subject="산정 상세" /> : null}
            {statement && reviewed ? <>
              <Divider /><Title order={4}>{statement.performanceMonth} · {statement.beneficiary.name} 산정 내역</Title>
              <Group gap="xl"><Text>당월 합계 <b>{krw(statement.summary.currentMonthNetKrw)}</b></Text><Text>신규 지급예정 <b>{krw(statement.summary.newPaymentKrw)}</b></Text><Text>다음달 이월 <b>{krw(statement.summary.carryForwardKrw)}</b></Text><Text>소액 음수 소멸 <b>{krw(statement.summary.extinguishedKrw)}</b></Text></Group>
              {!statement.beneficiary.eligibleAtBasisDate ? <Alert color="orange">기준일 재적·FP 직급 조건을 충족하지 않아 지급 대상에서 제외됐습니다.</Alert> : null}
              <Text size="sm" c="dimmed">기여 인원 {statement.validation.contributorCount}명 · 계보 기준일 {statement.genealogyAsOf} · 전월 이월금 미포함</Text>
              <Text size="sm" c="dimmed">계보·인사 원본 기준일: {statement.sourceSnapshotDates.join(', ')}</Text>
              {statement.usesLaterSnapshot ? <Alert color="orange">산정 기준일 이후에 작성된 계보가 포함된 시범 산정입니다. 과거 시점의 확정 내역이 아닙니다.</Alert> : null}
              <Table.ScrollContainer minWidth={600} h={360}><Table stickyHeader className={surface.table}><Table.Thead><Table.Tr><Table.Th>기여자</Table.Th><Table.Th>단계</Table.Th><Table.Th>최종 대상업적</Table.Th><Table.Th>만원 절사액</Table.Th><Table.Th>귀속액</Table.Th></Table.Tr></Table.Thead><Table.Tbody>
                {statement.nodes.filter((node) => !node.isBeneficiary).map((node) => <Table.Tr key={node.id}><Table.Td>{node.name}</Table.Td><Table.Td>{node.depth}단계</Table.Td><Table.Td>{krw(node.finalTargetPerformanceKrw)}</Table.Td><Table.Td>{krw(node.fpRoundedAmountKrw)}</Table.Td><Table.Td>{krw(node.contributionKrw)}</Table.Td></Table.Tr>)}
              </Table.Tbody></Table></Table.ScrollContainer>
              {reviewed.status === 'draft' ? <><Checkbox label="원본 자료, 대상 계정, 업적월, 지급일, 계보와 산정 금액을 검토했습니다. 당월 신규 산정 내역으로 게시합니다." checked={reviewConfirmed} onChange={(event) => setReviewConfirmed(event.currentTarget.checked)} />
                <Group><Button color="dark" radius="xl" disabled={!reviewConfirmed || !pilot?.enabled} loading={mutate.isPending} onClick={() => mutate.mutate({ action: 'publish', importId: reviewed.id, sourceSha256: reviewed.source_sha256, expectedRevision: reviewed.revision, expectedPilotRevision: reviewed.pilot_revision, reviewConfirmed: true })}>지정 계정 앱에 게시</Button></Group></> : <Text c="dimmed">{statusLabel[reviewed.status]} · 수정하려면 검토한 엑셀을 다시 업로드해주세요.</Text>}
            </> : null}
          </Stack>
        </Paper>
      </Stack>
    </div>
  );
}
