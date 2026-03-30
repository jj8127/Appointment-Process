import 'server-only';

import os from 'node:os';
import path from 'node:path';
import { open, readFile, readdir, stat } from 'node:fs/promises';

import {
  AGENT_ROOM_STATUSES,
  AGENT_ROOM_VENDORS,
  type AgentRoomAgent,
  type AgentRoomFocus,
  type AgentRoomSnapshot,
  type AgentRoomStatus,
  type AgentRoomSummary,
  type AgentRoomVendor,
  type AgentRoomZone,
} from '@/types/agent-room';

type FileCandidate = {
  mtimeMs: number;
  path: string;
  size: number;
};

type VendorScanResult = {
  agents: AgentRoomAgent[];
  warnings: string[];
};

type CodexSessionMeta = {
  agent_nickname?: string;
  agent_role?: string;
  cwd?: string;
  id?: string;
  source?: {
    subagent?: {
      thread_spawn?: {
        agent_nickname?: string;
        agent_role?: string;
        parent_thread_id?: string;
      };
    };
  };
};

type ClaudeMeta = {
  agentType?: string;
  description?: string;
};

type ActivityState = {
  detail: string | null;
  lastEventType: string | null;
  pendingTool: string | null;
  updatedAt: string | null;
};

const ACTIVE_WINDOW_MS = 12 * 60_000;
const RECENT_WINDOW_MS = 8 * 60_000;
const STAGE_AGENT_LIMIT = 6;
const CACHE_TTL_MS = 4_000;
const LARGE_HEAD_BYTES = 512_000;
const MAX_FILE_AGE_MS = 18 * 60 * 60_000;
const MAX_SCANNED_CLAUDE_FILES = 18;
const MAX_SCANNED_CODEX_FILES = 24;
const TAIL_BYTES = 96_000;

let snapshotCache: { expiresAt: number; snapshot: AgentRoomSnapshot } | null = null;

export async function getAgentRoomSnapshot(): Promise<AgentRoomSnapshot> {
  const now = Date.now();
  if (snapshotCache && now < snapshotCache.expiresAt) {
    return snapshotCache.snapshot;
  }

  const workspaceRoot = path.resolve(process.cwd(), '..', '..');
  const codexRoot = path.resolve(process.env.CODEX_HOME?.trim() || path.join(os.homedir(), '.codex'));
  const claudeRoot = path.resolve(process.env.CLAUDE_HOME?.trim() || path.join(os.homedir(), '.claude'));

  const [codex, claude, codexAvailable, claudeAvailable] = await Promise.all([
    scanCodexSessions(codexRoot, workspaceRoot),
    scanClaudeSessions(claudeRoot, workspaceRoot),
    directoryExists(codexRoot),
    directoryExists(claudeRoot),
  ]);

  const agents = dedupeAgents([...codex.agents, ...claude.agents]).sort(compareAgents);
  const focus = buildFocus(agents, now);
  const snapshot: AgentRoomSnapshot = {
    agents,
    focus,
    generatedAt: new Date().toISOString(),
    hosts: [
      { available: codexAvailable, root: codexRoot, vendor: 'codex' },
      { available: claudeAvailable, root: claudeRoot, vendor: 'claude' },
    ],
    summary: buildSummary(agents, focus),
    warnings: [...codex.warnings, ...claude.warnings],
    workspace: workspaceRoot,
  };

  snapshotCache = {
    expiresAt: now + CACHE_TTL_MS,
    snapshot,
  };

  return snapshot;
}

async function scanCodexSessions(codexRoot: string, workspaceRoot: string): Promise<VendorScanResult> {
  const sessionsRoot = path.join(codexRoot, 'sessions');
  if (!(await directoryExists(sessionsRoot))) {
    return {
      agents: [],
      warnings: ['Codex 세션 폴더를 찾지 못했습니다.'],
    };
  }

  const sessionNames = await loadCodexSessionNames(path.join(codexRoot, 'session_index.jsonl'));
  const files = await collectRecentFiles(sessionsRoot, MAX_SCANNED_CODEX_FILES, (filePath) => filePath.endsWith('.jsonl'));
  const agents: AgentRoomAgent[] = [];

  for (const file of files) {
    const agent = await parseCodexFile(file, sessionNames, workspaceRoot);
    if (agent) {
      agents.push(agent);
    }
  }

  return { agents, warnings: [] };
}

