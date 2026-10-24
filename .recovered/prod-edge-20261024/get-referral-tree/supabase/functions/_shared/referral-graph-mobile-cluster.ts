/**
 * 모바일 "전체 그래프"용 집단 배치(관리자 웹과 같은 알고리즘).
 * 서버(get-referral-tree)가 계산해 좌표로 보내고, 서버가 보내지 않으면 앱이 같은 함수로 직접 계산한다.
 * 노드 크기 규칙도 여기 하나만 두어 서버·앱이 항상 같은 좌표를 만든다.
 */
import { buildReferralClusterLayout } from './referral-graph-cluster-layout.ts';

/** 배치 규칙이나 크기 규칙을 바꾸면 올린다(앱이 기억해 둔 옛 좌표를 버리는 기준) */
export const REFERRAL_MOBILE_CLUSTER_LAYOUT_VERSION = 1;
/** 노드 아래 이름 라벨이 이웃과 겹치지 않도록 반지름에 더하는 여유 */
const LABEL_ROOM = 16;

export type ReferralClusterLayoutPayload = {
  version: typeof REFERRAL_MOBILE_CLUSTER_LAYOUT_VERSION;
  /** [노드 id, x, y] — 소수 첫째 자리까지 */
  positions: [string, number, number][];
};

/** 모바일 그래프 노드 반지름(하위 인원 수에 대해 로그로 커지고 상한이 있다) */
export function referralMobileNodeRadius(totalDescendantCount: number) {
  const safeCount = Math.max(0, Number(totalDescendantCount) || 0);
  return (4.6 + Math.min(Math.log1p(safeCount) * 2.15, 9.4)) * 1.25;
}

export function referralMobileClusterRadius(totalDescendantCount: number) {
  return referralMobileNodeRadius(totalDescendantCount) + LABEL_ROOM;
}

export function buildReferralMobileClusterLayout(
  nodes: readonly { id: string; totalDescendantCount: number }[],
  edges: readonly { source: string; target: string }[],
): ReferralClusterLayoutPayload {
  const layout = buildReferralClusterLayout({
    nodes: nodes.map((node) => ({ id: node.id, radius: referralMobileClusterRadius(node.totalDescendantCount) })),
    edges: edges.map((edge) => ({ source: edge.source, target: edge.target })),
  });
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    version: REFERRAL_MOBILE_CLUSTER_LAYOUT_VERSION,
    positions: layout.positions.map((position) => [position.id, round(position.x), round(position.y)]),
  };
}
