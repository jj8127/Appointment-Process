import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  getEnv,
  requireAppSessionFromRequest,
  type AppSessionTokenPayload,
} from '../_shared/request-board-auth.ts';
import { reportEdgeDiagnostic } from '../_shared/edge-diagnostic.ts';

const allowedOrigins = (getEnv('ALLOWED_ORIGINS') ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigins.length > 0 ? allowedOrigins[0] : 'https://yourdomain.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-app-session-token, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Credentials': 'true',
};

const supabaseUrl = getEnv('SUPABASE_URL');
const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl) {
  throw new Error('Missing required environment variable: SUPABASE_URL');
}
if (!serviceKey) {
  throw new Error('Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(supabaseUrl, serviceKey);

type SessionPayload = AppSessionTokenPayload;

type TreeRpcRow = {
  fc_id: string;
  name: string | null;
  affiliation: string | null;
  active_code: string | null;
  parent_fc_id: string | null;
  node_depth: number;
  relationship_source: 'linked' | 'root' | null;
  direct_invitee_count: number | null;
  total_descendant_count: number | null;
  is_ancestor: boolean;
};

type ProfileRow = {
  id: string;
  name: string | null;
  phone: string | null;
  affiliation: string | null;
  recommender_fc_id: string | null;
  is_manager_referral_shadow: boolean | null;
  signup_completed: boolean | null;
  appointment_date_life: string | null;
  appointment_date_nonlife: string | null;
  life_commission_completed: boolean | null;
  nonlife_commission_completed: boolean | null;
};

type EdgeSource = 'linked';

type EdgeRecord = {
  parentFcId: string;
  childFcId: string;
  relationshipSource: EdgeSource;
};

type ReferralRoot = {
  fcId: string;
  name: string | null;
  affiliation: string | null;
  code: string | null;
  directInviteeCount: number;
  totalDescendantCount: number;
};

type ReferralAncestor = {
  fcId: string;
  name: string | null;
  affiliation: string | null;
  code: string | null;
};

type ReferralDescendant = {
  fcId: string;
  parentFcId: string | null;
  depth: number;
  name: string | null;
  affiliation: string | null;
  code: string | null;
  directInviteeCount: number;
  totalDescendantCount: number;
  relationshipSource: 'linked';
};

type ReferralGraphNode = {
  id: string;
  name: string;
  affiliation: string;
  activeCode: string | null;
  nodeStatus: 'has_active_code' | 'code_disabled' | 'missing_code';
  signupCompleted: boolean;
  allCommissionsCompleted: boolean;
  directInviteeCount: number;
  totalDescendantCount: number;
  isViewer: boolean;
};

type ReferralGraphEdge = {
  id: string;
  source: string;
  target: string;
};

const QUERY_ID_CHUNK_SIZE = 100;
const QUERY_PAGE_SIZE = 500;
const MOBILE_GRAPH_MAX_NODES = 300;

function chunkIds(ids: string[], size = QUERY_ID_CHUNK_SIZE) {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += size) {
    chunks.push(ids.slice(index, index + size));
  }
  return chunks;
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function fail(code: string, message: string, status = 400) {
  return json({ ok: false, code, message }, status);
}

function cleanPhone(input: string) {
  return (input ?? '').replace(/[^0-9]/g, '');
}

function clampDepth(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 2;
  return Math.max(1, Math.min(3, Math.trunc(numeric)));
}

async function ensureManagerReferralShadowProfile(managerPhone: string, managerName?: string | null) {
  const { error } = await supabase.rpc('ensure_manager_referral_shadow_profile', {
    p_manager_phone: managerPhone,
    p_manager_name: typeof managerName === 'string' && managerName.trim() ? managerName.trim() : null,
  });

  return error;
}

async function fetchProfilesByIds(ids: string[]) {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) {
    return new Map<string, ProfileRow>();
  }

  const map = new Map<string, ProfileRow>();
  for (const idsChunk of chunkIds(uniqueIds)) {
    const { data, error } = await supabase
      .from('fc_profiles')
      .select(
        'id, name, phone, affiliation, recommender_fc_id, is_manager_referral_shadow, signup_completed, appointment_date_life, appointment_date_nonlife, life_commission_completed, nonlife_commission_completed',
      )
      .in('id', idsChunk);

    if (error) {
      throw error;
    }

    for (const row of (data ?? []) as ProfileRow[]) {
      map.set(row.id, row);
    }
  }
  return map;
}

async function fetchCodeHistoryByFcIds(ids: string[]) {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) {
    return new Set<string>();
  }

  const history = new Set<string>();
  for (const idsChunk of chunkIds(uniqueIds)) {
    let offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from('referral_codes')
        .select('fc_id')
        .in('fc_id', idsChunk)
        .order('id', { ascending: true })
        .range(offset, offset + QUERY_PAGE_SIZE - 1);

      if (error) {
        throw error;
      }

      const rows = (data ?? []) as { fc_id: string | null }[];
      for (const row of rows) {
        if (row.fc_id) history.add(row.fc_id);
      }
      if (rows.length < QUERY_PAGE_SIZE) break;
      offset += QUERY_PAGE_SIZE;
    }
  }
  return history;
}