async function scanClaudeSessions(claudeRoot: string, workspaceRoot: string): Promise<VendorScanResult> {
  const projectsRoot = path.join(claudeRoot, 'projects');
  if (!(await directoryExists(projectsRoot))) {
    return {
      agents: [],
      warnings: ['Claude 세션 폴더를 찾지 못했습니다.'],
    };
  }

  const files = await collectRecentFiles(
    projectsRoot,
    MAX_SCANNED_CLAUDE_FILES,
    (filePath) => filePath.endsWith('.jsonl'),
  );
  const agents: AgentRoomAgent[] = [];

  for (const file of files) {
    const agent = await parseClaudeFile(file, workspaceRoot);
    if (agent) {
      agents.push(agent);
    }
  }

  return { agents, warnings: [] };
}

async function parseCodexFile(
  file: FileCandidate,
  sessionNames: Map<string, string>,
  workspaceRoot: string,
): Promise<AgentRoomAgent | null> {
  if (Date.now() - file.mtimeMs > MAX_FILE_AGE_MS) {
    return null;
  }

  const fallbackThreadId = extractTrailingId(file.path);
  if (file.size === 0) {
    if (!fallbackThreadId || Date.now() - file.mtimeMs > ACTIVE_WINDOW_MS) {
      return null;
    }

    return buildAgentSnapshot({
      consoleDetail: '새 스레드 준비 중',
      detail: getBubbleText('thinking', '새 스레드 준비 중'),
      id: fallbackThreadId,
      isSubagent: false,
      name: 'Codex',
      parentId: null,
      pendingTool: null,
      role: null,
      sourcePath: file.path,
      status: 'thinking',
      title: sessionNames.get(fallbackThreadId) ?? null,
      updatedAt: new Date(file.mtimeMs).toISOString(),
      vendor: 'codex',
    });
  }

  const headText = await readHead(file.path, LARGE_HEAD_BYTES);
  const tailText = await readTail(file.path, TAIL_BYTES);
  const headEntries = parseJsonLines(headText, false);
  const tailEntries = parseJsonLines(tailText.text, tailText.truncated);
  const meta = headEntries.find((entry) => entry.type === 'session_meta')?.payload as CodexSessionMeta | undefined;
  const threadId = meta?.id ?? fallbackThreadId;

  if (!threadId) {
    return null;
  }

  if (meta?.cwd && !matchesWorkspace(meta.cwd, workspaceRoot)) {
    return null;
  }

  const parentId = meta?.source?.subagent?.thread_spawn?.parent_thread_id ?? null;
  const isSubagent = Boolean(parentId);
  const activity = getCodexActivity(tailEntries, file.mtimeMs);
  const status = deduceStatus(activity);

  return buildAgentSnapshot({
    consoleDetail: activity.detail ? truncateText(activity.detail, 112) : null,
    detail: getBubbleText(status, activity.detail),
    id: threadId,
    isSubagent,
    name:
      meta?.agent_nickname
      ?? meta?.source?.subagent?.thread_spawn?.agent_nickname
      ?? (isSubagent ? 'Codex sidecar' : 'Codex'),
    parentId,
    pendingTool: activity.pendingTool,
    role: meta?.agent_role ?? meta?.source?.subagent?.thread_spawn?.agent_role ?? null,
    sourcePath: file.path,
    status,
    title: sessionNames.get(threadId) ?? (parentId ? sessionNames.get(parentId) ?? null : null),
    updatedAt: activity.updatedAt ?? new Date(file.mtimeMs).toISOString(),
    vendor: 'codex',
  });
}

