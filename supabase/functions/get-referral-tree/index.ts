import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  getEnv,
  getAppSessionTokenFromRequest,
  parseAppSessionToken,
} from '../_shared/request-board-auth.ts';

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

type SessionPayload = NonNullable<Awaited<ReturnType<typeof parseAppSessionToken>>>;

type TreeRpcRow = {
  fc_id: string;
  name: string | null;
  affiliation: string | null;
  active_code: string | null;
  parent_fc_id: string | null;
  node_depth: number;
  relationship_source: 'structured' | 'confirmed' | 'both' | 'root' | null;
  direct_invitee_count: number | null;
  total_descendant_count: number | null;
  is_ancestor: boolean;
};

type ProfileRow = {
  id: string;
  name: string | null;
  affiliation: string | null;
  recommender_fc_id: string | null;
  is_manager_referral_shadow: boolean | null;
};

type EdgeSource = 'structured' | 'confirmed' | 'both';

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
  relationshipSource: 'structured' | 'confirmed' | 'both';
};

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

function mergeRelationshipSource(
  current: EdgeSource | undefined,
  next: 'structured' | 'confirmed',
): EdgeSource {
  if (!current) {
    return next;
  }
  if (current === next || current === 'both') {
    return current;
  }
  return 'both';
}

function combineEdgeSources(current: EdgeSource | undefined, next: EdgeSource): EdgeSource {
  if (!current) {
    return next;
  }
  if (current === next || current === 'both' || next === 'both') {
    return current === 'both' ? current : next;
  }
  return 'both';
}

async function fetchProfilesByIds(ids: string[]) {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) {
    return new Map<string, ProfileRow>();
  }

  const { data, error } = await supabase
    .from('fc_profiles')
    .select('id, name, affiliation, recommender_fc_id, is_manager_referral_shadow')
    .in('id', uniqueIds);

  if (error) {
    throw error;
  }

  const map = new Map<string, ProfileRow>();
  for (const row of (data ?? []) as ProfileRow[]) {
    map.set(row.id, row);
  }
  return map;
}

async function fetchActiveCodesByFcIds(ids: string[]) {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) {
    return new Map<string, string | null>();
  }

  const { data, error } = await supabase
    .from('referral_codes')
    .select('fc_id, code, created_at, id')
    .in('fc_id', uniqueIds)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });

  if (error) {
    throw error;
  }

  const map = new Map<string, string | null>();
  for (const row of (data ?? []) as { fc_id: string; code: string | null }[]) {
    if (!map.has(row.fc_id)) {
      map.set(row.fc_id, row.code ?? null);
    }
  }
  return map;
}