async function fetchExcludedStaffPhones() {
  const phones = new Set<string>();
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('admin_accounts')
      .select('phone')
      .order('id', { ascending: true })
      .range(offset, offset + QUERY_PAGE_SIZE - 1);

    if (error) {
      throw error;
    }

    const rows = (data ?? []) as { phone: string | null }[];
    for (const row of rows) {
      const phone = cleanPhone(row.phone ?? '');
      if (phone.length === 11) phones.add(phone);
    }
    if (rows.length < QUERY_PAGE_SIZE) break;
    offset += QUERY_PAGE_SIZE;
  }

  return phones;
}

function isGraphEligibleProfile(profile: ProfileRow, excludedStaffPhones: Set<string>) {
  const phone = cleanPhone(profile.phone ?? '');
  return (
    phone.length === 11
    && !String(profile.affiliation ?? '').includes('설계매니저')
    && !excludedStaffPhones.has(phone)
  );
}

async function fetchActiveCodesByFcIds(ids: string[]) {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) {
    return new Map<string, string | null>();
  }

  const map = new Map<string, string | null>();
  for (const idsChunk of chunkIds(uniqueIds)) {
    const { data, error } = await supabase
      .from('referral_codes')
      .select('fc_id, code, created_at, id')
      .in('fc_id', idsChunk)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false });

    if (error) {
      throw error;
    }

    for (const row of (data ?? []) as { fc_id: string; code: string | null }[]) {
      if (!map.has(row.fc_id)) {
        map.set(row.fc_id, row.code ?? null);
      }
    }
  }
  return map;
}

async function fetchChildEdges(parentIds: string[]) {
  const uniqueParentIds = Array.from(new Set(parentIds.filter(Boolean)));
  if (uniqueParentIds.length === 0) {
    return [] as EdgeRecord[];
  }

  const edgeMap = new Map<string, EdgeRecord>();
  for (const parentIdsChunk of chunkIds(uniqueParentIds)) {
    let offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from('fc_profiles')
        .select('id, recommender_fc_id, is_manager_referral_shadow')
        .in('recommender_fc_id', parentIdsChunk)
        .order('id', { ascending: true })
        .range(offset, offset + QUERY_PAGE_SIZE - 1);

      if (error) {
        throw error;
      }

      const rows = (data ?? []) as {
        id: string;
        recommender_fc_id: string | null;
        is_manager_referral_shadow: boolean | null;
      }[];
      for (const row of rows) {
        const parentFcId = row.recommender_fc_id ?? null;
        if (!parentFcId || row.id === parentFcId || row.is_manager_referral_shadow === true) {
          continue;
        }

        const key = `${parentFcId}:${row.id}`;
        edgeMap.set(key, {
          parentFcId,
          childFcId: row.id,
          relationshipSource: 'linked',
        });
      }
      if (rows.length < QUERY_PAGE_SIZE) break;
      offset += QUERY_PAGE_SIZE;
    }
  }

  return Array.from(edgeMap.values());
}