async function parseClaudeFile(file: FileCandidate, workspaceRoot: string): Promise<AgentRoomAgent | null> {
  if (Date.now() - file.mtimeMs > MAX_FILE_AGE_MS || file.size === 0) {
    return null;
  }

  const isSubagent = file.path.includes(`${path.sep}subagents${path.sep}`);
  const tailText = await readTail(file.path, TAIL_BYTES);
  const tailEntries = parseJsonLines(tailText.text, tailText.truncated);
  if (tailEntries.length === 0) {
    return null;
  }

  const meta = isSubagent ? await readClaudeMeta(file.path) : null;
  const activity = getClaudeActivity(tailEntries, file.mtimeMs);
  if (activity.workspace && !matchesWorkspace(activity.workspace, workspaceRoot)) {
    return null;
  }
  const status = deduceStatus(activity);

  return buildAgentSnapshot({
    consoleDetail: activity.detail ? truncateText(activity.detail, 112) : null,
    detail: getBubbleText(status, activity.detail),
    id: activity.agentId ?? activity.sessionId ?? extractNameWithoutExt(file.path),
    isSubagent,
    name: isSubagent ? meta?.description?.trim() || 'Claude sidecar' : 'Claude',
    parentId: isSubagent ? activity.sessionId ?? null : null,
    pendingTool: activity.pendingTool,
    role: isSubagent ? meta?.agentType ?? null : null,
    sourcePath: file.path,
    status,
    title: activity.slug ?? activity.sessionId ?? null,
    updatedAt: activity.updatedAt ?? new Date(file.mtimeMs).toISOString(),
    vendor: 'claude',
  });
}

async function readClaudeMeta(filePath: string): Promise<ClaudeMeta | null> {
  const metaPath = filePath.replace(/\.jsonl$/i, '.meta.json');
  try {
    const raw = await readFile(metaPath, 'utf8');
    return JSON.parse(raw) as ClaudeMeta;
  } catch {
    return null;
  }
}

function getCodexActivity(entries: Array<Record<string, unknown>>, fallbackMtimeMs: number): ActivityState {
  const pendingTools = new Map<string, string>();
  let detail: string | null = null;
  let lastEventType: string | null = null;
  let updatedAt: string | null = new Date(fallbackMtimeMs).toISOString();

  for (const entry of entries) {
    const timestamp = getString(entry, 'timestamp');
    if (timestamp) {
      updatedAt = timestamp;
    }

    if (entry.type === 'response_item') {
      const payload = asRecord(entry.payload);
      const payloadType = getString(payload, 'type');

      if (payloadType === 'function_call' || payloadType === 'custom_tool_call') {
        const toolName = getString(payload, 'name');
        const callId = getString(payload, 'call_id') ?? toolName ?? `${updatedAt}-tool`;
        if (toolName) {
          pendingTools.set(callId, toolName);
          detail = prettifyToolName(toolName);
          lastEventType = payloadType;
        }
        continue;
      }

      if (payloadType === 'function_call_output' || payloadType === 'custom_tool_call_output') {
        const callId = getString(payload, 'call_id');
        if (callId) {
          pendingTools.delete(callId);
        }
        const outputHeadline = extractOutputHeadline(payload.output);
        if (outputHeadline) {
          detail = outputHeadline;
        }
        lastEventType = payloadType;
        continue;
      }

      if (payloadType === 'reasoning') {
        detail = '내부 추론 정리 중';
        lastEventType = payloadType;
        continue;
      }

      if (payloadType === 'message') {
        const text = extractTextFromBlocks(payload.content);
        if (text) {
          detail = text;
          lastEventType = payloadType;
        }
      }

      continue;
    }

    if (entry.type !== 'event_msg') {
      continue;
    }

    const payload = asRecord(entry.payload);
    const payloadType = getString(payload, 'type');
    if (!payloadType) {
      continue;
    }

    if (payloadType === 'task_started') {
      detail = '새 작업을 시작했습니다.';
      lastEventType = payloadType;
      continue;
    }

    if (payloadType === 'task_complete') {
      detail = '작업을 마쳤습니다.';
      lastEventType = payloadType;
      continue;
    }

    if (payloadType === 'agent_message') {
      const message = getString(payload, 'message');
      if (message) {
        detail = message;
        lastEventType = payloadType;
      }
    }
  }

  return {
    detail: detail ? truncateText(detail) : null,
    lastEventType,
    pendingTool: getLastMapValue(pendingTools) ?? null,
    updatedAt,
  };
}

