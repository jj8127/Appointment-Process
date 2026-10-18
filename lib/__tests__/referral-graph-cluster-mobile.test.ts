import { buildReferralClusterLayout } from '../../supabase/functions/_shared/referral-graph-cluster-layout';
import {
  buildReferralMobileClusterLayout, referralMobileClusterRadius,
} from '../../supabase/functions/_shared/referral-graph-mobile-cluster';
import type { ReferralGraphEdge, ReferralGraphNode } from '@/types/referral-graph';

import {
  buildMobileClusterPositions, clusterPositionsFromPayload, MOBILE_CLUSTER_LAYOUT_VERSION, parseClusterPositions,
  referralClusterLayoutKey, serializeClusterPositions,
} from '../referral-graph-cluster-mobile';
import { fictionalReferralGraph } from '../referral-dev-fictional';
import { getReferralGraphNodeRadius } from '../referral-graph-native';

const graph = fictionalReferralGraph();
const nodes: ReferralGraphNode[] = graph.nodes;
const edges: ReferralGraphEdge[] = graph.edges;

describe('mobile full graph uses the admin web cluster layout, computed on the server or the phone', () => {
  it('server payload and phone computation give the admin layout coordinates for the same people and sizes', () => {
    const admin = buildReferralClusterLayout({
      nodes: nodes.map((node) => ({ id: node.id, radius: referralMobileClusterRadius(node.totalDescendantCount) })),
      edges: edges.map((edge) => ({ source: edge.source, target: edge.target })),
    });
    const server = clusterPositionsFromPayload(buildReferralMobileClusterLayout(nodes, edges), nodes)!;
    const phone = buildMobileClusterPositions(nodes, edges);
    expect(server.size).toBe(nodes.length);
    for (const position of admin.positions) {
      expect(server.get(position.id)!.x).toBeCloseTo(position.x, 1);
      expect(phone.get(position.id)).toEqual(server.get(position.id));
    }
  });

  it('shares one node-size rule between the server layout and the mobile renderer', () => {
    for (const count of [0, 3, 40, 999]) {
      expect(referralMobileClusterRadius(count)).toBeCloseTo(getReferralGraphNodeRadius(count) + 16);
    }
  });

  it('rejects a server or stored layout from another version or missing anyone, so the phone recomputes', () => {
    const payload = buildReferralMobileClusterLayout(nodes, edges);
    expect(payload.version).toBe(MOBILE_CLUSTER_LAYOUT_VERSION);
    expect(clusterPositionsFromPayload({ ...payload, version: 999 }, nodes)).toBeNull();
    expect(clusterPositionsFromPayload({ ...payload, positions: payload.positions.slice(1) }, nodes)).toBeNull();
    expect(clusterPositionsFromPayload(undefined, nodes)).toBeNull();
    expect(clusterPositionsFromPayload({ version: payload.version, positions: [['x', 'bad', 1]] }, nodes)).toBeNull();
  });

  it('keys the remembered layout by the organisation, not by input order or names', () => {
    const key = referralClusterLayoutKey(nodes, edges);
    expect(referralClusterLayoutKey([...nodes].reverse(), [...edges].reverse())).toBe(key);
    expect(referralClusterLayoutKey(nodes.slice(0, -1), edges.slice(0, -1))).not.toBe(key);
    expect(key).not.toMatch(/가상/);
  });

  it('restores a remembered layout and rejects broken ones', () => {
    const positions = buildMobileClusterPositions(nodes, edges);
    expect(parseClusterPositions(serializeClusterPositions(positions), nodes)).toEqual(positions);
    expect(parseClusterPositions('not json', nodes)).toBeNull();
    expect(parseClusterPositions(null, nodes)).toBeNull();
  });
});
