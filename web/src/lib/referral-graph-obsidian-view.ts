/**
 * 집단 배치 그래프에 얹는 Obsidian식 보기 규칙. 배치(겹침 없는 방사형)는 바꾸지 않고 그리는 방식만 정한다.
 * Obsidian 실측: 호버하면 대상·이웃은 그대로, 나머지 노드·링크는 0.2로 흐려지고 대상은 약 1.2배 커진다.
 * 라벨은 화면상 글자가 충분히 클 때만 나타나고 작아지면 서서히 사라진다.
 */

export const OBSIDIAN_DIM_ALPHA = 0.2;
export const OBSIDIAN_HOVER_GROW = 0.2;
/** 사용자 선호: 짧은 기본값보다 느리게(약 2배). 60fps 기준 프레임당 6%면 약 0.8초에 95% 도달. */
export const OBSIDIAN_EASE_PER_FRAME = 0.06;

export type ReferralGraphEndpoint = string | { id: string };
const endpointId = (value: ReferralGraphEndpoint) => typeof value === 'string' ? value : value.id;

export function buildReferralNeighborIndex(edges: readonly { source: ReferralGraphEndpoint; target: ReferralGraphEndpoint }[]) {
  const neighbors = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    const set = neighbors.get(a) ?? new Set<string>();
    set.add(b);
    neighbors.set(a, set);
  };
  for (const edge of edges) {
    const source = endpointId(edge.source);
    const target = endpointId(edge.target);
    if (source === target) continue;
    add(source, target);
    add(target, source);
  }
  return neighbors;
}

/** 화면 글자 크기(px)로 라벨 투명도를 정한다: 5px 이하 숨김, 9px 이상 완전히 보임. */
export function referralLabelAlpha(fontPx: number) {
  if (!Number.isFinite(fontPx)) return 0;
  return Math.max(0, Math.min(1, (fontPx - 5) / 4));
}

/** 호버 강조가 켜지는 정도(mix 0→1)에 따른 노드 투명도. */
export function referralHoverNodeAlpha(inFocusSet: boolean, mix: number) {
  if (inFocusSet) return 1;
  return 1 - (1 - OBSIDIAN_DIM_ALPHA) * Math.max(0, Math.min(1, mix));
}

/** 프레임 시간에 독립적인 지수 감속. */
export function easeTowards(current: number, target: number, elapsedMs: number, perFrame = OBSIDIAN_EASE_PER_FRAME) {
  const frames = Math.max(0, elapsedMs) / (1000 / 60);
  const next = target + (current - target) * Math.pow(1 - perFrame, frames);
  return Math.abs(next - target) < 1e-3 ? target : next;
}