function getClaudeActivity(
  entries: Array<Record<string, unknown>>,
  fallbackMtimeMs: number,
): ActivityState & {
  agentId: string | null;
  sessionId: string | null;
  slug: string | null;
  workspace: string | null;
} {
  const pendingTools = new Map<string, string>();
  let agentId: string | null = null;
  let detail: string | null = null;
  let lastEventType: string | null = null;
  let sessionId: string | null = null;
  let slug: string | null = null;
  let updatedAt: string | null = new Date(fallbackMtimeMs).toISOString();
  let workspace: string | null = null;

  for (const entry of entries) {
    const timestamp = getString(entry, 'timestamp');
    if (timestamp) {
      updatedAt = timestamp;
    }

    agentId = getString(entry, 'agentId') ?? agentId;
    sessionId = getString(entry, 'sessionId') ?? sessionId;
    slug = getString(entry, 'slug') ?? slug;
    workspace = getString(entry, 'cwd') ?? workspace;

    if (entry.type === 'assistant') {
      const blocks = asArray(asRecord(entry.message).content);
      const toolUse = blocks.find((block) => getString(block, 'type') === 'tool_use');
      if (toolUse) {
        const toolId = getString(toolUse, 'id') ?? getString(toolUse, 'tool_use_id') ?? `${updatedAt}-tool`;
        const toolName = getString(toolUse, 'name');
        if (toolName) {
          pendingTools.set(toolId, toolName);
          detail = prettifyToolName(toolName);
          lastEventType = 'tool_use';
        }
        continue;
      }

      const text = extractClaudeText(blocks);
      if (text) {
        detail = text;
        lastEventType = 'assistant';
      }
      continue;
    }

    if (entry.type === 'user') {
      const blocks = asArray(asRecord(entry.message).content);
      for (const block of blocks) {
        if (getString(block, 'type') === 'tool_result') {
          const toolUseId = getString(block, 'tool_use_id');
          if (toolUseId) {
            pendingTools.delete(toolUseId);
          }
        }
      }
      continue;
    }

    if (entry.type === 'progress') {
      const data = asRecord(entry.data);
      const progressType = getString(data, 'type') ?? 'progress';
      const query = getString(data, 'query');
      lastEventType = progressType;
      if (progressType === 'query_update' && query) {
        detail = `검색: ${query}`;
      } else if (progressType === 'search_results_received') {
        detail = `검색 결과 ${getNumber(data, 'resultCount') ?? '?'}건 수신`;
      } else {
        detail = progressType;
      }
      continue;
    }

    if (entry.type === 'queue-operation') {
      detail = '응답 큐를 정리 중입니다.';
      lastEventType = 'queue-operation';
    }
  }

  return {
    agentId,
    detail: detail ? truncateText(detail) : null,
    lastEventType,
    pendingTool: getLastMapValue(pendingTools) ?? null,
    sessionId,
    slug,
    updatedAt,
    workspace,
  };
}

function deduceStatus(activity: ActivityState): AgentRoomStatus {
  const ageMs = getAgeMs(activity.updatedAt);
  if (activity.pendingTool) {
    return classifyToolName(activity.pendingTool);
  }

  if (activity.lastEventType === 'task_complete') {
    return ageMs > ACTIVE_WINDOW_MS ? 'idle' : 'done';
  }

  if (activity.lastEventType === 'queue-operation') {
    return ageMs > ACTIVE_WINDOW_MS ? 'idle' : 'waiting';
  }

  if (activity.lastEventType === 'reasoning') {
    return ageMs > ACTIVE_WINDOW_MS ? 'idle' : 'thinking';
  }

  const inferred = inferStatusFromText(activity.detail);
  if (inferred) {
    return ageMs > ACTIVE_WINDOW_MS && inferred !== 'done' ? 'idle' : inferred;
  }

  if (ageMs > ACTIVE_WINDOW_MS) {
    return 'idle';
  }

  return 'thinking';
}

