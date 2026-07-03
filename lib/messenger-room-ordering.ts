export type LastMessageTimestampSource = {
  created_at?: string | null;
} | null | undefined;

export type ConversationWithLastTimestamp = {
  lastTimestamp: number;
};

export function getLastMessageTimestamp(lastMessage: LastMessageTimestampSource): number {
  const createdAt = lastMessage?.created_at;
  if (!createdAt) {
    return 0;
  }

  const timestamp = new Date(createdAt).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function sortConversationsByLastMessageTime<T extends ConversationWithLastTimestamp>(
  conversations: T[],
): T[] {
  return [...conversations].sort((left, right) => right.lastTimestamp - left.lastTimestamp);
}
