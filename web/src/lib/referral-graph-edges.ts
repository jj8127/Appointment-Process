export type ReferralGraphEdgeInput = {
  id: string;
  recommender_fc_id: string | null;
};

export type ReferralGraphEdge = {
  id: string;
  source: string;
  target: string;
  referralCode: string | null;
};

export function buildReferralGraphEdges(
  profiles: ReferralGraphEdgeInput[],
): ReferralGraphEdge[] {
  const profileIds = new Set<string>();
  const edgeIds = new Set<string>();
  const edges: ReferralGraphEdge[] = [];

  for (const profile of profiles) {
    if (profile.id) {
      profileIds.add(profile.id);
    }
  }

  for (const profile of profiles) {
    const parentId = profile.recommender_fc_id ?? null;
    if (!parentId || !profile.id || parentId === profile.id) {
      continue;
    }
    if (!profileIds.has(parentId)) {
      continue;
    }

    const edgeId = `${parentId}__${profile.id}`;
    if (edgeIds.has(edgeId)) {
      continue;
    }

    edgeIds.add(edgeId);
    edges.push({
      id: edgeId,
      source: parentId,
      target: profile.id,
      referralCode: null,
    });
  }

  return edges;
}
