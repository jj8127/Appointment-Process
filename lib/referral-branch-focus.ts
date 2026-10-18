/**
 * 가지(branch) 집중 보기: 한 화면에 "기준 한 명 + 직접 추천한 사람들의 가지 합계"만 보여준다.
 * 전체 계보를 한 번에 그리지 않고 한 단계씩 들어가므로 가볍고, 누적 막대로 합계가 어디서 쌓였는지 보인다.
 */

/** 누적 막대에서 색을 주는 가지 수(나머지는 회색 하나로 묶음) */
export const BRANCH_SHARE_COLOR_LIMIT = 6;

export type BranchFocusSource = { id: string; parentId: string | null };

export type BranchFocusIndex<T extends BranchFocusSource> = {
  byId: ReadonlyMap<string, T>;
  childrenOf: (id: string) => readonly T[];
  /** 루트부터 대상까지의 경로(대상 포함). 순환이 있어도 멈춘다. */
  pathTo: (id: string) => T[];
};

export function createBranchFocusIndex<T extends BranchFocusSource>(nodes: readonly T[]): BranchFocusIndex<T> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map<string, T[]>();
  for (const node of nodes) {
    if (node.parentId === null || !byId.has(node.parentId)) continue;
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }
  const pathTo = (id: string) => {
    const path: T[] = [];
    const seen = new Set<string>();
    let current = byId.get(id);
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      path.unshift(current);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return path;
  };
  return { byId, childrenOf: (id) => children.get(id) ?? [], pathTo };
}

/** 직접 추천한 사람을 가지 값 큰 순으로(같으면 id 순) 정렬한다. */
export function buildBranchChildren<T extends BranchFocusSource>(
  index: BranchFocusIndex<T>,
  focusId: string,
  branchValue: (id: string) => number,
) {
  return [...index.childrenOf(focusId)]
    .map((node) => ({ id: node.id, value: branchValue(node.id), childCount: index.childrenOf(node.id).length }))
    .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
}

export type BranchShareSegment = { id: string | null; share: number; colorIndex: number };

/**
 * 누적 막대(100%) 구성: 양수 가지만 비중을 갖는다(음수 환수는 막대에 넣지 않고 줄에서 빨간 금액으로 보인다).
 * 앞에서부터 한도만큼 색을 주고 나머지는 회색 묶음 하나로 합쳐, 모든 양수 비중의 합이 정확히 1이 되게 한다.
 */
export function buildBranchShareSegments(items: readonly { id: string; value: number }[], colorLimit = BRANCH_SHARE_COLOR_LIMIT) {
  const positive = items.filter((item) => item.value > 0);
  const total = positive.reduce((sum, item) => sum + item.value, 0);
  const shareOf = (value: number) => (total > 0 && value > 0 ? value / total : 0);
  if (total <= 0) return { total, segments: [] as BranchShareSegment[], shareOf };
  const limit = Math.max(1, Math.floor(colorLimit));
  const colored = positive.length > limit ? positive.slice(0, limit - 1) : positive;
  const rest = positive.slice(colored.length);
  const segments: BranchShareSegment[] = colored.map((item, index) => ({ id: item.id, share: item.value / total, colorIndex: index }));
  if (rest.length) segments.push({ id: null, share: rest.reduce((sum, item) => sum + item.value, 0) / total, colorIndex: -1 });
  return { total, segments, shareOf };
}

/** 줄의 비중 표시: 1% 미만은 "<1%"로 보여 0%와 구분한다. */
export function formatBranchShare(share: number) {
  if (!(share > 0)) return '';
  if (share < 0.01) return '<1%';
  return `${Math.round(share * 100)}%`;
}
