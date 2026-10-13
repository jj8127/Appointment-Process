import type { DescendantNode } from '../components/ReferralTreeNode.tsx';
import type {
  ReferralGraphEdge,
  ReferralGraphNode,
  ReferralGraphResponse,
} from '../types/referral-graph.ts';
import { isNotificationUuid } from './notification-target';

export type ParsedMyReferralCode = {
  code: string;
  recommender: string | null;
  recommenderAffiliation: string | null;
  recommenderCode: string | null;
};

export type ParsedReferralTreeRoot = {
  fcId: string;
  name: string | null;
  affiliation: string | null;
  code: string | null;
  directInviteeCount: number;
  totalDescendantCount: number;
};

export type ParsedReferralAncestor = {
  fcId: string;
  name: string | null;
  affiliation: string | null;
  code: string | null;
};

export type ParsedReferralTree = {
  root: ParsedReferralTreeRoot;
  ancestors: ParsedReferralAncestor[];
  descendants: DescendantNode[];
  depth: number;
  truncated: boolean;
};

export type ParsedSignupReferralSearchResult = {
  fcId: string;
  name: string;
  affiliation: string;
  code: string;
};

export type ParsedInvitee = {
  id: string;
  inviteeName: string | null;
  inviteePhone: string;
  status: 'captured' | 'pending_signup' | 'confirmed' | 'rejected' | 'cancelled' | 'overridden';
  capturedAt: string;
  confirmedAt: string | null;
};

const RESPONSE_ERROR = '추천 조회 응답을 확인하지 못했습니다. 다시 시도해주세요.';

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const isNonEmptyString = (value: unknown): value is string => (
  typeof value === 'string' && value.trim().length > 0
);

const isNullableString = (value: unknown): value is string | null => (
  value === null || typeof value === 'string'
);

const isNullableText = (value: unknown): value is string | null => (
  value === null || isNonEmptyString(value)
);

const isCount = (value: unknown): value is number => (
  Number.isSafeInteger(value) && Number(value) >= 0
);

const isTimestamp = (value: unknown): value is string => (
  typeof value === 'string' && Number.isFinite(Date.parse(value))
);

const isInviteeStatus = (value: unknown): value is ParsedInvitee['status'] => (
  value === 'captured'
  || value === 'pending_signup'
  || value === 'confirmed'
  || value === 'rejected'
  || value === 'cancelled'
  || value === 'overridden'
);

function requireValid(condition: unknown): asserts condition {
  if (!condition) throw new Error(RESPONSE_ERROR);
}

function parseTreeRoot(value: unknown): ParsedReferralTreeRoot {
  requireValid(isRecord(value));
  requireValid(
    isNonEmptyString(value.fcId)
    && isNullableString(value.name)
    && isNullableString(value.affiliation)
    && isNullableText(value.code)
    && isCount(value.directInviteeCount)
    && isCount(value.totalDescendantCount)
    && Number(value.totalDescendantCount) >= Number(value.directInviteeCount),
  );
  return value as ParsedReferralTreeRoot;
}

function parseAncestor(value: unknown): ParsedReferralAncestor {
  requireValid(isRecord(value));
  requireValid(
    isNonEmptyString(value.fcId)
    && isNullableString(value.name)
    && isNullableString(value.affiliation)
    && isNullableText(value.code),
  );
  return value as ParsedReferralAncestor;
}

function parseDescendant(value: unknown, maxDepth: number): DescendantNode {
  requireValid(isRecord(value));
  requireValid(
    isNonEmptyString(value.fcId)
    && isNonEmptyString(value.parentFcId)
    && isNullableString(value.name)
    && isNullableString(value.affiliation)
    && isNullableText(value.code)
    && isCount(value.directInviteeCount)
    && isCount(value.totalDescendantCount)
    && Number(value.totalDescendantCount) >= Number(value.directInviteeCount)
    && Number.isSafeInteger(value.depth)
    && Number(value.depth) >= 1
    && Number(value.depth) <= maxDepth
    && value.relationshipSource === 'linked',
  );
  return value as DescendantNode;
}

