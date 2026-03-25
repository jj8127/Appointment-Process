import 'server-only';

import type { VerifiedServerSession } from '@/lib/server-session';
import type {
  ReferralAdminCodeHistoryItem,
  ReferralAdminDetail,
  ReferralAdminEventItem,
  ReferralAdminListItem,
  ReferralAdminSummary,
} from '@/types/referrals';
import { adminSupabase } from '@/lib/admin-supabase';
import { logger } from '@/lib/logger';

const CODE_EVENT_TYPES = ['code_generated', 'code_rotated', 'code_disabled'] as const;
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_BACKFILL_LIMIT = 100;

type CodeEventType = (typeof CODE_EVENT_TYPES)[number];

type EligibleProfileRow = {
  id: string;
  name: string;
  phone: string | null;
  affiliation: string | null;
  signup_completed: boolean | null;
};

type StaffPhoneRow = {
  phone: string | null;
};

type ReferralCodeRow = {
  id: string;
  fc_id: string;
  code: string;
  is_active: boolean;
  created_at: string;
  disabled_at: string | null;
};

type ReferralEventRow = {
  id: string;
  inviter_fc_id: string | null;
  referral_code: string | null;
  event_type: CodeEventType;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type ReferralCodeMutationResult = Record<string, unknown> & {
  changed?: boolean;
};

type AdminActorContext = {
  actorPhone: string;
  actorRole: 'admin';
  actorStaffType: 'admin' | 'developer';
};

type ReferralAdminPermissions = {
  canMutate: boolean;
};

type ReferralAdminData = {
  summary: ReferralAdminSummary;
  items: ReferralAdminListItem[];
  detail: ReferralAdminDetail | null;
  permissions: ReferralAdminPermissions;
  page: number;
  pageSize: number;
  total: number;
};

const DB_ERROR_MESSAGE_MAP = new Map<string, string>([
  ['fc_id is required', '추천코드 대상 FC를 찾을 수 없습니다.'],
  ['FC profile not found', '추천코드 대상 FC를 찾을 수 없습니다.'],
  ['Referral code can only be issued to completed FC profiles', '가입 완료된 FC만 추천코드를 발급할 수 있습니다.'],
  ['Referral code requires normalized 11-digit FC phone', '전화번호가 정규화된 11자리인 FC만 추천코드를 발급할 수 있습니다.'],
  ['Request-board linked designer profiles cannot receive referral codes', '설계매니저 계정에는 추천코드를 발급할 수 없습니다.'],
  ['Admin accounts cannot receive referral codes', '운영 계정에는 추천코드를 발급할 수 없습니다.'],
  ['Manager accounts cannot receive referral codes', '본부장 계정에는 추천코드를 발급할 수 없습니다.'],
  ['Active referral code not found', '활성 추천코드가 없습니다.'],
  ['Failed to generate unique referral code after 10 attempts', '추천코드 생성 시 충돌이 반복되어 중단되었습니다.'],
]);

function normalizeDigits(value?: string | null) {
  return String(value ?? '').replace(/[^0-9]/g, '');
}

function clampPositiveInteger(value: string | number | null | undefined, fallback: number, max: number) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(Math.max(Math.trunc(parsed), 1), max);
}

function normalizeRpcResult<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function normalizeDbErrorMessage(message: string) {
  return DB_ERROR_MESSAGE_MAP.get(message) ?? message;
}

function isEligibleProfile(profile: EligibleProfileRow) {
  return (
    profile.signup_completed === true &&
    /^\d{11}$/.test(normalizeDigits(profile.phone)) &&
    !String(profile.affiliation ?? '').includes('설계매니저')
  );
}

function buildSearchIndex(profile: EligibleProfileRow, activeCode: string | null) {
  return [
    profile.name ?? '',
    profile.phone ?? '',
    profile.affiliation ?? '',
    activeCode ?? '',
  ]
    .join(' ')
    .toLowerCase();
}

function toCodeHistoryItem(row: ReferralCodeRow): ReferralAdminCodeHistoryItem {
  return {
    id: row.id,
    code: row.code,
    isActive: row.is_active,
    createdAt: row.created_at,
    disabledAt: row.disabled_at,
  };
}

function toEventItem(row: ReferralEventRow): ReferralAdminEventItem {
  return {
    id: row.id,
    eventType: row.event_type,
    createdAt: row.created_at,
    referralCode: row.referral_code,
    metadata: row.metadata ?? {},
  };
}

async function fetchExcludedStaffPhones() {
  const [{ data: adminRows, error: adminError }, { data: managerRows, error: managerError }] = await Promise.all([
    adminSupabase.from('admin_accounts').select('phone'),
    adminSupabase.from('manager_accounts').select('phone'),
  ]);

  if (adminError) {
    throw adminError;
  }

  if (managerError) {
    throw managerError;
  }

  const excluded = new Set<string>();

  for (const row of [...((adminRows ?? []) as StaffPhoneRow[]), ...((managerRows ?? []) as StaffPhoneRow[])]) {
    const digits = normalizeDigits(row.phone);
    if (digits.length === 11) {
      excluded.add(digits);
    }
  }

  return excluded;
}

