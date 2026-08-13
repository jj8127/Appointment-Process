export type ReferralGraphNodeStatus =
  | 'has_active_code'
  | 'code_disabled'
  | 'missing_code';

export type ReferralGraphNode = {
  id: string;
  name: string;
  affiliation: string;
  activeCode: string | null;
  nodeStatus: ReferralGraphNodeStatus;
  signupCompleted: boolean;
  allCommissionsCompleted: boolean;
  directInviteeCount: number;
  totalDescendantCount: number;
  isViewer: boolean;
};

export type ReferralGraphEdge = {
  id: string;
  source: string;
  target: string;
};

export type ReferralGraphPermissions = {
  canMutate: false;
  scope: 'downline';
  rootFcId: string;
};

export type ReferralGraphResponse = {
  ok: true;
  mode: 'graph';
  nodes: ReferralGraphNode[];
  edges: ReferralGraphEdge[];
  permissions: ReferralGraphPermissions;
  truncated: boolean;
};

export type ReferralGraphPoint = {
  x: number;
  y: number;
};

export type ReferralGraphViewport = {
  scale: number;
  panX: number;
  panY: number;
};

export type ReferralGraphStatusFilter =
  | 'all'
  | 'commissioned'
  | 'registered'
  | 'preregistered';