async function fetchGraphChildEdges(
  parentIds: string[],
  excludedStaffPhones: Set<string>,
  limit: number,
) {
  const uniqueParentIds = Array.from(new Set(parentIds.filter(Boolean)));
  const safeLimit = Math.max(1, Math.trunc(limit));
  if (uniqueParentIds.length === 0) {
    return [] as EdgeRecord[];
  }

  const edgeMap = new Map<string, EdgeRecord>();
  for (const parentIdsChunk of chunkIds(uniqueParentIds)) {
    let offset = 0;
    while (edgeMap.size < safeLimit) {
      const pageSize = QUERY_PAGE_SIZE;
      const { data, error } = await supabase
        .from('fc_profiles')
        .select(
          'id, name, phone, affiliation, recommender_fc_id, is_manager_referral_shadow, signup_completed, appointment_date_life, appointment_date_nonlife, life_commission_completed, nonlife_commission_completed',
        )
        .in('recommender_fc_id', parentIdsChunk)
        .order('id', { ascending: true })
        .range(offset, offset + pageSize - 1);

      if (error) {
        throw error;
      }

      const rows = (data ?? []) as ProfileRow[];
      for (const profile of rows) {
        const parentFcId = profile.recommender_fc_id ?? null;
        if (
          !parentFcId
          || profile.id === parentFcId
          || !isGraphEligibleProfile(profile, excludedStaffPhones)
        ) {
          continue;
        }

        const key = `${parentFcId}:${profile.id}`;
        edgeMap.set(key, {
          parentFcId,
          childFcId: profile.id,
          relationshipSource: 'linked',
        });
        if (edgeMap.size >= safeLimit) {
          break;
        }
      }

      if (rows.length < pageSize) break;
      offset += rows.length;
    }
    if (edgeMap.size >= safeLimit) break;
  }

  return Array.from(edgeMap.values());
}

function collectReachableDescendants(
  nodeId: string,
  childMap: Map<string, Set<string>>,
  memo: Map<string, Set<string>>,
  path = new Set<string>(),
): Set<string> {
  const cached = memo.get(nodeId);
  if (cached) {
    return new Set(cached);
  }

  const nextPath = new Set(path);
  nextPath.add(nodeId);

  const reachable = new Set<string>();
  for (const childId of childMap.get(nodeId) ?? []) {
    if (nextPath.has(childId)) {
      continue;
    }

    reachable.add(childId);
    const nested = collectReachableDescendants(childId, childMap, memo, nextPath);
    for (const nestedId of nested) {
      reachable.add(nestedId);
    }
  }

  memo.set(nodeId, new Set(reachable));
  return reachable;
}

