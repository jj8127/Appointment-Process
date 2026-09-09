import type { ReferralGraphEdge, ReferralGraphNode } from '../../../types/referral-graph';

/** Entirely fictional, deterministic topology. No production-derived records or edges. */
export function syntheticReferralGraph(count = 300, branching = 3) {
  const nodes: ReferralGraphNode[] = Array.from({ length: count }, (_, index) => ({
    id: `synthetic-${String(index).padStart(3, '0')}`,
    name: `가상${String(index).padStart(3, '0')}`,
    affiliation: '', activeCode: null, nodeStatus: 'missing_code',
    signupCompleted: false, allCommissionsCompleted: false,
    directInviteeCount: 0, totalDescendantCount: 0, isViewer: index === 0,
  }));
  const edges: ReferralGraphEdge[] = [];
  for (let index = 1; index < count; index += 1) {
    let parent = Math.floor((index - 1) / branching);
    nodes[parent].directInviteeCount += 1;
    edges.push({ id: `synthetic-edge-${index}`, source: nodes[parent].id, target: nodes[index].id });
    while (parent >= 0) {
      nodes[parent].totalDescendantCount += 1;
      parent = parent === 0 ? -1 : Math.floor((parent - 1) / branching);
    }
  }
  return { nodes, edges };
}