function inferStatusFromText(detail: string | null): AgentRoomStatus | null {
  if (!detail) {
    return null;
  }

  const normalized = detail.toLowerCase();
  if (hasAny(normalized, ['완료', 'done', 'finished', 'ship'])) return 'done';
  if (hasAny(normalized, ['wait', '대기', 'queue', 'holding'])) return 'waiting';
  if (hasAny(normalized, ['search', '검색', 'fetch', 'read', 'inspect', 'find', '조사', '분석'])) return 'researching';
  if (hasAny(normalized, ['patch', 'edit', 'fix', 'build', 'test', 'lint', 'route', 'page', 'api', '구현', '수정', '테스트'])) return 'coding';
  return 'thinking';
}

function classifyToolName(toolName: string): AgentRoomStatus {
  const normalized = toolName.toLowerCase();
  if (hasAny(normalized, ['wait_agent', 'request_user_input', 'queue'])) return 'waiting';
  if (hasAny(normalized, ['search', 'open', 'find', 'image_query', 'read_mcp_resource', 'fetch', 'list_', 'weather', 'finance', 'sports', 'time', 'web.'])) return 'researching';
  if (hasAny(normalized, ['shell_command', 'apply_patch', 'create_', 'update_', 'deploy', 'reply_to', 'bootstrap', 'testsprite', 'review', 'add_comment', 'edit_toolbar'])) return 'coding';
  return 'thinking';
}

function buildAgentSnapshot(input: {
  detail: string | null;
  consoleDetail: string | null;
  id: string;
  isSubagent: boolean;
  name: string;
  parentId: string | null;
  pendingTool: string | null;
  role: string | null;
  sourcePath: string;
  status: AgentRoomStatus;
  title: string | null;
  updatedAt: string | null;
  vendor: AgentRoomVendor;
}): AgentRoomAgent {
  return {
    detail: input.detail,
    consoleDetail: input.consoleDetail,
    id: input.id,
    isSubagent: input.isSubagent,
    name: truncateText(input.name, 36),
    parentId: input.parentId,
    pendingTool: input.pendingTool,
    role: input.role,
    sourcePath: input.sourcePath,
    status: input.status,
    title: input.title ? truncateText(input.title, 72) : null,
    updatedAt: input.updatedAt,
    vendor: input.vendor,
    zone: zoneForStatus(input.status),
  };
}

function buildSummary(agents: AgentRoomAgent[], focus: AgentRoomFocus): AgentRoomSummary {
  const statusCounts = Object.fromEntries(AGENT_ROOM_STATUSES.map((status) => [status, 0])) as Record<AgentRoomStatus, number>;
  const vendorCounts = Object.fromEntries(AGENT_ROOM_VENDORS.map((vendor) => [vendor, 0])) as Record<AgentRoomVendor, number>;

  for (const agent of agents) {
    statusCounts[agent.status] += 1;
    vendorCounts[agent.vendor] += 1;
  }

  return {
    activeCount: focus.activeCount,
    quietCount: focus.quietCount,
    recentCount: focus.recentCount,
    statusCounts,
    total: agents.length,
    vendorCounts,
  };
}

function buildFocus(agents: AgentRoomAgent[], nowMs: number): AgentRoomFocus {
  const ranked = agents.map((agent) => buildFocusItem(agent, nowMs));

  const activeCount = ranked.filter((item) => item.isActive).length;
  const recentCount = ranked.filter((item) => item.isRecent).length;
  const stagePool = ranked
    .filter((item) => item.isActive || item.isRecent)
    .sort(compareFocusItems);

  const stageAgents = (stagePool.length > 0 ? stagePool : ranked.sort(compareFocusItems))
    .slice(0, STAGE_AGENT_LIMIT)
    .map((item) => item.agent);
  const stageIds = new Set(stageAgents.map((agent) => agent.id));
  const quietAgentIds = ranked.filter((item) => !stageIds.has(item.agent.id)).map((item) => item.agent.id);

  return {
    activeCount,
    quietAgentIds,
    quietCount: quietAgentIds.length,
    recentCount,
    stageAgentIds: stageAgents.map((agent) => agent.id),
    stageCount: stageAgents.length,
  };
}

