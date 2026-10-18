/**
 * 모바일 "전체 그래프" 집단 배치(관리자 웹과 같은 알고리즘)의 앱 쪽 연결부.
 * 계산 규칙은 서버와 함께 쓰는 _shared 하나뿐이고, 여기서는 서버 응답 확인·좌표 Map 변환·기억용 키만 다룬다.
 */
import type { ReferralGraphEdge, ReferralGraphNode, ReferralGraphPoint } from '@/types/referral-graph';

import {
  buildReferralMobileClusterLayout, REFERRAL_MOBILE_CLUSTER_LAYOUT_VERSION, referralMobileClusterRadius,
  type ReferralClusterLayoutPayload,
} from '../supabase/functions/_shared/referral-graph-mobile-cluster';

export { REFERRAL_MOBILE_CLUSTER_LAYOUT_VERSION as MOBILE_CLUSTER_LAYOUT_VERSION };

/** 같은 사람·같은 연결이면 같은 키(순서 무관). FNV-1a 계열 32bit 두 개로 충돌 가능성을 낮춘다. */
export function referralClusterLayoutKey(nodes: readonly ReferralGraphNode[], edges: readonly ReferralGraphEdge[]) {
  const parts = [
    ...nodes.map((node) => `n:${node.id}:${Math.round(referralMobileClusterRadius(node.totalDescendantCount) * 10)}`).sort(),
    ...edges.map((edge) => `e:${edge.source}>${edge.target}`).sort(),
  ];
  let a = 0x811c9dc5, b = 0x01000193 ^ parts.length;
  for (const part of parts) {
    for (let i = 0; i < part.length; i += 1) {
      const code = part.charCodeAt(i);
      a = Math.imul(a ^ code, 0x01000193);
      b = Math.imul(b ^ code, 0x5bd1e995);
    }
    a = Math.imul(a ^ 0x2c, 0x01000193);
  }
  return `v${REFERRAL_MOBILE_CLUSTER_LAYOUT_VERSION}-${nodes.length}-${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
}

/** 서버가 보낸 좌표(또는 저장본)를 확인한다. 버전이 다르거나 사람이 하나라도 빠지면 null → 앱이 직접 계산 */
export function clusterPositionsFromPayload(payload: unknown, nodes: readonly ReferralGraphNode[]) {
  if (!payload || typeof payload !== 'object') return null;
  const { version, positions: rows } = payload as Partial<ReferralClusterLayoutPayload>;
  if (version !== REFERRAL_MOBILE_CLUSTER_LAYOUT_VERSION || !Array.isArray(rows)) return null;
  const positions = new Map<string, ReferralGraphPoint>();
  for (const row of rows) {
    if (!Array.isArray(row) || typeof row[0] !== 'string' || !Number.isFinite(row[1]) || !Number.isFinite(row[2])) return null;
    positions.set(row[0], { x: row[1], y: row[2] });
  }
  return nodes.every((node) => positions.has(node.id)) ? positions : null;
}

export function buildMobileClusterPositions(nodes: readonly ReferralGraphNode[], edges: readonly ReferralGraphEdge[]) {
  return clusterPositionsFromPayload(buildReferralMobileClusterLayout(nodes, edges), nodes)!;
}

export function serializeClusterPositions(positions: ReadonlyMap<string, ReferralGraphPoint>) {
  const payload: ReferralClusterLayoutPayload = { version: REFERRAL_MOBILE_CLUSTER_LAYOUT_VERSION,
    positions: [...positions].map(([id, point]) => [id, point.x, point.y]) };
  return JSON.stringify(payload);
}

/** 저장본이 깨졌거나 사람 목록과 맞지 않으면 null(다시 계산) */
export function parseClusterPositions(raw: string | null, nodes: readonly ReferralGraphNode[]) {
  if (!raw) return null;
  try {
    return clusterPositionsFromPayload(JSON.parse(raw), nodes);
  } catch {
    return null;
  }
}