async function buildFallbackTreeRows(
  rootFcId: string,
  depth: number,
  options?: {
    maxDescendants?: number;
    includeManagerReferralShadows?: boolean;
    loadChildEdges?: (parentIds: string[], limit?: number) => Promise<EdgeRecord[]>;
  },
) {
  const safeDepth = Math.max(1, Math.min(20, Math.trunc(depth || 2)));
  const maxDescendants = options?.maxDescendants == null
    ? null
    : Math.max(1, Math.trunc(options.maxDescendants));
  const loadChildEdges = options?.loadChildEdges ?? fetchChildEdges;
  const profileMap = await fetchProfilesByIds([rootFcId]);
  const rootProfile = profileMap.get(rootFcId);
  if (!rootProfile) {
    return { rows: [] as TreeRpcRow[], truncated: false };
  }

  const ancestorRows: TreeRpcRow[] = [];
  const ancestorIds: string[] = [];
  let nextAncestorId = rootProfile.recommender_fc_id ?? null;
  let ancestorDepth = -1;
  const ancestorSeen = new Set<string>([rootFcId]);

  while (nextAncestorId && ancestorDepth >= -10 && !ancestorSeen.has(nextAncestorId)) {
    ancestorSeen.add(nextAncestorId);
    const ancestorProfiles = await fetchProfilesByIds([nextAncestorId]);
    const ancestor = ancestorProfiles.get(nextAncestorId);
    if (!ancestor) {
      break;
    }

    ancestorIds.push(ancestor.id);
    ancestorRows.push({
      fc_id: ancestor.id,
      name: ancestor.name ?? null,
      affiliation: ancestor.affiliation ?? null,
      active_code: null,
      parent_fc_id: ancestor.recommender_fc_id ?? null,
      node_depth: ancestorDepth,
      relationship_source: 'linked',
      direct_invitee_count: 0,
      total_descendant_count: 0,
      is_ancestor: true,
    });

    nextAncestorId = ancestor.recommender_fc_id ?? null;
    ancestorDepth -= 1;
  }

  const childrenByParent = new Map<string, Map<string, EdgeSource>>();
  const chosenParentByChild = new Map<string, { parentFcId: string; relationshipSource: EdgeSource }>();
  const depthByNode = new Map<string, number>();
  const seenDescendants = new Set<string>([rootFcId]);
  const subtreeIds = new Set<string>([rootFcId]);

  let frontier = [rootFcId];
  let traversalDepth = 0;
  let traversalTruncated = false;

  while (frontier.length > 0 && traversalDepth < 20) {
    traversalDepth += 1;
    const remainingSlots = maxDescendants == null
      ? null
      : Math.max(0, maxDescendants - (seenDescendants.size - 1));
    if (remainingSlots === 0) {
      const overflowEdges = await loadChildEdges(frontier, 1);
      traversalTruncated = traversalTruncated || overflowEdges.length > 0;
      break;
    }

    const edgeLimit = remainingSlots == null ? undefined : remainingSlots + 1;
    const loadedEdges = await loadChildEdges(frontier, edgeLimit);
    const edges = remainingSlots == null
      ? loadedEdges
      : loadedEdges.slice(0, remainingSlots);
    if (remainingSlots != null && loadedEdges.length > remainingSlots) {
      traversalTruncated = true;
    }
    const nextFrontier: string[] = [];

    for (const edge of edges) {
      if (!childrenByParent.has(edge.parentFcId)) {
        childrenByParent.set(edge.parentFcId, new Map());
      }
      childrenByParent
        .get(edge.parentFcId)
        ?.set(edge.childFcId, edge.relationshipSource);
    }

    const parentIds = edges.map((edge) => edge.childFcId);
    const childProfiles = await fetchProfilesByIds(parentIds);

    for (const edge of edges) {
      const childProfile = childProfiles.get(edge.childFcId);
      if (
        !childProfile
        || (
          options?.includeManagerReferralShadows !== true
          && childProfile.is_manager_referral_shadow === true
        )
      ) {
        continue;
      }

      if (!seenDescendants.has(edge.childFcId)) {
        seenDescendants.add(edge.childFcId);
        subtreeIds.add(edge.childFcId);
        depthByNode.set(edge.childFcId, traversalDepth);
        chosenParentByChild.set(edge.childFcId, {
          parentFcId: edge.parentFcId,
          relationshipSource: edge.relationshipSource,
        });
        nextFrontier.push(edge.childFcId);
        continue;
      }

      const currentDepth = depthByNode.get(edge.childFcId) ?? Number.MAX_SAFE_INTEGER;
      const currentParent = chosenParentByChild.get(edge.childFcId);
      if (
        traversalDepth < currentDepth
        || (
          traversalDepth === currentDepth
          && currentParent
          && edge.parentFcId.localeCompare(currentParent.parentFcId) < 0
        )
      ) {
        depthByNode.set(edge.childFcId, traversalDepth);
        chosenParentByChild.set(edge.childFcId, {
          parentFcId: edge.parentFcId,
          relationshipSource: edge.relationshipSource,
        });
      }
    }

    frontier = nextFrontier;
  }

  const subtreeProfiles = await fetchProfilesByIds(Array.from(subtreeIds));
  const codes = await fetchActiveCodesByFcIds([...Array.from(subtreeIds), ...ancestorIds]);
  const childMap = new Map<string, Set<string>>();

  for (const [parentFcId, childSources] of childrenByParent.entries()) {
    childMap.set(parentFcId, new Set(childSources.keys()));
  }

  const totalDescMemo = new Map<string, Set<string>>();
  const directCounts = new Map<string, number>();
  const totalCounts = new Map<string, number>();

  for (const nodeId of subtreeIds) {
    directCounts.set(nodeId, childMap.get(nodeId)?.size ?? 0);
    totalCounts.set(
      nodeId,
      collectReachableDescendants(nodeId, childMap, totalDescMemo).size,
    );
  }

  const descendantRows: TreeRpcRow[] = [];
  for (const [fcId, nodeDepth] of depthByNode.entries()) {
    if (nodeDepth > safeDepth) {
      continue;
    }

    const profile = subtreeProfiles.get(fcId);
    const chosenParent = chosenParentByChild.get(fcId);
    if (!profile || !chosenParent) {
      continue;
    }

    descendantRows.push({
      fc_id: fcId,
      name: profile.name ?? null,
      affiliation: profile.affiliation ?? null,
      active_code: codes.get(fcId) ?? null,
      parent_fc_id: chosenParent.parentFcId,
      node_depth: nodeDepth,
      relationship_source: chosenParent.relationshipSource,
      direct_invitee_count: directCounts.get(fcId) ?? 0,
      total_descendant_count: totalCounts.get(fcId) ?? 0,
      is_ancestor: false,
    });
  }

  const rootRow: TreeRpcRow = {
    fc_id: rootProfile.id,
    name: rootProfile.name ?? null,
    affiliation: rootProfile.affiliation ?? null,
    active_code: codes.get(rootProfile.id) ?? null,
    parent_fc_id: null,
    node_depth: 0,
    relationship_source: 'root',
    direct_invitee_count: directCounts.get(rootProfile.id) ?? 0,
    total_descendant_count: totalCounts.get(rootProfile.id) ?? 0,
    is_ancestor: false,
  };

  for (const row of ancestorRows) {
    row.active_code = codes.get(row.fc_id) ?? null;
  }

  return {
    rows: [rootRow, ...ancestorRows, ...descendantRows],
    truncated: traversalTruncated,
  };
}