function compareFocusItems(left: ReturnType<typeof buildFocusItem>, right: ReturnType<typeof buildFocusItem>) {
  const leftPriority = getAttentionPriority(left.agent.status);
  const rightPriority = getAttentionPriority(right.agent.status);
  if (leftPriority !== rightPriority) {
    return rightPriority - leftPriority;
  }

  if (left.isRecent !== right.isRecent) {
    return Number(right.isRecent) - Number(left.isRecent);
  }

  if (left.ageMs !== right.ageMs) {
    return left.ageMs - right.ageMs;
  }

  return left.agent.name.localeCompare(right.agent.name);
}

function buildFocusItem(agent: AgentRoomAgent, nowMs: number) {
  const ageMs = getAgeMs(agent.updatedAt, nowMs);
  return {
    ageMs,
    agent,
    isActive: isActiveStatus(agent.status),
    isRecent: ageMs <= RECENT_WINDOW_MS,
  };
}

function getAttentionPriority(status: AgentRoomStatus) {
  switch (status) {
    case 'coding':
      return 50;
    case 'researching':
      return 40;
    case 'thinking':
      return 30;
    case 'waiting':
      return 20;
    case 'done':
      return 10;
    case 'idle':
      return 0;
  }
}

function isActiveStatus(status: AgentRoomStatus) {
  return status === 'coding' || status === 'researching' || status === 'thinking' || status === 'waiting';
}

function getBubbleText(status: AgentRoomStatus, detail: string | null) {
  if (detail) {
    const compact = truncateText(detail, 16);
    if (compact.length <= 10) {
      return compact;
    }
  }

  switch (status) {
    case 'coding':
      return '수정 중';
    case 'researching':
      return '조사 중';
    case 'thinking':
      return '정리 중';
    case 'waiting':
      return '대기 중';
    case 'done':
      return '완료';
    case 'idle':
      return '대기';
  }
}

function dedupeAgents(agents: AgentRoomAgent[]): AgentRoomAgent[] {
  const byId = new Map<string, AgentRoomAgent>();
  for (const agent of agents) {
    const existing = byId.get(agent.id);
    if (!existing || compareAgents(agent, existing) < 0) {
      byId.set(agent.id, agent);
    }
  }
  return Array.from(byId.values());
}

function compareAgents(left: AgentRoomAgent, right: AgentRoomAgent) {
  const leftTime = parseTimestamp(left.updatedAt);
  const rightTime = parseTimestamp(right.updatedAt);
  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }
  return left.name.localeCompare(right.name);
}

function zoneForStatus(status: AgentRoomStatus): AgentRoomZone {
  switch (status) {
    case 'coding':
      return 'terminal';
    case 'researching':
      return 'library';
    case 'thinking':
      return 'whiteboard';
    case 'waiting':
      return 'lounge';
    case 'done':
      return 'shipping';
    case 'idle':
      return 'idle';
  }
}

async function loadCodexSessionNames(indexPath: string): Promise<Map<string, string>> {
  try {
    const tail = await readTail(indexPath, 320_000);
    const names = new Map<string, string>();
    for (const entry of parseJsonLines(tail.text, tail.truncated)) {
      const id = getString(entry, 'id');
      const threadName = getString(entry, 'thread_name');
      if (id && threadName) {
        names.set(id, threadName);
      }
    }
    return names;
  } catch {
    return new Map<string, string>();
  }
}

async function collectRecentFiles(
  root: string,
  limit: number,
  predicate: (filePath: string) => boolean,
): Promise<FileCandidate[]> {
  const files: FileCandidate[] = [];
  await walkDirectory(root, files, predicate);
  files.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return files.slice(0, limit);
}

