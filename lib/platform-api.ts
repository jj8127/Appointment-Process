import { supabase } from './supabase';
import { z } from 'zod';
import type { LoginResponse } from '@/hooks/use-login';
import { parseSignupReferralSearchResponse } from '@/lib/referral-read-response';

export const PLATFORM_SERVICES = { insurance: '보험', care: '가족간병', telecom: '통신', rental: '렌탈', car: '자동차', hospital: '제휴병원' } as const;
export type PlatformService = keyof typeof PLATFORM_SERVICES;
export type ApplicationService = Exclude<PlatformService, 'hospital'>;
export const PLATFORM_TERMS_VERSION = '2026-10-12';
export const INSURANCE_CONSENT_VERSION = 'insurance-additional-info-v1';
export const PLATFORM_WITHDRAWAL_VERSION = '2026-10-14';
export const PLATFORM_REQUEST_TIMEOUT_MS = 12_000;
const timeoutActions = new Set(['request_otp','signup','login','request_password_reset','reset_password','enroll_insurance','withdraw_member','get_withdrawal']);
export const PLATFORM_PRIVACY_POLICY_URL = 'https://garam-public-web.vercel.app/moduon-privacy/';
/** Release copy under review; keep signup and existing-member consent identical.
 * 2026-10-14: referral wording now describes per-service referrers without a
 * version bump; the operator confirmed every member consented in writing. */
export const PLATFORM_CONSENT_TEXT = '수집 항목: 이름, 휴대폰 번호, 비밀번호 해시, 필수 동의 일시와 문서 버전, 제휴 서비스별 추천 코드와 추천 관계\n이용 목적: 회원 확인, 휴대폰 인증, 로그인과 계정 복구, 제휴 서비스별 추천 관계 연결\n보유기간: 회원 이용 기간 동안 보관합니다. 공통 회원 탈퇴 시 공통 회원과 연결된 일반 회원·보험 FC·가람링크 계정의 개인정보·로그인 정보와 인증 기록을 삭제하고 접속을 종료합니다. 관리자·본부장 등 회사 업무 계정은 유지됩니다. 이미 확정된 거래·정산 기록과 거래·정산 및 추천 관계를 연결하는 식별자는 정산 확인을 위해 유지합니다. 탈퇴한 계정의 자동 재가입과 계정 복원을 방지하기 위한 연결 UUID와 탈퇴 여부는 이름·휴대폰 번호 없이 접근을 제한해 유지합니다.\n비밀번호 원문은 보관하지 않습니다. 이 동의에는 마케팅 수신 동의가 포함되지 않습니다.\n동의를 거부할 수 있으며, 거부하면 공통 회원가입과 제휴 서비스별 추천 혜택 이용이 제한됩니다. 가입 동의 거부와 기존 서비스 계정 탈퇴는 서로 다르며 공개 서비스 안내는 계속 이용할 수 있습니다.\n탈퇴 방법: 내 정보에서 공통 회원 탈퇴를 선택하고 제휴 계정까지 삭제되는 범위를 확인합니다. 모든 대상 계정과 첨부자료 정리가 확인돼야 완료됩니다. 연결 확인이나 정리가 남아 있으면 처리 중으로 안내합니다. 외부 제휴사에 별도로 가입한 계정은 해당 회사의 탈퇴 절차를 따릅니다.';
export type PlatformAuthResponse = { ok: true; insuranceSession: LoginResponse } | { ok: true; memberId: string; displayName: string; residentId: string; appSessionToken: string; role: 'member'; insuranceSession?: undefined };
export type PlatformInsuranceEnrollment = { ok: true; insuranceSession: LoginResponse; alreadyApplied: boolean };
export type PlatformWithdrawal = { ok: true; operationId: string; preservedCompanyAccount?: 'admin' | 'manager' | 'designer' | 'developer' } & (
  { status: 'completed'; deleted: true; cleanupPending: false }
  | { status: 'pending'; deleted: false; cleanupPending: true; reason?: 'affiliate_identity_unbound' | 'affiliate_unavailable' | 'cleanup_pending' }
);
export type ReferralService = 'care';
export type PlatformServiceReferral = { ok: true; serviceKey: ReferralService; code: string | null;
  referrer: { name: string; source: 'invite_signup' | 'invite_confirmed' | 'manual'; createdAt: string } | null };