async function fetchChildEdges(parentIds: string[]) {
  const uniqueParentIds = Array.from(new Set(parentIds.filter(Boolean)));
  if (uniqueParentIds.length === 0) {
    return [] as EdgeRecord[];
  }

  const [
    { data: structuredRows, error: structuredError },
    { data: confirmedRows, error: confirmedError },
  ] = await Promise.all([
    supabase
      .from('fc_profiles')
      .select('id, recommender_fc_id, is_manager_referral_shadow')
      .in('recommender_fc_id', uniqueParentIds),
    supabase
      .from('referral_attributions')
      .select('inviter_fc_id, invitee_fc_id')
      .in('inviter_fc_id', uniqueParentIds)
      .eq('status', 'confirmed'),
  ]);

  if (structuredError) {
    throw structuredError;
  }
  if (confirmedError) {
    throw confirmedError;
  }

  const edgeMap = new Map<string, EdgeRecord>();

  for (const row of (structuredRows ?? []) as {
    id: string;
    recommender_fc_id: string | null;
    is_manager_referral_shadow: boolean | null;
  }[]) {
    const parentFcId = row.recommender_fc_id ?? null;
    if (!parentFcId || row.id === parentFcId || row.is_manager_referral_shadow === true) {
      continue;
    }

    const key = `${parentFcId}:${row.id}`;
    const existing = edgeMap.get(key);
    edgeMap.set(key, {
      parentFcId,
      childFcId: row.id,
      relationshipSource: mergeRelationshipSource(existing?.relationshipSource, 'structured'),
    });
  }

  const confirmedInviteeIds = Array.from(new Set(
    ((confirmedRows ?? []) as { inviter_fc_id: string | null; invitee_fc_id: string | null }[])
      .map((row) => row.invitee_fc_id)
      .filter((id): id is string => Boolean(id)),
  ));
  const confirmedProfiles = await fetchProfilesByIds(confirmedInviteeIds);

  for (const row of (confirmedRows ?? []) as { inviter_fc_id: string | null; invitee_fc_id: string | null }[]) {
    const parentFcId = row.inviter_fc_id ?? null;
    const childFcId = row.invitee_fc_id ?? null;
    if (!parentFcId || !childFcId || parentFcId === childFcId) {
      continue;
    }

    const childProfile = confirmedProfiles.get(childFcId);
    if (childProfile?.is_manager_referral_shadow === true) {
      continue;
    }

    const key = `${parentFcId}:${childFcId}`;
    const existing = edgeMap.get(key);
    edgeMap.set(key, {
      parentFcId,
      childFcId,
      relationshipSource: mergeRelationshipSource(existing?.relationshipSource, 'confirmed'),
    });
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

async function buildFallbackTreeRows(rootFcId: string, depth: number) {
  const safeDepth = Math.max(1, Math.min(5, Math.trunc(depth || 2)));
  const profileMap = await fetchProfilesByIds([rootFcId]);
  const rootProfile = profileMap.get(rootFcId);
  if (!rootProfile) {
    return [] as TreeRpcRow[];
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
      relationship_source: 'structured',
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

  while (frontier.length > 0 && traversalDepth < 20) {
    traversalDepth += 1;
    const edges = await fetchChildEdges(frontier);
    const nextFrontier: string[] = [];

    for (const edge of edges) {
      if (!childrenByParent.has(edge.parentFcId)) {
        childrenByParent.set(edge.parentFcId, new Map());
      }

      const existingSource = childrenByParent.get(edge.parentFcId)?.get(edge.childFcId);
      childrenByParent
        .get(edge.parentFcId)
        ?.set(edge.childFcId, combineEdgeSources(existingSource, edge.relationshipSource));
    }

    const parentIds = edges.map((edge) => edge.childFcId);
    const childProfiles = await fetchProfilesByIds(parentIds);

    for (const edge of edges) {
      const childProfile = childProfiles.get(edge.childFcId);
      if (!childProfile || childProfile.is_manager_referral_shadow === true) {
        continue;
      }

      subtreeIds.add(edge.childFcId);

      if (!seenDescendants.has(edge.childFcId)) {
        seenDescendants.add(edge.childFcId);
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

  return [rootRow, ...ancestorRows, ...descendantRows];
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
    const rows = await buildFallbackTreeRows(rootFcId, depth);
    return { rows };
  } catch (fallbackError) {
    console.error('[get-referral-tree] rpc and fallback both failed', {
      rpcError: error.message,
      fallbackError: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
    });
    return { error };
  }
}

async function resolveSelfProfile(session: SessionPayload) {
  const sessionPhone = cleanPhone(session.phone ?? '');
  if (sessionPhone.length !== 11) {
    return { error: fail('unauthorized', '인증이 필요합니다.', 401) };
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

  if (!profileResult.data?.id && managerAccount?.id) {
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
    return { error: fail('unauthorized', '인증이 필요합니다.', 401) };
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
  const relationshipSource = row.relationship_source === 'confirmed'
    ? 'confirmed'
    : row.relationship_source === 'both'
      ? 'both'
      : 'structured';

  return {
    fcId: row.fc_id,
    parentFcId: row.parent_fc_id ?? null,
    depth: Number(row.node_depth ?? 0),
    name: row.name ?? null,
    affiliation: row.affiliation ?? null,
    code: row.active_code ?? null,
    directInviteeCount: Number(row.direct_invitee_count ?? 0),
    totalDescendantCount: Number(row.total_descendant_count ?? 0),
    relationshipSource,
  };
}

function sortDescendants(a: ReferralDescendant, b: ReferralDescendant) {
  if (a.depth !== b.depth) {
    return a.depth - b.depth;
  }

  return (a.name ?? '').localeCompare(b.name ?? '', 'ko');
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

  const token = getAppSessionTokenFromRequest(req);
  if (!token) {
    return fail('unauthorized', '인증이 필요합니다.', 401);
  }

  const session = await parseAppSessionToken(token);
  if (!session) {
    return fail('unauthorized', '인증이 필요합니다.', 401);
  }

  return resolveReferralTree(req, session);
});
