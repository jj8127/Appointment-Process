import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdminRoute } from '@/lib/admin-route-auth';
import { adminSupabase } from '@/lib/admin-supabase';
import { ALLOWANCE_IMPORT_COLUMNS, allowanceAdminId, findAllowanceCandidates, getAllowancePilot, listAllowanceRecipients } from '@/lib/referral-allowance-admin';
import { ALLOWANCE_MAX_FILE_BYTES, AllowanceWorkbookError, parseAllowanceWorkbook } from '@/lib/referral-allowance-workbook';
import { calculateReferralAllowance } from '@shared/lib/referral-allowance-calculation';
import { REFERRAL_ALLOWANCE_POLICY_VERSION } from '@shared/types/referral-allowance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
const uuid = z.uuid();
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('configure'), managerAccountId: uuid.nullable(), beneficiaryFcId: uuid,
    employeeCode: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), enabled: z.boolean(), expectedRevision: revision,
    mappingConfirmed: z.literal(true) }).strict(),
  z.object({ action: z.literal('publish'), importId: uuid, sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    expectedRevision: revision, expectedPilotRevision: revision, reviewConfirmed: z.literal(true) }).strict(),
]);

async function readBoundedBody(request: Request, limit: number) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw new AllowanceWorkbookError('업로드 용량이 한도를 초과했습니다.');
  const reader = request.body?.getReader();
  if (!reader) throw new AllowanceWorkbookError('요청 내용이 없습니다.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new AllowanceWorkbookError('업로드 용량이 한도를 초과했습니다.'); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}

export async function GET(request: Request) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return reply({ error: '관리자 로그인이 필요합니다.' }, auth.status);
  try {
    const url = new URL(request.url);
    const search = url.searchParams.get('search');
    if (search !== null) return reply({ ok: true, candidates: await findAllowanceCandidates(search.slice(0, 80)) });
    const recipients = await listAllowanceRecipients();
    const selectedId = url.searchParams.get('beneficiaryFcId');
    if (selectedId && !uuid.safeParse(selectedId).success) return reply({ error: '조회할 대상자를 다시 선택해주세요.' }, 400);
    const pilot = selectedId ? recipients.find((item) => item.beneficiary_fc_id === selectedId) : recipients[0];
    if (!pilot) return reply({ ok: true, recipients, pilot: null, imports: [] });
    let query = adminSupabase.from('referral_allowance_imports').select(ALLOWANCE_IMPORT_COLUMNS)
      .eq('beneficiary_fc_id', pilot.beneficiary_fc_id)
      .eq('employee_code', pilot.employee_code).eq('pilot_revision', pilot.revision);
    const importId = url.searchParams.get('importId');
    if (importId) {
      if (!uuid.safeParse(importId).success) return reply({ error: '검토할 자료를 다시 선택해주세요.' }, 400);
      const { data, error } = await query.eq('id', importId).maybeSingle();
      if (error) throw new Error('import_unavailable');
      if (!data) return reply({ error: '선택한 대상자의 자료를 찾을 수 없습니다.' }, 404);
      return reply({ ok: true, import: data });
    }
    query = query.order('created_at', { ascending: false }).limit(36);
    const { data, error } = await query;
    if (error) throw new Error('imports_unavailable');
    return reply({ ok: true, recipients, pilot, imports: (data ?? []).map(({ snapshot, ...row }) => ({ ...row, summary: snapshot?.summary ?? null })) });
  } catch { return reply({ error: '증원수당 관리 기능을 준비 중입니다. 잠시 후 다시 시도해주세요.' }, 503); }
}