export type PlatformServiceReferralPreview = { ok: true; serviceKey: ReferralService; referrerName: string };
export type PlatformServiceReferralBinding = { ok: true; serviceKey: ReferralService; alreadyBound: boolean };
export type PlatformApplication = { id: string; serviceKey: ApplicationService; status: string; createdAt: string };
export type PlatformWithdrawalStatus = { ok: true; withdrawal: PlatformWithdrawal | null };
export type PlatformBenefit = { id: string; serviceKey: ApplicationService; amount: number; dueAt: string; status: string };
export type PlatformAccount = {
  ok: true;
  member: { id: string; name: string; referralCode: string; referrerId: string | null; createdAt: string; termsAccepted: boolean; termsVersion: string | null;
    insuranceEnrolled?: boolean; insuranceConsentAccepted?: boolean };
  applications: PlatformApplication[];
  benefits: PlatformBenefit[];
};
export const HOSPITAL_PROVINCES = [
  { code: '11', name: '서울' }, { code: '26', name: '부산' }, { code: '27', name: '대구' },
  { code: '28', name: '인천' }, { code: '29', name: '광주' }, { code: '30', name: '대전' },
  { code: '31', name: '울산' }, { code: '36', name: '세종' }, { code: '41', name: '경기' },
  { code: '43', name: '충북' }, { code: '44', name: '충남' }, { code: '46', name: '전남' },
  { code: '47', name: '경북' }, { code: '48', name: '경남' }, { code: '50', name: '제주' },
  { code: '51', name: '강원' }, { code: '52', name: '전북' },
] as const;
export const HOSPITAL_DIRECTORY_SPECIALTIES = [
  '한방병원', '정형외과', '안과', '치과', '성형외과', '건강검진센터',
] as const;
export const HOSPITAL_DEMO_ENABLED = process.env.EXPO_PUBLIC_HOSPITAL_DEMO === 'true';
export type PlatformHospital = {
  id: string; name: string; region: string; provinceCode: string; provinceName: string; district: string;
  address: string | null; phone: string | null; websiteUrl: string | null; specialties: string[];
  description: string | null; photoUrl: string | null; openingHours: string | null; verifiedAt: string | null;
  adPlacement: 'regional_list' | 'regional_featured'; revision: number; measurementToken: string;
};
export type PlatformHospitalRegions = { ok: true; regions: { provinceCode: string; provinceName: string; districts: string[] }[]; specialties: string[] };
export type PlatformHospitalList = { ok: true; hospitals: PlatformHospital[]; featured: PlatformHospital[]; hasMore: boolean; nextOffset: number | null };
export type PlatformHospitalReport = {
  ok: true; from: string; to: string; measurement: 'anonymous_client_events';
  rows: ({ partnerId: string; name: string; revision: number; placement: PlatformHospital['adPlacement']; date: string } & HospitalMetrics)[];
  totals: HospitalMetrics;
};
type HospitalMetrics = { impressions: number; detailViews: number; phoneClicks: number; directionsClicks: number };

export class PlatformApiError extends Error {
  constructor(message: string, public readonly code: string, public readonly status?: number,
    public readonly loginRejection?: Pick<LoginResponse, 'role' | 'passwordChangeToken' | 'passwordChangeExpiresAt'>) { super(message); }
}