function parseGraphNode(value: unknown): ReferralGraphNode {
  requireValid(isRecord(value));
  requireValid(
    isNonEmptyString(value.id)
    && isNonEmptyString(value.name)
    && isNonEmptyString(value.affiliation)
    && isNullableText(value.activeCode)
    && (value.nodeStatus === 'has_active_code'
      || value.nodeStatus === 'code_disabled'
      || value.nodeStatus === 'missing_code')
    && typeof value.signupCompleted === 'boolean'
    && typeof value.allCommissionsCompleted === 'boolean'
    && isCount(value.directInviteeCount)
    && isCount(value.totalDescendantCount)
    && Number(value.totalDescendantCount) >= Number(value.directInviteeCount)
    && typeof value.isViewer === 'boolean',
  );
  return value as ReferralGraphNode;
}

function parseGraphEdge(value: unknown): ReferralGraphEdge {
  requireValid(isRecord(value));
  requireValid(
    isNonEmptyString(value.id)
    && isNonEmptyString(value.source)
    && isNonEmptyString(value.target)
    && value.source !== value.target,
  );
  return value as ReferralGraphEdge;
}

export function parseMyReferralCodeResponse(value: unknown): ParsedMyReferralCode {
  requireValid(isRecord(value));
  requireValid(
    value.ok === true
    && isNonEmptyString(value.code)
    && isNonEmptyString(value.codeId)
    && isNonEmptyString(value.createdAt)
    && isNullableText(value.recommender)
    && isNullableText(value.recommenderAffiliation)
    && isNullableText(value.recommenderCode),
  );

  return {
    code: value.code.trim(),
    recommender: value.recommender === null ? null : value.recommender.trim(),
    recommenderAffiliation: value.recommenderAffiliation === null
      ? null
      : value.recommenderAffiliation.trim(),
    recommenderCode: value.recommenderCode === null ? null : value.recommenderCode.trim(),
  };
}

export function parseReferralTreeResponse(
  value: unknown,
  expected: { depth: number; rootFcId?: string },
): ParsedReferralTree {
  requireValid(isRecord(value));
  requireValid(
    value.ok === true
    && value.depth === expected.depth
    && typeof value.truncated === 'boolean'
    && Array.isArray(value.ancestors)
    && Array.isArray(value.descendants)
    && value.ancestors.length <= 100
    && value.descendants.length <= 10_000,
  );

  const root = parseTreeRoot(value.root);
  if (expected.rootFcId !== undefined) {
    requireValid(root.fcId === expected.rootFcId);
  }
  const ancestors = value.ancestors.map(parseAncestor);
  const descendants = value.descendants.map((row) => parseDescendant(row, expected.depth));
  const ids = new Set<string>([root.fcId]);
  for (const ancestor of ancestors) {
    requireValid(!ids.has(ancestor.fcId));
    ids.add(ancestor.fcId);
  }
  const descendantIds = new Set<string>();
  const descendantDepths = new Map<string, number>();
  for (const node of descendants) {
    requireValid(!ids.has(node.fcId) && !descendantIds.has(node.fcId));
    descendantIds.add(node.fcId);
    descendantDepths.set(node.fcId, node.depth);
  }
  for (const node of descendants) {
    const parentDepth = node.parentFcId === root.fcId
      ? 0
      : node.parentFcId === null
        ? undefined
        : descendantDepths.get(node.parentFcId);
    requireValid(parentDepth !== undefined && parentDepth === node.depth - 1);
  }
  requireValid(descendants.length <= root.totalDescendantCount);
  const childCounts = new Map<string, number>();
  for (const node of descendants) {
    const parentFcId = node.parentFcId;
    requireValid(isNonEmptyString(parentFcId));
    childCounts.set(parentFcId, (childCounts.get(parentFcId) ?? 0) + 1);
  }
  requireValid((childCounts.get(root.fcId) ?? 0) === root.directInviteeCount);
  for (const node of descendants) {
    if (node.depth < expected.depth) {
      requireValid((childCounts.get(node.fcId) ?? 0) === node.directInviteeCount);
    }
  }

  return {
    root,
    ancestors,
    descendants,
    depth: value.depth,
    truncated: value.truncated,
  };
}

