export type GraphNodeStatus = 'has_active_code' | 'missing_code' | 'code_disabled';
export type GraphRelationshipState = 'structured' | 'confirmed' | 'structured_confirmed';

export type GraphNode = {
  id: string;
  name: string;
  phone: string;
  affiliation: string;
  activeCode: string | null;
  /** 이 FC가 추천한 사람 수 (outbound) */
  referralCount: number;
  /** 이 FC를 추천한 사람 수 (inbound) */
  inboundCount: number;
  nodeStatus: GraphNodeStatus;
  isIsolated: boolean;
  /** recommender 텍스트만 있고 recommender_fc_id 없는 경우 */
  hasLegacyUnresolved: boolean;
  // d3-force가 런타임에 추가하는 좌표값 (선언만)
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number;
  fy?: number;
};

export type GraphEdge = {
  /** `${inviter_fc_id}__${invitee_fc_id}` */
  id: string;
  source: string; // inviter_fc_id
  target: string; // invitee_fc_id
  referralCode: string | null;
  relationshipState: GraphRelationshipState;
};

export type GraphApiResponse = {
  ok: true;
  nodes: GraphNode[];
  edges: GraphEdge[];
  permissions: { canMutate: boolean };
};

export type ReferralGraphPhysicsSettings = {
  centerGravity: number;
  repulsion: number;
  linkStrength: number;
  linkDistance: number;
};

export const DEFAULT_REFERRAL_GRAPH_PHYSICS: ReferralGraphPhysicsSettings = {
  centerGravity: 56,
  repulsion: 42,
  linkStrength: 74,
  linkDistance: 30,
};
