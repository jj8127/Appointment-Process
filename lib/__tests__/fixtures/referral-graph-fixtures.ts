import topology from './referral-downline-topology.json';
import type { ReferralGraphEdge, ReferralGraphNode } from '@/types/referral-graph';

export function graphFromParents(parents: number[], lengths?: number[]) {
  const nodes: ReferralGraphNode[] = parents.map((parent, index) => ({
    id: `fictional-${String(index).padStart(3, '0')}`,
    // Synthetic Hangul keeps fixture ordering deterministic and exercises varied widths.
    name: String.fromCharCode(0xac00 + index) + '가'.repeat(Math.max(0,
      // Include the ellipsis-width boundary in the fictional ten-character case.
      (lengths?.[index] === 10 ? 11 : lengths?.[index] ?? 3) - 1)),
    affiliation: '', activeCode: null, nodeStatus: 'missing_code',
    signupCompleted: false, allCommissionsCompleted: false,
    directInviteeCount: parents.filter((value) => value === index).length,
    totalDescendantCount: 0, isViewer: index === 0,
  }));
  const edges: ReferralGraphEdge[] = parents.flatMap((parent, index) => parent < 0 ? [] : [{
    id: `edge-${index}`, source: nodes[parent].id, target: nodes[index].id,
  }]);
  for (let index = 1; index < nodes.length; index += 1) {
    const seen = new Set<number>([index]);
    let parent = parents[index];
    while (parent >= 0 && !seen.has(parent)) {
      seen.add(parent);
      nodes[parent].totalDescendantCount += 1;
      parent = parents[parent];
    }
  }
  return { nodes, edges };
}

export const fictionalStressDownline = () => graphFromParents(topology.parents, topology.labelLengths);
export const graphCases = () => [
  { name: 'fictional 295-node mixed-depth topology', ...fictionalStressDownline() },
  { name: '300-node star', ...graphFromParents([-1, ...Array(299).fill(0)]) },
  { name: 'heavy branch and small siblings', ...graphFromParents([-1, 0, 0, 0, ...Array(296).fill(1)]) },
  { name: 'balanced tree', ...graphFromParents(Array.from({ length: 300 }, (_, index) => index ? Math.floor((index - 1) / 3) : -1)) },
  { name: 'deep chain', ...graphFromParents(Array.from({ length: 50 }, (_, index) => index - 1)) },
  { name: 'long labels', ...graphFromParents([-1, ...Array(99).fill(0)], Array(100).fill(20)) },
];