export async function POST(request: Request) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return reply({ error: '관리자 로그인이 필요합니다.' }, auth.status);
  // This endpoint is a browser form mutation; unlike generic legacy API helpers,
  // missing Origin is not accepted for a cookie-authenticated financial import.
  if (request.headers.get('origin') !== new URL(request.url).origin) return reply({ error: '요청 출처를 확인할 수 없습니다.' }, 403);
  try {
    const actor = await allowanceAdminId(auth.session);
    if (request.headers.get('content-type')?.startsWith('multipart/form-data')) {
      const bytes = await readBoundedBody(request, ALLOWANCE_MAX_FILE_BYTES + 64 * 1024);
      const form = await new Response(bytes, { headers: { 'content-type': request.headers.get('content-type')! } }).formData();
      const file = form.get('file');
      if (!(file instanceof File) || !/\.xlsx$/i.test(file.name)) throw new AllowanceWorkbookError('.xlsx 파일을 선택해주세요.');
      if (form.get('sourceConfirmed') !== 'true') throw new AllowanceWorkbookError('업적월·지급일·원본 계보를 확인해주세요.');
      const beneficiaryFcId = String(form.get('beneficiaryFcId') ?? '');
      if (!uuid.safeParse(beneficiaryFcId).success) throw new AllowanceWorkbookError('업로드할 대상자를 선택해주세요.');
      const pilot = await getAllowancePilot(beneficiaryFcId);
      const expectedPilotRevision = Number(form.get('expectedPilotRevision'));
      if (!pilot?.enabled || !Number.isSafeInteger(expectedPilotRevision) || pilot.revision !== expectedPilotRevision) return reply({ error: '대상자 설정이 변경되었습니다. 새로고침 후 다시 업로드해주세요.' }, 409);
      const metadata = { performanceMonth: String(form.get('performanceMonth') ?? ''), paymentDate: String(form.get('paymentDate') ?? ''),
        genealogyAsOf: String(form.get('genealogyAsOf') ?? ''), personnelSourceDate: String(form.get('personnelSourceDate') ?? ''), beneficiaryEmployeeCode: pilot.employee_code };
      const workbook = Buffer.from(await file.arrayBuffer());
      const input = await parseAllowanceWorkbook(workbook, metadata);
      let snapshot;
      try { snapshot = calculateReferralAllowance(input); } catch { throw new AllowanceWorkbookError('산정자료의 계보·날짜·사번·금액 또는 재적 조건을 확인해주세요. 누락·중복·순환 관계가 있으면 게시할 수 없습니다.'); }
      const sourceHash = createHash('sha256').update(workbook).update(JSON.stringify(metadata)).update(REFERRAL_ALLOWANCE_POLICY_VERSION).digest('hex');
      const { data, error } = await adminSupabase.rpc('create_referral_allowance_draft', {
        p_actor_admin_id: actor, p_expected_pilot_revision: pilot.revision, p_expected_manager_account_id: pilot.manager_account_id,
        p_expected_beneficiary_fc_id: pilot.beneficiary_fc_id, p_expected_employee_code: pilot.employee_code,
        p_performance_month: snapshot.performanceMonth, p_payment_date: snapshot.paymentDate, p_genealogy_as_of: snapshot.genealogyAsOf,
        p_source_sha256: sourceHash, p_policy_version: snapshot.policyVersion, p_snapshot: snapshot,
      });
      if (error) return reply({ error: '자료를 저장하지 못했습니다. 계정 설정과 업로드 내역을 새로고침해주세요.' }, 409);
      return reply(data);
    }
    const bytes = await readBoundedBody(request, 16 * 1024);
    const parsed = actionSchema.safeParse(JSON.parse(bytes.toString('utf8')));
    if (!parsed.success) return reply({ error: '필수 확인 항목과 요청 값을 확인해주세요.' }, 400);
    const body = parsed.data;
    if (body.action === 'configure') {
      const { data, error } = await adminSupabase.rpc('configure_referral_allowance_pilot', {
        p_actor_admin_id: actor, p_manager_account_id: body.managerAccountId, p_beneficiary_fc_id: body.beneficiaryFcId,
        p_employee_code: body.employeeCode, p_enabled: body.enabled, p_expected_revision: body.expectedRevision,
      });
      if (error) return reply({ error: '계정 연결을 저장하지 못했습니다. 대상 계정과 최신 설정을 확인해주세요.' }, 409);
      return reply(data);
    }
    const { data, error } = await adminSupabase.rpc('publish_referral_allowance_draft', {
      p_actor_admin_id: actor, p_import_id: body.importId, p_expected_source_sha256: body.sourceSha256,
      p_expected_revision: body.expectedRevision, p_expected_pilot_revision: body.expectedPilotRevision,
    });
    if (error) return reply({ error: '게시할 자료 또는 계정 설정이 변경되었습니다. 최신 자료를 다시 검토해주세요.' }, 409);
    return reply(data);
  } catch (error) {
    if (error instanceof AllowanceWorkbookError) return reply({ error: error.message }, 400);
    return reply({ error: '요청을 처리하지 못했습니다. 입력과 관리자 로그인을 확인해주세요.' }, 400);
  }
}
