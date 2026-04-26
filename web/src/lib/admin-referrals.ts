import 'server-only';

import type { VerifiedServerSession } from '@/lib/server-session';
import type {
  ReferralAdminCodeHistoryItem,
  ReferralAdminDetail,
  ReferralAdminEventItem,
  ReferralAdminListItem,
  ReferralAdminSummary,
  ReferralAdminUnresolvedItem,
  RecommenderCandidate,
} from '@/types/referrals';
import type { GraphApiResponse, GraphNode, GraphNodeStatus } from '@/types/referral-graph';
import { adminSupabase } from '@/lib/admin-supabase';
import { logger } from '@/lib/logger';
import { buildReferralGraphEdges } from '@/lib/referral-graph-edges';
import { resolveReferralGraphHighlightType } from '@/lib/referral-graph-highlight';

const CODE_EVENT_TYPES = [
  'code_generated',
  'code_rotated',
  'code_disabled',
  'admin_override_applied',
  'referral_linked',
  'referral_changed',
  'referral_cleared',
] as const;
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
  is_manager_referral_shadow?: boolean | null;
};

type SearchableRecommenderProfileRow = {
  id: string;
  name: string;
  phone: string | null;
  affiliation: string | null;
  is_manager_referral_shadow?: boolean | null;
};

type StaffPhoneRow = {
  phone: string | null;
};

type ManagerNameRow = {
  name: string | null;
};

type ReferralCodeRow = {
  id: string;
  fc_id: string;
  code: string;
  is_active: boolean;
  created_at: string;
  disabled_at: string | null;
};

type FcProfileRow = {
  id: string;
  name: string;
  phone: string | null;
  affiliation: string | null;
  recommender: string | null;
  recommender_fc_id: string | null;
  is_manager_referral_shadow?: boolean | null;
};

type ReferralEventRow = {
  id: string;
  inviter_fc_id: string | null;
  invitee_fc_id: string | null;
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
  unresolvedItems: ReferralAdminUnresolvedItem[];
  permissions: ReferralAdminPermissions;
  page: number;
  pageSize: number;
  total: number;
};

type RecommenderSelectionResult = {
  changed: boolean;
  inviteeFcId: string;
  inviterFcId: string | null;
  recommenderName: string | null;
  referralCode: string | null;
};

type UnresolvedLegacyMatchStatus =
  ReferralAdminUnresolvedItem['matchStatus'];

