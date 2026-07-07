type GraphScopeEdge = {
  source: string;
  target: string;
};

export function collectReferralDownlineScopeIds(rootFcId: string, edges: GraphScopeEdge[]) {
  const rootId = rootFcId.trim();
  const scopedIds = new Set<string>();
  if (!rootId) {
    return scopedIds;
  }

  const childrenByParent = new Map<string, string[]>();
  for (const edge of edges) {
    const source = String(edge.source ?? '').trim();
    const target = String(edge.target ?? '').trim();
    if (!source || !target || source === target) {
      continue;
    }

    const children = childrenByParent.get(source) ?? [];
    children.push(target);
    childrenByParent.set(source, children);
  }

  const queue = [rootId];
  scopedIds.add(rootId);

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const currentId = queue[cursor];
    for (const childId of childrenByParent.get(currentId) ?? []) {
      if (scopedIds.has(childId)) {
        continue;
      }
      scopedIds.add(childId);
      queue.push(childId);
    }
  }

  return scopedIds;
}