async function loadTreeRows(rootFcId: string, depth: number) {
  const { data, error } = await supabase.rpc('get_referral_subtree', {
    root_fc_id: rootFcId,
    max_depth: depth,
  });

  if (!error) {
    return { rows: (data ?? []) as TreeRpcRow[] };
  }

  try {
    const fallback = await buildFallbackTreeRows(rootFcId, depth);
    return { rows: fallback.rows };
  } catch {
    reportEdgeDiagnostic({
      event: 'referral_tree.load',
      reason: 'rpc_and_fallback_failed',
      retryable: true,
      errorClass: 'database',
    });
    return { error };
  }
}

async function resolveSelfProfile(
  session: SessionPayload,
  options?: { allowManagerShadowBootstrap?: boolean },
) {
  const sessionPhone = cleanPhone(session.phone ?? '');
  if (sessionPhone.length !== 11) {
    return {
      error: fail('invalid_app_session', '세션이 유효하지 않습니다. 다시 로그인해주세요.', 401),
    };
  }

  let managerAccount: { id: string; name: string | null } | null = null;
  let adminAccount: { id: string; staff_type: string | null } | null = null;

  if (session.role === 'manager' || session.role === 'admin') {
    const { data, error } = await supabase
      .from('manager_accounts')
      .select('id, name')
      .eq('phone', sessionPhone)
      .eq('active', true)
      .maybeSingle();

    if (error) {
      return { error: json({ ok: false, code: 'db_error', message: error.message }, 500) };
    }
    managerAccount = data ?? null;
  }

  if (session.role === 'admin') {
    const { data, error } = await supabase
      .from('admin_accounts')
      .select('id, staff_type')
      .eq('phone', sessionPhone)
      .maybeSingle();

    if (error) {
      return { error: json({ ok: false, code: 'db_error', message: error.message }, 500) };
    }
    adminAccount = data ?? null;
  } else {
    const { data, error } = await supabase
      .from('admin_accounts')
      .select('id')
      .eq('phone', sessionPhone)
      .maybeSingle();

    if (error) {
      return { error: json({ ok: false, code: 'db_error', message: error.message }, 500) };
    }
    if (data?.id) {
      return { error: fail('forbidden', '추천 관계를 조회할 수 없는 계정입니다.', 403) };
    }
  }

  if (session.role === 'admin' && adminAccount?.id) {
    return {
      profile: null,
      sessionPhone,
      managerAccount,
      adminAccount,
    };
  }

  if (session.role === 'manager' && !managerAccount?.id) {
    return { error: fail('forbidden', '추천 관계를 조회할 수 없는 계정입니다.', 403) };
  }

  const sessionFcId = String(session.fcId ?? '').trim();
  const profileQuery = supabase
    .from('fc_profiles')
    .select('id, phone, affiliation, signup_completed, is_manager_referral_shadow')
    .limit(1);

  let profileResult = sessionFcId
    ? await profileQuery.eq('id', sessionFcId).maybeSingle()
    : await profileQuery.eq('phone', sessionPhone).maybeSingle();

  if (
    !profileResult.data?.id
    && managerAccount?.id
    && options?.allowManagerShadowBootstrap !== false
  ) {
    const ensureError = await ensureManagerReferralShadowProfile(sessionPhone, managerAccount.name);
    if (ensureError) {
      return { error: json({ ok: false, code: 'db_error', message: ensureError.message }, 500) };
    }

    profileResult = await profileQuery.eq('phone', sessionPhone).maybeSingle();
  }

  const { data: profile, error: profileError } = profileResult;
  if (profileError) {
    return { error: json({ ok: false, code: 'db_error', message: profileError.message }, 500) };
  }
  if (!profile?.id) {
    return { error: fail('not_found', '계정을 찾을 수 없습니다.', 404) };
  }

  if (cleanPhone(String(profile.phone ?? '')) !== sessionPhone) {
    return {
      error: fail('invalid_app_session', '세션이 유효하지 않습니다. 다시 로그인해주세요.', 401),
    };
  }

  const isManagerShadow = profile.is_manager_referral_shadow === true;
  if (profile.signup_completed !== true && !(managerAccount?.id && isManagerShadow)) {
    return { error: fail('not_found', '계정을 찾을 수 없습니다.', 404) };
  }

  const affiliation = String(profile.affiliation ?? '');
  if (affiliation.includes('설계매니저')) {
    return { error: fail('forbidden', '추천 관계를 조회할 수 없는 계정입니다.', 403) };
  }

  return {
    profile,
    sessionPhone,
    managerAccount,
    adminAccount,
  };
}

