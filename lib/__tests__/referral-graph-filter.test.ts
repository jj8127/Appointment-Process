import { createReferralGraphFilter } from '../referral-graph-filter';
import { filterReferralGraphNodes } from '../referral-graph-native';
import type { ReferralGraphEdge, ReferralGraphNode, ReferralGraphStatusFilter } from '@/types/referral-graph';

function node(id: string, overrides: Partial<ReferralGraphNode> = {}): ReferralGraphNode {
  return { id, name: `가상 ${id}`, affiliation: '가상 소속', activeCode: null,
    nodeStatus: 'missing_code', signupCompleted: false, allCommissionsCompleted: false,
    directInviteeCount: 0, totalDescendantCount: 0, isViewer: false, ...overrides };
}

const nodes = [
  node('root', { isViewer: true }),
  node('a', { name: '가람 Alpha', signupCompleted: true, activeCode: 'AbC-123' }),
  node('b', { name: '가람 Beta', signupCompleted: true, allCommissionsCompleted: true }),
  node('c', { affiliation: '새 소속' }),
];
const edges: ReferralGraphEdge[] = [
  { id: 'root-a', source: 'root', target: 'a' },
  { id: 'a-b', source: 'a', target: 'b' },
];

describe('snapshot-scoped referral graph filter', () => {
  it('preserves existing status, search, neighborhood, and induced-edge semantics', () => {
    const select = createReferralGraphFilter(nodes, edges);
    const statuses: ReferralGraphStatusFilter[] = ['all', 'commissioned', 'registered', 'preregistered'];
    const neighborhoods = [null, new Set<string>(), new Set(['root', 'a']), new Set(['a', 'b', 'missing'])];
    for (const statusFilter of statuses) for (const searchTerm of ['', '  ', '가람', 'ALPHA', 'abc-123', '새 소속', '없음']) {
      for (const neighborhood of neighborhoods) {
        const options = { statusFilter, searchTerm, neighborhood };
        const expectedNodes = filterReferralGraphNodes({ nodes, ...options });
        const expectedIds = new Set(expectedNodes.map((item) => item.id));
        expect(select(options)).toEqual({ nodes: expectedNodes,
          edges: edges.filter((edge) => expectedIds.has(edge.source) && expectedIds.has(edge.target)) });
      }
    }
  });

  it('reuses graph arrays for different queries or sets with identical ordered members', () => {
    const select = createReferralGraphFilter(nodes, edges);
    const first = select({ statusFilter: 'all', searchTerm: '가람' });
    const padded = select({ statusFilter: 'all', searchTerm: '  가람  ' });
    const sameNeighborhood = select({ statusFilter: 'all', searchTerm: '', neighborhood: new Set(['b', 'a']) });
    expect(padded).toBe(first);
    expect(sameNeighborhood).toBe(first);
    expect(first.nodes).toEqual([nodes[1], nodes[2]]);
    expect(first.edges).toEqual([edges[1]]);

    const empty = select({ statusFilter: 'all', searchTerm: '없는 검색' });
    expect(select({ statusFilter: 'registered', searchTerm: '다른 없는 검색' })).toBe(empty);
  });

  it('keeps unchanged edge references when only a disconnected visible node changes', () => {
    const select = createReferralGraphFilter(nodes, edges);
    const all = select({ statusFilter: 'all', searchTerm: '' });
    const connected = select({ statusFilter: 'all', searchTerm: '', neighborhood: new Set(['root', 'a', 'b']) });
    expect(connected.nodes).not.toBe(all.nodes);
    expect(connected.edges).toBe(all.edges);
    expect(connected.nodes).toEqual(nodes.slice(0, 3));
  });

  it('uses fresh objects, edges, and order for new snapshots even when IDs match', () => {
    const oldSelect = createReferralGraphFilter(nodes, edges);
    const oldResult = oldSelect({ statusFilter: 'all', searchTerm: '' });
    const updatedNode = { ...nodes[1], name: '새 가상 이름', allCommissionsCompleted: true };
    const updatedEdge = { ...edges[0], target: 'c' };
    const updatedNodes = [nodes[3], updatedNode, nodes[0]];
    const select = createReferralGraphFilter(updatedNodes, [updatedEdge]);
    const result = select({ statusFilter: 'all', searchTerm: '' });
    expect(result.nodes).toEqual(updatedNodes);
    expect(result.nodes[1]).toBe(updatedNode);
    expect(result.edges[0]).toBe(updatedEdge);
    expect(result.nodes).not.toBe(oldResult.nodes);
    expect(select({ statusFilter: 'commissioned', searchTerm: '새 가상' }).nodes).toEqual([updatedNode]);
    expect(oldSelect({ statusFilter: 'all', searchTerm: '' })).toBe(oldResult);
  });
});
