export const GROUP_CHAT_SEARCH_MIN_CODE_POINTS = 2;
export const GROUP_CHAT_SEARCH_MAX_CODE_POINTS = 100;
export const GROUP_CHAT_SEARCH_DEFAULT_LIMIT = 50;
export const GROUP_CHAT_SEARCH_MAX_LIMIT = 50;
export const GROUP_CHAT_SEARCH_EXCERPT_CODE_POINTS = 240;
export const GROUP_CHAT_CONTEXT_SIDE_LIMIT = 20;

export type GroupChatSearchMessageRow = {
  id: string;
  room_id: string;
  sender_name: string | null;
  sender_role: string;
  content: string;
  created_at: string;
  deleted_at: string | null;
};

export type GroupChatSearchResult = {
  source: "garamin_group";
  ref: { version: 1; kind: "group_chat"; roomId: string };
  messageId: string;
  sentAt: string;
  excerpt: string;
  roomLabel: string;
  senderLabel: string;
};

export function unicodeCodePointLength(value: string): number {
  return Array.from(value).length;
}

export function normalizeGroupChatSearchQuery(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const query = value.trim().replace(/\s+/gu, " ");
  const length = unicodeCodePointLength(query);
  if (
    length < GROUP_CHAT_SEARCH_MIN_CODE_POINTS ||
    length > GROUP_CHAT_SEARCH_MAX_CODE_POINTS
  ) {
    return null;
  }
  return query;
}

export function normalizeGroupChatSearchLimit(value: unknown): number | null {
  if (value === undefined) return GROUP_CHAT_SEARCH_DEFAULT_LIMIT;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > GROUP_CHAT_SEARCH_MAX_LIMIT
  ) {
    return null;
  }
  return value;
}

// PostgreSQL LIKE uses backslash as its default escape character. Escaping all
// three metacharacters keeps %, _, and backslash literal when sent via ilike.
export function escapeGroupChatIlikeLiteral(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}

function findCodePointSubsequence(content: string[], query: string[]): number {
  if (query.length === 0 || query.length > content.length) return -1;
  const foldedQuery = query.map((character) => character.toLocaleLowerCase());
  for (let start = 0; start <= content.length - query.length; start += 1) {
    let matches = true;
    for (let offset = 0; offset < query.length; offset += 1) {
      if (content[start + offset].toLocaleLowerCase() !== foldedQuery[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return start;
  }
  return -1;
}

export function buildGroupChatSearchExcerpt(
  content: string,
  query: string,
  maxCodePoints = GROUP_CHAT_SEARCH_EXCERPT_CODE_POINTS,
): string {
  const codePoints = Array.from(content);
  if (codePoints.length <= maxCodePoints) return content;

  const queryCodePoints = Array.from(query);
  const matchIndex = findCodePointSubsequence(codePoints, queryCodePoints);
  const focusIndex = matchIndex >= 0 ? matchIndex : 0;
  const idealStart = focusIndex -
    Math.floor((maxCodePoints - queryCodePoints.length) / 2);
  const start = Math.max(
    0,
    Math.min(idealStart, codePoints.length - maxCodePoints),
  );
  return codePoints.slice(start, start + maxCodePoints).join("");
}

export function serializeGroupChatSearchResult(input: {
  row: GroupChatSearchMessageRow;
  query: string;
  roomLabel: string;
}): GroupChatSearchResult {
  return {
    source: "garamin_group",
    ref: { version: 1, kind: "group_chat", roomId: input.row.room_id },
    messageId: input.row.id,
    sentAt: input.row.created_at,
    excerpt: buildGroupChatSearchExcerpt(input.row.content, input.query),
    roomLabel: input.roomLabel,
    senderLabel: input.row.sender_name?.trim() || input.row.sender_role,
  };
}

export function compareGroupChatMessageTuple(
  left: Pick<GroupChatSearchMessageRow, "created_at" | "id">,
  right: Pick<GroupChatSearchMessageRow, "created_at" | "id">,
): number {
  const timeComparison = left.created_at.localeCompare(right.created_at);
  return timeComparison !== 0
    ? timeComparison
    : left.id.localeCompare(right.id);
}