const DB_ERROR_MESSAGE_MAP = new Map<string, string>([
  ['fc_id is required', '추천코드 대상 FC를 찾을 수 없습니다.'],
  ['FC profile not found', '추천코드 대상 FC를 찾을 수 없습니다.'],
  ['Manager referral profile conflict', '본부장 추천인 전용 프로필을 정리할 수 없습니다. 기존 FC 데이터와 전화번호 충돌 여부를 확인해주세요.'],
  ['manager_phone is required', '본부장 전화번호가 올바르지 않습니다.'],
  ['Active manager account not found', '활성 본부장 계정을 찾을 수 없습니다.'],
  ['Referral code can only be issued to completed FC profiles', '가입 완료된 FC만 추천코드를 발급할 수 있습니다.'],
  ['Referral code can only be issued to completed FC profiles or active manager referral profiles', '가입 완료된 FC 또는 활성 본부장 계정만 추천코드를 발급할 수 있습니다.'],
  ['Referral code requires normalized 11-digit FC phone', '전화번호가 정규화된 11자리인 FC만 추천코드를 발급할 수 있습니다.'],
  ['Request-board linked designer profiles cannot receive referral codes', '설계매니저 계정에는 추천코드를 발급할 수 없습니다.'],
  ['Admin accounts cannot receive referral codes', '운영 계정에는 추천코드를 발급할 수 없습니다.'],
  ['Active referral code not found', '활성 추천코드가 없습니다.'],
  ['Failed to generate unique referral code after 10 attempts', '추천코드 생성 시 충돌이 반복되어 중단되었습니다.'],
  ['admin_apply_recommender_override_not_ready', '운영 DB에 추천인 override 함수가 아직 적용되지 않았습니다. migration 20260331000005를 먼저 반영해주세요.'],
  ['apply_referral_link_state_not_ready', '운영 DB에 추천인 상태 단일화 함수가 아직 적용되지 않았습니다. migration 20260423000001을 먼저 반영해주세요.'],
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
  if (message.includes('apply_referral_link_state')) {
    return DB_ERROR_MESSAGE_MAP.get('apply_referral_link_state_not_ready') ?? message;
  }
  if (message.includes('admin_apply_recommender_override')) {
    return DB_ERROR_MESSAGE_MAP.get('admin_apply_recommender_override_not_ready') ?? message;
  }
  return DB_ERROR_MESSAGE_MAP.get(message) ?? message;
}

function normalizeName(value?: string | null) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function getPhoneLast4(value?: string | null) {
  const digits = normalizeDigits(value);
  return digits.length >= 4 ? digits.slice(-4) : null;
}

function formatCandidateDescriptor(profile: Pick<EligibleProfileRow | FcProfileRow, 'affiliation' | 'phone'>, duplicateCount: number) {
  const affiliation = normalizeName(profile.affiliation);
  const phoneLast4 = getPhoneLast4(profile.phone);
  const parts: string[] = [];

  if (affiliation) {
    parts.push(affiliation);
  }
  if (!affiliation || duplicateCount > 1) {
    if (phoneLast4) {
      parts.push(`끝 ${phoneLast4}`);
    }
  }

  return parts.join(' · ') || '식별 정보 없음';
}

function buildCandidateDuplicateCounts(
  profiles: Array<Pick<EligibleProfileRow | FcProfileRow, 'name'>>,
) {
  const counts = new Map<string, number>();
  for (const profile of profiles) {
    const key = normalizeName(profile.name);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function toRecommenderCandidate(
  profile: Pick<EligibleProfileRow | FcProfileRow, 'id' | 'name' | 'affiliation' | 'phone'>,
  activeCode: string | null,
  duplicateCount: number,
): RecommenderCandidate {
  const descriptor = formatCandidateDescriptor(profile, duplicateCount);
  return {
    fcId: profile.id,
    name: normalizeName(profile.name),
    affiliation: normalizeName(profile.affiliation),
    phoneLast4: getPhoneLast4(profile.phone),
    activeCode,
    descriptor,
    label: [normalizeName(profile.name), descriptor].filter(Boolean).join(' · '),
  };
}

function isEligibleProfile(profile: EligibleProfileRow) {
  return (
    (profile.signup_completed === true || profile.is_manager_referral_shadow === true) &&
    /^\d{11}$/.test(normalizeDigits(profile.phone)) &&
    !String(profile.affiliation ?? '').includes('설계매니저')
  );
}

function isSearchableRecommenderProfile(
  profile: Pick<SearchableRecommenderProfileRow, 'phone' | 'affiliation'>,
) {
  return (
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
  const { data: adminRows, error: adminError } = await adminSupabase
    .from('admin_accounts')
    .select('phone');

  if (adminError) {
    throw adminError;
  }

  const excluded = new Set<string>();

  for (const row of (adminRows ?? []) as StaffPhoneRow[]) {
    const digits = normalizeDigits(row.phone);
    if (digits.length === 11) {
      excluded.add(digits);
    }
  }

  return excluded;
}

async function fetchManagerNames() {
  const { data, error } = await adminSupabase
    .from('manager_accounts')
    .select('name');

  if (error) {
    throw error;
  }

  return new Set(
    ((data ?? []) as ManagerNameRow[])
      .map((row) => normalizeName(row.name))
      .filter(Boolean),
  );
}

async function fetchEligibleProfiles() {
  const [{ data, error }, excludedStaffPhones] = await Promise.all([
    adminSupabase
      .from('fc_profiles')
      .select('id,name,phone,affiliation,signup_completed,is_manager_referral_shadow')
      .or('signup_completed.eq.true,is_manager_referral_shadow.eq.true')
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

async function fetchSearchableRecommenderProfiles() {
  const [{ data, error }, excludedStaffPhones] = await Promise.all([
    adminSupabase
      .from('fc_profiles')
      .select('id,name,phone,affiliation,is_manager_referral_shadow')
      .order('created_at', { ascending: false }),
    fetchExcludedStaffPhones(),
  ]);

  if (error) {
    throw error;
  }

  return ((data ?? []) as SearchableRecommenderProfileRow[]).filter((profile) => {
    if (!isSearchableRecommenderProfile(profile)) {
      return false;
    }

    return !excludedStaffPhones.has(normalizeDigits(profile.phone));
  });
}

async function fetchFcProfiles() {
  const [{ data, error }, excludedStaffPhones] = await Promise.all([
    adminSupabase
      .from('fc_profiles')
      .select('id,name,phone,affiliation,recommender,recommender_fc_id,signup_completed,is_manager_referral_shadow')
      .or('signup_completed.eq.true,is_manager_referral_shadow.eq.true')
      .order('created_at', { ascending: false }),
    fetchExcludedStaffPhones(),
  ]);

  if (error) {
    throw error;
  }

  return ((data ?? []) as Array<FcProfileRow & { signup_completed?: boolean | null }>)
    .filter((row) => row.signup_completed === true || row.is_manager_referral_shadow === true)
    .filter((row) => !String(row.affiliation ?? '').includes('설계매니저'))
    .filter((row) => !excludedStaffPhones.has(normalizeDigits(row.phone)))
    .map((row) => ({
      id: row.id,
      name: row.name,
      phone: row.phone,
      affiliation: row.affiliation,
      recommender: row.recommender,
      recommender_fc_id: row.recommender_fc_id,
      is_manager_referral_shadow: row.is_manager_referral_shadow,
    }));
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
    .select('id,inviter_fc_id,invitee_fc_id,referral_code,event_type,metadata,created_at')
    .or(`inviter_fc_id.in.(${fcIds.join(',')}),invitee_fc_id.in.(${fcIds.join(',')})`)
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
    const previousInviterFcId =
      (eventRow.event_type === 'admin_override_applied' || eventRow.event_type === 'referral_cleared')
      && !eventRow.inviter_fc_id
      && eventRow.metadata
      && typeof eventRow.metadata.beforeRecommenderFcId === 'string'
      && eventRow.metadata.beforeRecommenderFcId.trim()
        ? eventRow.metadata.beforeRecommenderFcId.trim()
        : null;
    const eventOwnerFcId = eventRow.inviter_fc_id ?? previousInviterFcId;

    if (!eventOwnerFcId) {
      continue;
    }

    const nextEvent = toEventItem(eventRow);
    const history = eventsByFc.get(eventOwnerFcId) ?? [];
    history.push(nextEvent);
    eventsByFc.set(eventOwnerFcId, history);

    if (!lastEventAtByFc.has(eventOwnerFcId)) {
      lastEventAtByFc.set(eventOwnerFcId, eventRow.created_at);
    }
  }

  return { eventsByFc, lastEventAtByFc };
}

async function fetchActiveRecommenderCandidates() {
  const profiles = await fetchSearchableRecommenderProfiles();
  const codes = await fetchReferralCodes(profiles.map((profile) => profile.id));
  const { activeCodeByFc } = buildCodeMaps(codes);
  const activeProfiles = profiles.filter((profile) => activeCodeByFc.has(profile.id));
  const duplicateCounts = buildCandidateDuplicateCounts(activeProfiles);

  return activeProfiles.map((profile) =>
    toRecommenderCandidate(
      profile,
      activeCodeByFc.get(profile.id)?.code ?? null,
      duplicateCounts.get(normalizeName(profile.name)) ?? 1,
    ),
  );
}

async function fetchRecommenderCandidateById(fcId: string) {
  const { data, error } = await adminSupabase
    .from('fc_profiles')
    .select('id,name,phone,affiliation')
    .eq('id', fcId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data?.id) {
    return null;
  }

  const [codes, duplicateCandidates] = await Promise.all([
    fetchReferralCodes([fcId]),
    fetchActiveRecommenderCandidates(),
  ]);
  const duplicateCounts = buildCandidateDuplicateCounts([
    ...duplicateCandidates.map((candidate) => ({ name: candidate.name })),
    { name: data.name },
  ]);
  const activeCode = codes.find((row) => row.fc_id === fcId && row.is_active)?.code ?? null;

  return toRecommenderCandidate(
    {
      id: data.id,
      name: data.name,
      phone: data.phone,
      affiliation: data.affiliation,
    },
    activeCode,
    duplicateCounts.get(normalizeName(data.name)) ?? 1,
  );
}

export async function resolveAdminActorContext(session: VerifiedServerSession): Promise<AdminActorContext> {
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

function buildRecommenderCandidateSearchIndex(candidate: RecommenderCandidate) {
  return [
    candidate.name,
    candidate.affiliation,
    candidate.phoneLast4 ?? '',
    candidate.activeCode ?? '',
    candidate.label,
  ]
    .join(' ')
    .toLowerCase();
}

export async function searchRecommenderCandidates(params: {
  query?: string | null;
  excludeFcId?: string | null;
  selectedFcId?: string | null;
  limit?: number;
}) {
  const query = String(params.query ?? '').trim().toLowerCase();
  const excludeFcId = String(params.excludeFcId ?? '').trim();
  const selectedFcId = String(params.selectedFcId ?? '').trim();
  const safeLimit = clampPositiveInteger(params.limit ?? 20, 20, 50);
  const allCandidates = await fetchActiveRecommenderCandidates();

  const filtered = allCandidates
    .filter((candidate) => candidate.fcId !== excludeFcId)
    .filter((candidate) => (query ? buildRecommenderCandidateSearchIndex(candidate).includes(query) : true))
    .slice(0, safeLimit);

  const selectedCandidate = selectedFcId
    ? (allCandidates.find((candidate) => candidate.fcId === selectedFcId)
      ?? await fetchRecommenderCandidateById(selectedFcId))
    : null;

  const candidates = selectedCandidate && !filtered.some((candidate) => candidate.fcId === selectedCandidate.fcId)
    ? [selectedCandidate, ...filtered].slice(0, safeLimit)
    : filtered;

  return {
    candidates,
    selectedCandidate,
  };
}

function normalizeMutationResult(result: ReferralCodeMutationResult | null) {
  if (!result) {
    throw new Error('추천코드 작업 결과를 확인할 수 없습니다.');
  }

  return result;
}

function buildUnresolvedLegacyItems(
  profiles: FcProfileRow[],
  candidates: RecommenderCandidate[],
) {
  const candidatesByName = new Map<string, RecommenderCandidate[]>();
  for (const candidate of candidates) {
    const key = normalizeName(candidate.name);
    if (!key) continue;
    const current = candidatesByName.get(key) ?? [];
    current.push(candidate);
    candidatesByName.set(key, current);
  }

  return profiles
    .filter((profile) => normalizeName(profile.recommender) && !profile.recommender_fc_id)
    .map<ReferralAdminUnresolvedItem>((profile) => {
      const normalizedLegacyRecommender = normalizeName(profile.recommender);
      const allMatches = candidatesByName.get(normalizedLegacyRecommender) ?? [];
      const selfReferral = normalizeName(profile.name) === normalizedLegacyRecommender;
      const matches = allMatches.filter((candidate) => candidate.fcId !== profile.id);

      let matchStatus: UnresolvedLegacyMatchStatus;
      if (selfReferral) {
        matchStatus = 'self_referral';
      } else if (matches.length > 1) {
        matchStatus = 'ambiguous';
      } else if (matches.length === 1) {
        matchStatus = 'auto_resolvable';
      } else {
        matchStatus = 'missing_candidate';
      }

      const autoResolvableCandidate = matchStatus === 'auto_resolvable'
        ? matches[0] ?? null
        : null;

      return {
        inviteeFcId: profile.id,
        inviteeName: profile.name,
        inviteePhone: profile.phone ?? '',
        inviteeAffiliation: profile.affiliation ?? '',
        legacyRecommenderName: normalizedLegacyRecommender,
        candidateCount: matches.length,
        candidatePreview: matches.slice(0, 3).map((candidate) =>
          [candidate.label, candidate.activeCode].filter(Boolean).join(' · '),
        ),
        candidateOptions: matches,
        autoResolvableCandidate,
        matchStatus,
      };
    })
    .sort((a, b) => {
      const priority = {
        self_referral: 0,
        auto_resolvable: 1,
        ambiguous: 2,
        missing_candidate: 3,
      } as const;
      const byStatus = priority[a.matchStatus] - priority[b.matchStatus];
      if (byStatus !== 0) return byStatus;
      return a.inviteeName.localeCompare(b.inviteeName, 'ko-KR');
    });
}

export async function applyRecommenderSelection(params: {
  actor: AdminActorContext;
  inviteeFcId: string;
  inviterFcId: string | null;
  reason: string;
}): Promise<RecommenderSelectionResult> {
  const inviteeFcId = String(params.inviteeFcId ?? '').trim();
  const inviterFcId = String(params.inviterFcId ?? '').trim() || null;
  const reason = String(params.reason ?? '').trim();

  if (!inviteeFcId) {
    throw new Error('추천인 대상 FC를 찾을 수 없습니다.');
  }
  if (!reason) {
    throw new Error('추천인 변경 사유를 입력해주세요.');
  }
  if (inviterFcId && inviterFcId === inviteeFcId) {
    throw new Error('자기 자신을 추천인으로 지정할 수 없습니다.');
  }

  const { data, error } = await adminSupabase.rpc('apply_referral_link_state', {
    p_invitee_fc_id: inviteeFcId,
    p_inviter_fc_id: inviterFcId,
    p_referral_code_id: null,
    p_referral_code: null,
    p_source: 'admin_override',
    p_actor_phone: params.actor.actorPhone,
    p_actor_role: params.actor.actorRole,
    p_actor_staff_type: params.actor.actorStaffType,
    p_reason: reason,
  });

  if (error) {
    throw new Error(normalizeDbErrorMessage(error.message));
  }

  const result = normalizeRpcResult<Record<string, unknown>>(data as Record<string, unknown> | Record<string, unknown>[] | null);
  if (!result) {
    throw new Error('추천인 코드 작업 결과를 확인할 수 없습니다.');
  }

  return {
    changed: Boolean(result.changed),
    inviteeFcId: String(result.inviteeFcId ?? inviteeFcId),
    inviterFcId: typeof result.inviterFcId === 'string' && result.inviterFcId.trim() ? result.inviterFcId : null,
    recommenderName: typeof result.recommenderName === 'string' && result.recommenderName.trim()
      ? result.recommenderName.trim()
      : null,
    referralCode: typeof result.referralCode === 'string' && result.referralCode.trim()
      ? result.referralCode.trim()
      : null,
  };
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

  const [profiles, allProfiles, activeCandidates] = await Promise.all([
    fetchEligibleProfiles(),
    fetchFcProfiles(),
    fetchActiveRecommenderCandidates(),
  ]);
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
    unresolvedLegacyCount: allProfiles.filter((profile) => normalizeName(profile.recommender) && !profile.recommender_fc_id).length,
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
    unresolvedItems: buildUnresolvedLegacyItems(allProfiles, activeCandidates),
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

export async function linkLegacyRecommender(
  session: VerifiedServerSession,
  inviteeFcId: string,
  inviterFcId: string,
  reason: string,
) {
  const actor = await resolveAdminActorContext(session);
  return applyRecommenderSelection({
    actor,
    inviteeFcId,
    inviterFcId,
    reason,
  });
}

export async function clearLegacyRecommender(
  session: VerifiedServerSession,
  inviteeFcId: string,
  reason: string,
) {
  const actor = await resolveAdminActorContext(session);
  return applyRecommenderSelection({
    actor,
    inviteeFcId,
    inviterFcId: null,
    reason,
  });
}

export async function autoResolveLegacyRecommenders(
  session: VerifiedServerSession,
  requestedLimit?: number,
  requestedReason?: string | null,
) {
  const actor = await resolveAdminActorContext(session);
  const safeLimit = clampPositiveInteger(requestedLimit ?? MAX_BACKFILL_LIMIT, MAX_BACKFILL_LIMIT, MAX_BACKFILL_LIMIT);
  const reason = String(requestedReason ?? '').trim() || 'legacy_auto_resolve_exact_unique';
  const [profiles, activeCandidates] = await Promise.all([
    fetchFcProfiles(),
    fetchActiveRecommenderCandidates(),
  ]);
  const unresolvedItems = buildUnresolvedLegacyItems(profiles, activeCandidates);
  const autoResolvableItems = unresolvedItems.filter(
    (item) => item.matchStatus === 'auto_resolvable' && item.autoResolvableCandidate,
  );
  const targets = autoResolvableItems.slice(0, safeLimit);

  let linked = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of targets) {
    try {
      const result = await applyRecommenderSelection({
        actor,
        inviteeFcId: item.inviteeFcId,
        inviterFcId: item.autoResolvableCandidate?.fcId ?? null,
        reason,
      });

      if (result.changed) {
        linked += 1;
      } else {
        skipped += 1;
      }
    } catch (error) {
      failed += 1;
      logReferralBackfillSkip(item.inviteeFcId, error);
    }
  }

  return {
    processed: targets.length,
    linked,
    skipped,
    failed,
    remaining: Math.max(0, autoResolvableItems.length - targets.length),
    limit: safeLimit,
  };
}

export function logReferralBackfillSkip(fcId: string, error: unknown) {
  logger.warn('[admin-referrals] backfill candidate skipped', {
    fcId,
    error: error instanceof Error ? error.message : String(error),
  });
}

export async function getReferralGraphData(session: VerifiedServerSession): Promise<GraphApiResponse> {
  const [profiles, allProfiles, managerNames] = await Promise.all([
    fetchEligibleProfiles(),
    fetchFcProfiles(),
    fetchManagerNames(),
  ]);

  const fcIds = profiles.map((p) => p.id);
  const codes = await fetchReferralCodes(fcIds);
  const { activeCodeByFc, codeHistoryByFc } = buildCodeMaps(codes);

  const referralCountByFc = new Map<string, number>();
  const inboundCountByFc = new Map<string, number>();
  const edges = buildReferralGraphEdges(allProfiles);

  const legacyUnresolvedSet = new Set(
    allProfiles
      .filter((p) => normalizeName(p.recommender) && !p.recommender_fc_id)
      .map((p) => p.id),
  );

  for (const edge of edges) {
    referralCountByFc.set(edge.source, (referralCountByFc.get(edge.source) ?? 0) + 1);
    inboundCountByFc.set(edge.target, (inboundCountByFc.get(edge.target) ?? 0) + 1);
  }

  const degreeByFc = new Map<string, number>();
  for (const edge of edges) {
    degreeByFc.set(edge.source, (degreeByFc.get(edge.source) ?? 0) + 1);
    degreeByFc.set(edge.target, (degreeByFc.get(edge.target) ?? 0) + 1);
  }

  const nodes: GraphNode[] = profiles.map((profile) => {
    const activeCodeRow = activeCodeByFc.get(profile.id) ?? null;
    const codeHistory = codeHistoryByFc.get(profile.id) ?? [];

    let nodeStatus: GraphNodeStatus;
    if (activeCodeRow?.is_active) {
      nodeStatus = 'has_active_code';
    } else if (codeHistory.length > 0) {
      nodeStatus = 'code_disabled';
    } else {
      nodeStatus = 'missing_code';
    }

    return {
      id: profile.id,
      name: profile.name,
      phone: profile.phone ?? '',
      affiliation: profile.affiliation ?? '',
      activeCode: activeCodeRow?.code ?? null,
      referralCount: referralCountByFc.get(profile.id) ?? 0,
      inboundCount: inboundCountByFc.get(profile.id) ?? 0,
      nodeStatus,
      isIsolated: (degreeByFc.get(profile.id) ?? 0) === 0,
      hasLegacyUnresolved: legacyUnresolvedSet.has(profile.id),
      highlightType: resolveReferralGraphHighlightType({
        name: profile.name,
        isManagerReferralShadow: profile.is_manager_referral_shadow,
        managerNames,
      }),
    };
  });

  return {
    ok: true,
    nodes,
    edges,
    permissions: {
      canMutate: session.role === 'admin',
    },
  };
}