async function fetchEligibleProfiles() {
  const [{ data, error }, excludedStaffPhones] = await Promise.all([
    adminSupabase
      .from('fc_profiles')
      .select('id,name,phone,affiliation,signup_completed')
      .eq('signup_completed', true)
      .order('created_at', { ascending: false }),
    fetchExcludedStaffPhones(),
  ]);

  if (error) {
    throw error;
  }

  return ((data ?? []) as EligibleProfileRow[]).filter((profile) => {
    if (!isEligibleProfile(profile)) {
      return false;
    }

    return !excludedStaffPhones.has(normalizeDigits(profile.phone));
  });
}

async function fetchReferralCodes(fcIds: string[]) {
  if (fcIds.length === 0) {
    return [] as ReferralCodeRow[];
  }

  const { data, error } = await adminSupabase
    .from('referral_codes')
    .select('id,fc_id,code,is_active,created_at,disabled_at')
    .in('fc_id', fcIds)
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as ReferralCodeRow[];
}

async function fetchReferralEvents(fcIds: string[]) {
  if (fcIds.length === 0) {
    return [] as ReferralEventRow[];
  }

  const { data, error } = await adminSupabase
    .from('referral_events')
    .select('id,inviter_fc_id,referral_code,event_type,metadata,created_at')
    .in('inviter_fc_id', fcIds)
    .in('event_type', [...CODE_EVENT_TYPES])
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as ReferralEventRow[];
}

function buildCodeMaps(codes: ReferralCodeRow[]) {
  const activeCodeByFc = new Map<string, ReferralCodeRow>();
  const codeHistoryByFc = new Map<string, ReferralCodeRow[]>();

  for (const codeRow of codes) {
    const history = codeHistoryByFc.get(codeRow.fc_id) ?? [];
    history.push(codeRow);
    codeHistoryByFc.set(codeRow.fc_id, history);

    if (codeRow.is_active && !activeCodeByFc.has(codeRow.fc_id)) {
      activeCodeByFc.set(codeRow.fc_id, codeRow);
    }
  }

  return { activeCodeByFc, codeHistoryByFc };
}

function buildEventMaps(events: ReferralEventRow[]) {
  const eventsByFc = new Map<string, ReferralAdminEventItem[]>();
  const lastEventAtByFc = new Map<string, string>();

  for (const eventRow of events) {
    if (!eventRow.inviter_fc_id) {
      continue;
    }

    const nextEvent = toEventItem(eventRow);
    const history = eventsByFc.get(eventRow.inviter_fc_id) ?? [];
    history.push(nextEvent);
    eventsByFc.set(eventRow.inviter_fc_id, history);

    if (!lastEventAtByFc.has(eventRow.inviter_fc_id)) {
      lastEventAtByFc.set(eventRow.inviter_fc_id, eventRow.created_at);
    }
  }

  return { eventsByFc, lastEventAtByFc };
}

async function resolveAdminActorContext(session: VerifiedServerSession): Promise<AdminActorContext> {
  if (session.role !== 'admin') {
    throw new Error('추천코드 작업 권한이 없습니다.');
  }

  const { data, error } = await adminSupabase
    .from('admin_accounts')
    .select('staff_type')
    .eq('phone', session.residentDigits)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return {
    actorPhone: session.residentDigits,
    actorRole: 'admin',
    actorStaffType: data?.staff_type === 'developer' ? 'developer' : 'admin',
  };
}

function normalizeMutationResult(result: ReferralCodeMutationResult | null) {
  if (!result) {
    throw new Error('추천코드 작업 결과를 확인할 수 없습니다.');
  }

  return result;
}