const accountSchema = z.object({
  ok: z.literal(true),
  member: z.object({ id: z.uuid(), name: z.string(), referralCode: z.string(), referrerId: z.uuid().nullable(), createdAt: z.string(), termsAccepted: z.boolean(), termsVersion: z.string().nullable(),
    insuranceEnrolled: z.boolean().optional(), insuranceConsentAccepted: z.boolean().optional() }),
  applications: z.array(z.object({ id: z.uuid(), serviceKey: z.enum(['insurance', 'care', 'telecom', 'rental', 'car']), status: z.enum(['interest', 'settled', 'cancelled']), createdAt: z.string() })),
  benefits: z.array(z.object({ id: z.uuid(), serviceKey: z.enum(['care', 'telecom', 'rental', 'car']), amount: z.number().int().nonnegative().safe(), status: z.enum(['pending', 'paid']), dueAt: z.string() })),
});
const insuranceSessionSchema = z.object({ ok: z.literal(true), role: z.enum(['fc', 'admin', 'manager']), residentId: z.string().regex(/^\d{11}$/), appSessionToken: z.string().min(1) });
const authSchema = z.union([
  z.object({ ok: z.literal(true), insuranceSession: insuranceSessionSchema }),
  z.object({ ok: z.literal(true), memberId: z.uuid(), displayName: z.string().min(1), residentId: z.string().regex(/^\d{11}$/), appSessionToken: z.string().min(1), role: z.literal('member'), insuranceSession: z.undefined().optional() }),
]);
const enrollmentSchema = z.object({ ok: z.literal(true), insuranceSession: insuranceSessionSchema, alreadyApplied: z.boolean() });
const withdrawalSchema = z.object({
  ok: z.literal(true), operationId: z.uuid(), preservedCompanyAccount: z.enum(['admin', 'manager', 'designer', 'developer']).optional(),
}).and(z.discriminatedUnion('status', [
  z.object({ status: z.literal('completed'), deleted: z.literal(true), cleanupPending: z.literal(false) }),
  z.object({ status: z.literal('pending'), deleted: z.literal(false), cleanupPending: z.literal(true),
    reason: z.enum(['affiliate_identity_unbound', 'affiliate_unavailable', 'cleanup_pending']).optional() }),
]));
const serviceReferralSchema = z.object({ ok: z.literal(true), serviceKey: z.literal('care'), code: z.string().regex(/^S[0-9A-F]{11}$/).nullable(),
  referrer: z.object({ name: z.string().min(1), source: z.enum(['invite_signup', 'invite_confirmed', 'manual']), createdAt: z.string() }).nullable() });
const serviceReferralPreviewSchema = z.object({ ok: z.literal(true), serviceKey: z.literal('care'), referrerName: z.string().min(1) });
const serviceReferralBindingSchema = z.object({ ok: z.literal(true), serviceKey: z.literal('care'), alreadyBound: z.boolean() });
const insuranceReferralSchema = z.object({ ok: z.literal(true), inviterFcId: z.uuid(), inviterName: z.string().min(1),
  inviterAffiliation: z.string(), referralCode: z.string().min(1) });
const hospitalSchema = z.object({
  id: z.uuid(), name: z.string().min(1), region: z.string(), provinceCode: z.string(), provinceName: z.string(), district: z.string(),
  address: z.string().nullable(), phone: z.string().nullable(), websiteUrl: z.string().nullable(), specialties: z.array(z.string()),
  description: z.string().nullable(), photoUrl: z.string().nullable(), openingHours: z.string().nullable(), verifiedAt: z.iso.date().nullable(),
  adPlacement: z.enum(['regional_list', 'regional_featured']), revision: z.number().int().nonnegative().safe(), measurementToken: z.string().min(1),
});
const metricSchema = z.object({ impressions: z.number().int().nonnegative().safe(), detailViews: z.number().int().nonnegative().safe(), phoneClicks: z.number().int().nonnegative().safe(), directionsClicks: z.number().int().nonnegative().safe() });
const hospitalResponseSchemas = {
  get_hospital_regions: z.object({ ok: z.literal(true), regions: z.array(z.object({ provinceCode: z.string(), provinceName: z.string(), districts: z.array(z.string()) })), specialties: z.array(z.string()) }),
  list_hospitals: z.object({ ok: z.literal(true), hospitals: z.array(hospitalSchema), featured: z.array(hospitalSchema), hasMore: z.boolean(), nextOffset: z.number().int().nonnegative().safe().nullable() }),
  get_hospital: z.object({ ok: z.literal(true), hospital: hospitalSchema }),
  get_hospital_report: z.object({ ok: z.literal(true), from: z.iso.date(), to: z.iso.date(), measurement: z.literal('anonymous_client_events'), rows: z.array(metricSchema.extend({ partnerId: z.uuid(), name: z.string(), revision: z.number().int().nonnegative().safe(), placement: z.enum(['regional_list', 'regional_featured']), date: z.iso.date() })), totals: metricSchema }),
};