async function ensureTargetAllowed(requesterFcId: string, requestedFcId: string) {
  if (requesterFcId === requestedFcId) {
    return null;
  }

  const { rows, error } = await loadTreeRows(requesterFcId, 5);
  if (error) {
    return json({ ok: false, code: 'db_error', message: error.message }, 500);
  }

  const visible = (rows ?? []).some((row) => row.fc_id === requestedFcId && row.is_ancestor !== true);
  if (!visible) {
    return fail('forbidden', '자신의 추천 관계 범위만 조회할 수 있습니다.', 403);
  }

  return null;
}

function mapRoot(row: TreeRpcRow): ReferralRoot {
  return {
    fcId: row.fc_id,
    name: row.name ?? null,
    affiliation: row.affiliation ?? null,
    code: row.active_code ?? null,
    directInviteeCount: Number(row.direct_invitee_count ?? 0),
    totalDescendantCount: Number(row.total_descendant_count ?? 0),
  };
}

function mapAncestor(row: TreeRpcRow): ReferralAncestor {
  return {
    fcId: row.fc_id,
    name: row.name ?? null,
    affiliation: row.affiliation ?? null,
    code: row.active_code ?? null,
  };
}

function mapDescendant(row: TreeRpcRow): ReferralDescendant {
  return {
    fcId: row.fc_id,
    parentFcId: row.parent_fc_id ?? null,
    depth: Number(row.node_depth ?? 0),
    name: row.name ?? null,
    affiliation: row.affiliation ?? null,
    code: row.active_code ?? null,
    directInviteeCount: Number(row.direct_invitee_count ?? 0),
    totalDescendantCount: Number(row.total_descendant_count ?? 0),
    relationshipSource: 'linked',
  };
}