async function walkDirectory(
  currentDir: string,
  bucket: FileCandidate[],
  predicate: (filePath: string) => boolean,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(currentDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await walkDirectory(fullPath, bucket, predicate);
      continue;
    }

    if (!entry.isFile() || !predicate(fullPath)) {
      continue;
    }

    try {
      const fileInfo = await stat(fullPath);
      bucket.push({
        mtimeMs: fileInfo.mtimeMs,
        path: fullPath,
        size: fileInfo.size,
      });
    } catch {
      // Ignore transient file errors while polling.
    }
  }
}

async function readHead(filePath: string, maxBytes: number) {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.toString('utf8', 0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function readTail(filePath: string, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  const fileInfo = await stat(filePath);
  const start = Math.max(0, fileInfo.size - maxBytes);
  const handle = await open(filePath, 'r');
  try {
    const length = Math.min(maxBytes, fileInfo.size);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return {
      text: buffer.toString('utf8', 0, bytesRead),
      truncated: start > 0,
    };
  } finally {
    await handle.close();
  }
}

function parseJsonLines(text: string, dropFirstPartialLine: boolean): Array<Record<string, unknown>> {
  const rawLines = text.replace(/\r/g, '').split('\n');
  if (dropFirstPartialLine && rawLines.length > 0) {
    rawLines.shift();
  }

  return rawLines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is Record<string, unknown> => entry !== null);
}

async function directoryExists(targetPath: string) {
  try {
    return (await stat(targetPath)).isDirectory();
  } catch {
    return false;
  }
}

function matchesWorkspace(candidatePath: string, workspaceRoot: string) {
  const candidate = normalizeFsPath(candidatePath);
  const workspace = normalizeFsPath(workspaceRoot);
  return candidate === workspace || candidate.startsWith(`${workspace}/`) || workspace.startsWith(`${candidate}/`);
}

function normalizeFsPath(input: string) {
  return input.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function extractTrailingId(filePath: string) {
  const match = filePath.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\.jsonl)?$/i);
  return match?.[1] ?? null;
}

function extractNameWithoutExt(filePath: string) {
  return path.basename(filePath, path.extname(filePath));
}

function getAgeMs(value: string | null, nowMs = Date.now()) {
  const timestamp = parseTimestamp(value);
  if (!Number.isFinite(timestamp)) {
    return Number.POSITIVE_INFINITY;
  }
  return nowMs - timestamp;
}

function parseTimestamp(value: string | null | undefined) {
  if (!value) {
    return Number.NaN;
  }
  return new Date(value).getTime();
}

function prettifyToolName(toolName: string) {
  const stripped = toolName.replace(/^mcp__[^_]+__/, '').replace(/^functions\./, '');
  return truncateText(stripped.replace(/[_-]+/g, ' '), 42);
}

function extractOutputHeadline(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }
  const line = value
    .replace(/\r/g, '')
    .split('\n')
    .map((part) => part.trim())
    .find((part) => part && !part.startsWith('Exit code') && !part.startsWith('Wall time') && part !== 'Output:');
  return line ? truncateText(line, 84) : null;
}

function extractTextFromBlocks(value: unknown) {
  for (const block of asArray(value)) {
    const type = getString(block, 'type');
    const text = getString(block, 'text');
    if ((type === 'output_text' || type === 'input_text' || type === 'text') && text) {
      return truncateText(text);
    }
  }
  return null;
}

function extractClaudeText(blocks: Array<Record<string, unknown>>) {
  for (const block of blocks) {
    const type = getString(block, 'type');
    const text = getString(block, 'text');
    if (type === 'text' && text) {
      return truncateText(text);
    }
  }
  return null;
}

function truncateText(value: string, maxLength = 96) {
  const singleLine = value.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= maxLength) {
    return singleLine;
  }
  return `${singleLine.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function hasAny(value: string, needles: string[]) {
  return needles.some((needle) => value.includes(needle));
}

function getLastMapValue(map: Map<string, string>) {
  let lastValue: string | null = null;
  for (const value of map.values()) {
    lastValue = value;
  }
  return lastValue;
}

function asArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function getString(value: unknown, key: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'string' ? candidate : null;
}

function getNumber(value: unknown, key: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'number' ? candidate : null;
}