const messages: Record<string, string> = {
  invalid_app_session: '로그인이 만료되었습니다. 다시 로그인해 주세요.',
  already_exists: '이미 가입된 번호입니다. 로그인해 주세요.',
  invalid_password: '휴대폰 번호와 비밀번호를 확인해 주세요.',
  password_change_required: '임시 비밀번호를 변경해야 합니다. 새 비밀번호를 설정해 주세요.',
  needs_password_setup: '비밀번호를 먼저 설정해 주세요.',
  not_completed: '공통 회원가입을 완료한 뒤 보험 업무에 필요한 정보를 등록해 주세요.',
  // Relayed login-with-password rejections; unmapped 401s would read as an expired session.
  not_found: '가입되지 않은 번호입니다. 모두온 회원가입을 먼저 진행해 주세요.',
  inactive_admin: '사용이 중지된 계정입니다. 관리자에게 문의해 주세요.',
  inactive_manager: '사용이 중지된 계정입니다. 관리자에게 문의해 주세요.',
  missing_password: '비밀번호를 입력해 주세요.',
  login_unavailable: '로그인을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  insurance_consent_required: '보험 업무에 필요한 추가 정보와 개인정보 수집·이용 동의를 확인해 주세요.',
  already_enrolled: '이미 등록한 보험 계정입니다. 다시 로그인해 주세요.',
  invalid_details: '소속·이메일·통신사와 자격 정보를 확인해 주세요.',
  referral_invalid: '보험 추천인을 다시 확인해 주세요.',
  invalid_referral_code: '보험 추천 코드를 다시 확인해 주세요.',
  idempotency_conflict: '이미 처리한 등록 요청입니다. 내 정보를 다시 확인해 주세요.',
  invalid_code: '인증번호를 확인해 주세요.',
  expired_code: '인증번호가 만료되었습니다. 새로 요청해 주세요.',
  invalid_referral: '추천 코드를 확인해 주세요.',
  referral_already_bound: '이미 등록된 가족간병 추천인은 앱에서 바꿀 수 없어요.',
  cooldown: '인증번호를 보낸 뒤 60초가 지나면 다시 요청할 수 있습니다.',
  locked: '여러 번 틀려 잠시 잠겼습니다. 10분 뒤 다시 시도해 주세요.',
  session_verification_unavailable: '로그인 확인 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  sms_send_failed: '문자를 보내지 못했습니다. 잠시 후 다시 요청해 주세요.',
  sms_delivery_unknown: '문자 접수 상태를 확인하지 못했습니다. 문자가 오면 인증번호를 입력해 주세요.',
  request_timeout: '응답이 늦어 요청을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  request_failed: '요청을 처리하지 못했습니다. 입력 내용을 유지한 채 다시 시도해 주세요.',
  server_misconfigured: '문자 발송 설정을 확인하고 있습니다. 잠시 후 다시 시도해 주세요.',
  invalid_partner: '제휴 정보와 광고 기간·노출 위치·광고비를 확인해 주세요.',
  hospital_not_found: '현재 게시 중인 병원 정보가 없습니다. 병원 목록에서 다시 확인해 주세요.',
  invalid_measurement: '집계 가능한 시간이 지났습니다. 병원 정보를 다시 확인해 주세요.',
  report_range_too_large: '조회 기간을 줄이거나 특정 병원을 선택해 주세요.',
  revision_conflict: '다른 관리자가 수정했습니다. 최신 정보를 불러온 뒤 다시 저장해 주세요.',
  invalid_settlement: '거래와 정산 증빙·수수료 총액·완료 시각을 확인해 주세요.',
  invalid_session: '로그인이 만료되었습니다. 다시 로그인해 주세요.',
  expired_session: '로그인이 만료되었습니다. 다시 로그인해 주세요.',
  missing_session: '로그인 후 이용해 주세요.',
  forbidden: '이 계정으로 이용할 수 없는 기능입니다.',
  invalid_input: '입력한 항목을 확인해 주세요.',
  service_unavailable: '서비스 접수 준비 중입니다. 안내를 먼저 확인해 주세요.',
  invalid_credentials: '휴대폰 번호와 비밀번호를 확인해 주세요.',
  invalid_otp: '인증번호를 확인하거나 새로 요청해 주세요.',
  invalid_phone: '올바른 휴대폰 번호를 입력해 주세요.',
  consent_required: '공통 서비스 이용을 위한 개인정보 수집·이용 내용을 확인해 주세요.',
  enrollment_required: '공통 서비스 이용을 위한 개인정보 수집·이용 내용을 확인해 주세요.',
  common_membership_withdrawn: '공통 회원에서 탈퇴한 계정입니다. 다시 가입하려면 동의를 확인해 주세요.',
  invalid_terms: '최신 동의 내용을 확인한 뒤 다시 시도해 주세요.',
  account_not_found: '가입한 휴대폰 번호를 확인해 주세요.',
  upgrade_required: '탈퇴 정책이 변경되었습니다. 최신 앱에서 삭제 범위를 확인한 뒤 다시 진행해 주세요.',
  invalid_request: '비밀번호 변경 요청을 확인해주세요.',
  invalid_token: '인증 코드가 유효하지 않습니다.',
  expired_token: '인증 코드가 만료되었습니다. 새 코드를 요청해주세요.',
  attempts_exhausted: '인증 코드 확인 횟수를 초과했습니다. 새 코드를 요청해주세요.',
  account_unavailable: '비밀번호를 변경할 수 없는 계정입니다.',
  db_error: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.',
  rate_limited: '잠시 후 다시 시도해 주세요.',
  conflict: '이미 처리되었거나 내용이 변경되었습니다. 최신 내역을 확인해 주세요.',
};

