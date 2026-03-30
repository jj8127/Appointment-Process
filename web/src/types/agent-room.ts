export const AGENT_ROOM_STATUSES = ['coding', 'researching', 'thinking', 'waiting', 'done', 'idle'] as const;

export const AGENT_ROOM_ZONES = ['terminal', 'library', 'whiteboard', 'lounge', 'shipping', 'idle'] as const;

export const AGENT_ROOM_VENDORS = ['codex', 'claude'] as const;

export type AgentRoomStatus = (typeof AGENT_ROOM_STATUSES)[number];

export type AgentRoomZone = (typeof AGENT_ROOM_ZONES)[number];

export type AgentRoomVendor = (typeof AGENT_ROOM_VENDORS)[number];

export type AgentRoomHost = {
  available: boolean;
  root: string;
  vendor: AgentRoomVendor;
};

export type AgentRoomFocus = {
  activeCount: number;
  quietAgentIds: string[];
  quietCount: number;
  recentCount: number;
  stageAgentIds: string[];
  stageCount: number;
};

export type AgentRoomAgent = {
  detail: string | null;
  consoleDetail: string | null;
  id: string;
  isSubagent: boolean;
  name: string;
  parentId: string | null;
  pendingTool: string | null;
  role: string | null;
  sourcePath: string | null;
  status: AgentRoomStatus;
  title: string | null;
  updatedAt: string | null;
  vendor: AgentRoomVendor;
  zone: AgentRoomZone;
};

export type AgentRoomSummary = {
  activeCount: number;
  quietCount: number;
  recentCount: number;
  statusCounts: Record<AgentRoomStatus, number>;
  total: number;
  vendorCounts: Record<AgentRoomVendor, number>;
};

export type AgentRoomSnapshot = {
  agents: AgentRoomAgent[];
  focus: AgentRoomFocus;
  generatedAt: string;
  hosts: AgentRoomHost[];
  summary: AgentRoomSummary;
  warnings: string[];
  workspace: string | null;
};