export async function getReferralAdminData(
  session: VerifiedServerSession,
  params: {
    page?: string | null;
    pageSize?: string | null;
    search?: string | null;
    fcId?: string | null;
  },
): Promise<ReferralAdminData> {
  const page = clampPositiveInteger(params.page, DEFAULT_PAGE, Number.MAX_SAFE_INTEGER);
  const pageSize = clampPositiveInteger(params.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const search = String(params.search ?? '').trim();
  const requestedFcId = String(params.fcId ?? '').trim();

  const profiles = await fetchEligibleProfiles();
  const fcIds = profiles.map((profile) => profile.id);
  const [codes, events] = await Promise.all([
    fetchReferralCodes(fcIds),
    fetchReferralEvents(fcIds),
  ]);

  const { activeCodeByFc, codeHistoryByFc } = buildCodeMaps(codes);
  const { eventsByFc, lastEventAtByFc } = buildEventMaps(events);

  const summary: ReferralAdminSummary = {
    eligibleCount: profiles.length,
    activeCodeCount: profiles.filter((profile) => activeCodeByFc.has(profile.id)).length,
    missingCodeCount: profiles.filter((profile) => !activeCodeByFc.has(profile.id)).length,
    disabledCodeCount: codes.filter((code) => !code.is_active).length,
  };

  const normalizedSearch = search.toLowerCase();
  const filteredProfiles = normalizedSearch
    ? profiles.filter((profile) => {
        const activeCode = activeCodeByFc.get(profile.id)?.code ?? null;
        return buildSearchIndex(profile, activeCode).includes(normalizedSearch);
      })
    : profiles;

  const total = filteredProfiles.length;
  const start = Math.max(0, (page - 1) * pageSize);
  const items = filteredProfiles.slice(start, start + pageSize).map<ReferralAdminListItem>((profile) => {
    const activeCode = activeCodeByFc.get(profile.id) ?? null;
    const history = codeHistoryByFc.get(profile.id) ?? [];

    return {
      fcId: profile.id,
      name: profile.name,
      phone: profile.phone ?? '',
      affiliation: profile.affiliation ?? '',
      activeCode: activeCode?.code ?? null,
      activeCodeCreatedAt: activeCode?.created_at ?? null,
      disabledCodeCount: history.filter((row) => !row.is_active).length,
      lastEventAt: lastEventAtByFc.get(profile.id) ?? null,
    };
  });

  let detail: ReferralAdminDetail | null = null;
  if (requestedFcId) {
    const profile = filteredProfiles.find((candidate) => candidate.id === requestedFcId)
      ?? profiles.find((candidate) => candidate.id === requestedFcId)
      ?? null;

    if (profile) {
      const currentCode = activeCodeByFc.get(profile.id) ?? null;
      const codeHistory = (codeHistoryByFc.get(profile.id) ?? [])
        .filter((row) => !row.is_active)
        .map(toCodeHistoryItem);
      const recentEvents = (eventsByFc.get(profile.id) ?? []).slice(0, 12);

      detail = {
        fcId: profile.id,
        name: profile.name,
        phone: profile.phone ?? '',
        affiliation: profile.affiliation ?? '',
        currentCode: currentCode ? toCodeHistoryItem(currentCode) : null,
        codeHistory,
        recentEvents,
      };
    }
  }

  return {
    summary,
    items,
    detail,
    permissions: {
      canMutate: session.role === 'admin',
    },
    page,
    pageSize,
    total,
  };
}

export async function backfillReferralCodes(
  session: VerifiedServerSession,
  requestedLimit?: number,
) {
  const actor = await resolveAdminActorContext(session);
  const safeLimit = clampPositiveInteger(requestedLimit, MAX_BACKFILL_LIMIT, MAX_BACKFILL_LIMIT);
  const { data, error } = await adminSupabase.rpc('admin_backfill_referral_codes', {
    p_limit: safeLimit,
    p_actor_phone: actor.actorPhone,
    p_actor_role: actor.actorRole,
    p_actor_staff_type: actor.actorStaffType,
    p_reason: 'initial_backfill',
  });

  if (error) {
    throw new Error(normalizeDbErrorMessage(error.message));
  }

  return normalizeMutationResult(
    normalizeRpcResult<ReferralCodeMutationResult>(
      data as ReferralCodeMutationResult | ReferralCodeMutationResult[] | null,
    ),
  );
}

export async function rotateReferralCode(
  session: VerifiedServerSession,
  fcId: string,
  reason: string,
) {
  const actor = await resolveAdminActorContext(session);
  const normalizedReason = reason.trim();
  if (!normalizedReason) {
    throw new Error('사유를 입력해주세요.');
  }

  const { data, error } = await adminSupabase.rpc('admin_issue_referral_code', {
    p_fc_id: fcId,
    p_actor_phone: actor.actorPhone,
    p_actor_role: actor.actorRole,
    p_actor_staff_type: actor.actorStaffType,
    p_reason: normalizedReason,
    p_rotate: true,
  });

  if (error) {
    throw new Error(normalizeDbErrorMessage(error.message));
  }

  return normalizeMutationResult(
    normalizeRpcResult<ReferralCodeMutationResult>(
      data as ReferralCodeMutationResult | ReferralCodeMutationResult[] | null,
    ),
  );
}

export async function disableReferralCode(
  session: VerifiedServerSession,
  fcId: string,
  reason: string,
) {
  const actor = await resolveAdminActorContext(session);
  const normalizedReason = reason.trim();
  if (!normalizedReason) {
    throw new Error('사유를 입력해주세요.');
  }

  const { data, error } = await adminSupabase.rpc('admin_disable_referral_code', {
    p_fc_id: fcId,
    p_actor_phone: actor.actorPhone,
    p_actor_role: actor.actorRole,
    p_actor_staff_type: actor.actorStaffType,
    p_reason: normalizedReason,
  });

  if (error) {
    throw new Error(normalizeDbErrorMessage(error.message));
  }

  return normalizeMutationResult(
    normalizeRpcResult<ReferralCodeMutationResult>(
      data as ReferralCodeMutationResult | ReferralCodeMutationResult[] | null,
    ),
  );
}

export function logReferralBackfillSkip(fcId: string, error: unknown) {
  logger.warn('[admin-referrals] backfill candidate skipped', {
    fcId,
    error: error instanceof Error ? error.message : String(error),
  });
}