function sortDescendants(a: ReferralDescendant, b: ReferralDescendant) {
  if (a.depth !== b.depth) {
    return a.depth - b.depth;
  }

  return (a.name ?? '').localeCompare(b.name ?? '', 'ko');
}

function mapGraphNode(
  row: TreeRpcRow,
  profile: ProfileRow,
  codeHistory: Set<string>,
  rootFcId: string,
): ReferralGraphNode {
  const activeCode = row.active_code ?? null;
  const lifeCompleted = Boolean(
    profile.life_commission_completed || profile.appointment_date_life,
  );
  const nonlifeCompleted = Boolean(
    profile.nonlife_commission_completed || profile.appointment_date_nonlife,
  );

  return {
    id: row.fc_id,
    name: profile.name?.trim() || '이름 없음',
    affiliation: profile.affiliation?.trim() || '소속 미지정',
    activeCode,
    nodeStatus: activeCode
      ? 'has_active_code'
      : codeHistory.has(row.fc_id)
        ? 'code_disabled'
        : 'missing_code',
    signupCompleted: profile.signup_completed === true,
    allCommissionsCompleted: lifeCompleted && nonlifeCompleted,
    directInviteeCount: Number(row.direct_invitee_count ?? 0),
    totalDescendantCount: Number(row.total_descendant_count ?? 0),
    isViewer: row.fc_id === rootFcId,
  };
}

async function resolveReferralGraph(session: SessionPayload) {
  if (session.role !== 'fc' && session.role !== 'manager') {
    return fail('forbidden', '추천 관계 그래프를 조회할 수 없는 계정입니다.', 403);
  }

  const resolved = await resolveSelfProfile(session, {
    allowManagerShadowBootstrap: false,
  });
  if ('error' in resolved && resolved.error) {
    if (resolved.error.status >= 500) {
      reportEdgeDiagnostic({
        event: 'referral_tree.load',
        reason: 'rpc_and_fallback_failed',
        retryable: true,
        errorClass: 'database',
      });
      return fail('db_error', '추천 관계 그래프를 불러오지 못했습니다.', 500);
    }
    return resolved.error;
  }

  const rootFcId = resolved.profile?.id ? String(resolved.profile.id) : null;
  if (!rootFcId) {
    return fail('not_found', '추천 관계를 조회할 계정을 찾을 수 없습니다.', 404);
  }

  try {
    const excludedStaffPhones = await fetchExcludedStaffPhones();
    const fallback = await buildFallbackTreeRows(rootFcId, 20, {
      maxDescendants: MOBILE_GRAPH_MAX_NODES - 1,
      includeManagerReferralShadows: true,
      loadChildEdges: (parentIds, limit) => fetchGraphChildEdges(
        parentIds,
        excludedStaffPhones,
        limit ?? MOBILE_GRAPH_MAX_NODES,
      ),
    });
    const graphRows = fallback.rows
      .filter((row) => row.is_ancestor !== true && row.node_depth >= 0)
      .sort((a, b) => a.node_depth - b.node_depth || a.fc_id.localeCompare(b.fc_id));
    const rootRow = graphRows.find((row) => row.fc_id === rootFcId && row.node_depth === 0);
    if (!rootRow) {
      return fail('not_found', '추천 관계를 찾을 수 없습니다.', 404);
    }

    const graphIds = Array.from(new Set(graphRows.map((row) => row.fc_id)));
    const [profiles, codeHistory] = await Promise.all([
      fetchProfilesByIds(graphIds),
      fetchCodeHistoryByFcIds(graphIds),
    ]);
    const visibleIds = new Set(graphIds);

    const nodes = graphRows
      .map((row) => {
        const profile = profiles.get(row.fc_id);
        return profile ? mapGraphNode(row, profile, codeHistory, rootFcId) : null;
      })
      .filter((node): node is ReferralGraphNode => node !== null)
      .sort((a, b) => {
        if (a.isViewer !== b.isViewer) return a.isViewer ? -1 : 1;
        return a.name.localeCompare(b.name, 'ko') || a.id.localeCompare(b.id);
      });

    const edgeMap = new Map<string, ReferralGraphEdge>();
    for (const row of graphRows) {
      const source = row.parent_fc_id ?? null;
      const target = row.fc_id;
      if (!source || source === target || !visibleIds.has(source) || !visibleIds.has(target)) {
        continue;
      }

      const id = `${source}->${target}`;
      edgeMap.set(id, { id, source, target });
    }

    const boundaryIds = graphRows
      .filter((row) => row.node_depth >= 20)
      .map((row) => row.fc_id);
    const boundaryEdges = await fetchGraphChildEdges(
      boundaryIds,
      excludedStaffPhones,
      1,
    );
    const truncated =
      fallback.truncated
      || boundaryEdges.length > 0;

    return json({
      ok: true,
      mode: 'graph',
      nodes,
      edges: Array.from(edgeMap.values()).sort((a, b) => a.id.localeCompare(b.id)),
      permissions: {
        canMutate: false,
        scope: 'downline',
        rootFcId,
      },
      truncated,
    });
  } catch {
    reportEdgeDiagnostic({
      event: 'referral_tree.load',
      reason: 'rpc_and_fallback_failed',
      retryable: true,
      errorClass: 'database',
    });
    return fail('db_error', '추천 관계 그래프를 불러오지 못했습니다.', 500);
  }
}