export function parseReferralGraphResponse(value: unknown): ReferralGraphResponse {
  requireValid(isRecord(value));
  requireValid(
    value.ok === true
    && value.mode === 'graph'
    && Array.isArray(value.nodes)
    && value.nodes.length > 0
    && value.nodes.length <= 300
    && Array.isArray(value.edges)
    && value.edges.length === value.nodes.length - 1
    && isRecord(value.permissions)
    && value.permissions.canMutate === false
    && value.permissions.scope === 'downline'
    && isNonEmptyString(value.permissions.rootFcId)
    && typeof value.truncated === 'boolean',
  );

  const nodes = value.nodes.map(parseGraphNode);
  const nodeIds = new Set<string>();
  for (const node of nodes) {
    requireValid(!nodeIds.has(node.id));
    nodeIds.add(node.id);
  }
  const rootFcId = value.permissions.rootFcId;
  requireValid(nodeIds.has(rootFcId));
  requireValid(nodes.filter((node) => node.isViewer).length === 1);
  requireValid(nodes.some((node) => node.id === rootFcId && node.isViewer));

  const edges = value.edges.map(parseGraphEdge);
  const edgeIds = new Set<string>();
  const parentByNode = new Map<string, string>();
  const childrenByNode = new Map<string, string[]>();
  for (const edge of edges) {
    requireValid(
      nodeIds.has(edge.source)
      && nodeIds.has(edge.target)
      && !edgeIds.has(edge.id),
    );
    requireValid(edge.target !== rootFcId && !parentByNode.has(edge.target));
    edgeIds.add(edge.id);
    parentByNode.set(edge.target, edge.source);
    childrenByNode.set(edge.source, [...(childrenByNode.get(edge.source) ?? []), edge.target]);
  }
  requireValid(parentByNode.size === nodes.length - 1);
  const reachable = new Set<string>([rootFcId]);
  const pending = [rootFcId];
  while (pending.length > 0) {
    const parent = pending.pop();
    if (!parent) break;
    for (const child of childrenByNode.get(parent) ?? []) {
      requireValid(!reachable.has(child));
      reachable.add(child);
      pending.push(child);
    }
  }
  requireValid(reachable.size === nodes.length);

  return value as ReferralGraphResponse;
}

export function parseSignupReferralSearchResponse(value: unknown): ParsedSignupReferralSearchResult[] {
  requireValid(isRecord(value) && value.ok === true && Array.isArray(value.results));
  requireValid(value.results.length <= 10);

  const results = value.results.map((row) => {
    requireValid(isRecord(row));
    requireValid(
      isNonEmptyString(row.fcId)
      && isNonEmptyString(row.name)
      && typeof row.affiliation === 'string'
      && isNonEmptyString(row.code),
    );
    return row as ParsedSignupReferralSearchResult;
  });
  requireValid(new Set(results.map((row) => row.fcId)).size === results.length);
  requireValid(new Set(results.map((row) => row.code)).size === results.length);
  return results;
}

export function parseMyInviteesResponse(value: unknown): ParsedInvitee[] {
  requireValid(isRecord(value) && value.ok === true && Array.isArray(value.invitees));
  requireValid(value.invitees.length <= 10_000);

  const invitees = value.invitees.map((row) => {
    requireValid(isRecord(row));
    requireValid(
      isNotificationUuid(row.id)
      && isNullableString(row.inviteeName)
      && typeof row.inviteePhone === 'string'
      && /^\d{3}-\*{4}-\d{4}$/.test(row.inviteePhone)
      && isInviteeStatus(row.status)
      && isTimestamp(row.capturedAt)
      && (row.confirmedAt === null || isTimestamp(row.confirmedAt)),
    );
    if (row.status === 'confirmed') {
      requireValid(row.confirmedAt !== null);
    }
    return row as ParsedInvitee;
  });

  requireValid(new Set(invitees.map((row) => row.id)).size === invitees.length);
  return invitees;
}