/** Consumer tokens are sent only to this endpoint; FC APIs keep their existing transport. */
export async function platformRequest<T>(action: string, payload: Record<string, unknown> = {}, token?: string | null): Promise<T> {
  let response;
  if (HOSPITAL_DEMO_ENABLED && ['get_hospital_regions', 'list_hospitals', 'get_hospital', 'record_hospital_event'].includes(action)) {
    const { HOSPITAL_DEMO: hospitals } = await import('@/data/hospital-demo');
    if (action === 'get_hospital_regions') {
      response = { ok: true, regions: HOSPITAL_PROVINCES.map(({ code, name }) => ({
        provinceCode: code, provinceName: name, districts: [...new Set(hospitals.filter((hospital) => hospital.provinceCode === code).map((hospital) => hospital.district))],
      })), specialties: [...HOSPITAL_DIRECTORY_SPECIALTIES] };
    } else if (action === 'list_hospitals') {
      const search = typeof payload.search === 'string' ? payload.search.trim().toLowerCase() : '';
      const filtered = hospitals.filter((hospital) => (!payload.provinceCode || hospital.provinceCode === payload.provinceCode)
        && (!payload.district || hospital.district === payload.district) && (!payload.specialty || hospital.specialties.includes(String(payload.specialty)))
        && (!search || hospital.name.toLowerCase().includes(search)));
      const offset = typeof payload.offset === 'number' && Number.isInteger(payload.offset) && payload.offset >= 0 ? payload.offset : 0;
      const limit = typeof payload.limit === 'number' && Number.isInteger(payload.limit) && payload.limit > 0 ? Math.min(payload.limit, 50) : 20;
      const nextOffset = offset + limit < filtered.length ? offset + limit : null;
      response = { ok: true, hospitals: filtered.slice(offset, offset + limit).map((hospital) => ({ ...hospital, adPlacement: 'regional_list' })), featured: filtered.filter((hospital) => hospital.adPlacement === 'regional_featured').slice(0, 5), hasMore: nextOffset !== null, nextOffset };
    } else {
      const hospital = hospitals.find((item) => item.id === payload.hospitalId);
      if (!hospital) throw new PlatformApiError(messages.hospital_not_found, 'hospital_not_found', 404);
      response = action === 'get_hospital' ? { ok: true, hospital } : { ok: true };
    }
  } else {
    const invokeOptions: Parameters<typeof supabase.functions.invoke>[1] = {
      body: { ...payload, action },
      headers: token ? { 'x-app-session-token': token } : undefined,
      ...(timeoutActions.has(action) ? { timeout: PLATFORM_REQUEST_TIMEOUT_MS } : {}),
    };
    const { data, error } = await supabase.functions.invoke('platform-service', invokeOptions);
    response = data;
    const status = error?.context instanceof Response ? error.context.status : undefined;
    if (error?.context instanceof Response) {
      try { response = await error.context.clone().json(); } catch { /* Transport errors have no JSON body. */ }
    }
    if (error || response?.ok !== true) {
      const wrappedContext = error && typeof error === 'object' && 'context' in error && error.context
        && typeof error.context === 'object' && !(error.context instanceof Response)
        ? error.context as { name?: unknown; message?: unknown }
        : null;
      const timedOut = Boolean(error && /(?:abort|timed?\s*out|timeout)/i.test([
        typeof error.name === 'string' ? error.name : '',
        typeof error.message === 'string' ? error.message : '',
        typeof wrappedContext?.name === 'string' ? wrappedContext.name : '',
        typeof wrappedContext?.message === 'string' ? wrappedContext.message : '',
      ].join(' ')));
      const code = typeof response?.code === 'string' ? response.code : timedOut ? 'request_timeout' : 'unavailable';
      const loginRejection = action === 'login' ? {
        ...(['fc', 'admin', 'manager'].includes(response?.role) ? { role: response.role as LoginResponse['role'] } : {}),
        ...(typeof response?.passwordChangeToken === 'string' ? { passwordChangeToken: response.passwordChangeToken } : {}),
        ...(typeof response?.passwordChangeExpiresAt === 'string' ? { passwordChangeExpiresAt: response.passwordChangeExpiresAt } : {}),
      } : undefined;
      const message = action === 'enroll_insurance' && ['consent_required', 'invalid_terms'].includes(code)
        ? messages.insurance_consent_required : messages[code];
      throw new PlatformApiError(message ?? (status === 401 ? messages.invalid_session : '연결하지 못했습니다. 입력 내용을 유지한 채 다시 시도해 주세요.'), code, status, loginRejection);
    }
  }
  if (action === 'search_insurance_referral') {
    try { parseSignupReferralSearchResponse(response); }
    catch { throw new PlatformApiError('추천 조회 응답을 확인하지 못했습니다. 다시 시도해 주세요.', 'invalid_response'); }
  }
  const schema = action === 'get_account' || action === 'verify' ? accountSchema
    : action === 'login' || action === 'signup' ? authSchema
      : action === 'enroll_insurance' ? enrollmentSchema
        : action === 'withdraw_member' ? withdrawalSchema
          : action === 'get_withdrawal' ? z.object({ ok: z.literal(true), withdrawal: withdrawalSchema.nullable() })
          : action === 'validate_insurance_referral' ? insuranceReferralSchema
          : action === 'get_service_referral' ? serviceReferralSchema
          : action === 'preview_service_referral' ? serviceReferralPreviewSchema
          : action === 'bind_service_referral' ? serviceReferralBindingSchema
          : hospitalResponseSchemas[action as keyof typeof hospitalResponseSchemas];
  if (schema && !schema.safeParse(response).success) throw new PlatformApiError('응답을 확인하지 못했습니다. 기존 내용을 유지한 채 다시 확인해 주세요.', 'invalid_response');
  if (action === 'withdraw_member' && response.operationId.toLowerCase() !== String(payload.idempotencyKey).toLowerCase()) {
    throw new PlatformApiError('탈퇴 처리 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.', 'invalid_response');
  }
  return response as T;
}