async function resolveReferralTree(req: Request, session: SessionPayload) {
  let body: { fcId?: string; depth?: number } = {};

  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const requestedFcId = typeof body.fcId === 'string' && body.fcId.trim()
    ? body.fcId.trim()
    : null;
  const depth = clampDepth(body.depth);
  const resolved = await resolveSelfProfile(session);
  if ('error' in resolved && resolved.error) {
    return resolved.error;
  }

  const { profile, adminAccount } = resolved;

  let targetFcId: string | null = null;

  if (session.role === 'admin' && adminAccount?.id) {
    targetFcId = requestedFcId ?? profile?.id ?? null;
    if (!targetFcId) {
      return fail('forbidden', '조회할 FC를 찾을 수 없습니다.', 403);
    }
  } else {
    const requesterFcId = profile?.id ? String(profile.id) : null;
    if (!requesterFcId) {
      return fail('not_found', '계정을 찾을 수 없습니다.', 404);
    }

    targetFcId = requestedFcId ?? requesterFcId;
    const authError = await ensureTargetAllowed(requesterFcId, targetFcId);
    if (authError) {
      return authError;
    }
  }

  const { rows, error } = await loadTreeRows(targetFcId, depth);
  if (error) {
    return json({ ok: false, code: 'db_error', message: error.message }, 500);
  }

  const rpcRows = rows ?? [];
  const rootRow = rpcRows.find((row) => row.node_depth === 0 && row.fc_id === targetFcId);
  if (!rootRow) {
    return fail('not_found', '추천 관계를 찾을 수 없습니다.', 404);
  }

  const ancestors = rpcRows
    .filter((row) => row.is_ancestor === true)
    .sort((a, b) => a.node_depth - b.node_depth)
    .map(mapAncestor);

  const descendants = rpcRows
    .filter((row) => row.is_ancestor !== true && row.node_depth > 0)
    .map(mapDescendant)
    .sort(sortDescendants);

  const truncated = descendants.some((node) => node.totalDescendantCount > node.directInviteeCount);

  return json({
    ok: true,
    root: mapRoot(rootRow),
    ancestors,
    descendants,
    depth,
    truncated,
  });
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ ok: false, code: 'method_not_allowed', message: 'Method not allowed' }, 405);
  }
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, code: 'server_misconfigured', message: 'Missing Supabase credentials' }, 500);
  }

  const sessionResult = await requireAppSessionFromRequest(req);
  if (sessionResult.ok === false) {
    return fail(sessionResult.code, sessionResult.message, sessionResult.status);
  }

  let mode: unknown = null;
  try {
    mode = (await req.clone().json() as { mode?: unknown }).mode;
  } catch {
    mode = null;
  }
  if (mode === 'graph') {
    return resolveReferralGraph(sessionResult.session);
  }

  return resolveReferralTree(req, sessionResult.session);
});
