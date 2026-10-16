/**
 * Where to draw the "여기까지 읽었어요" line when a room opens: above the oldest
 * message the viewer had not read yet. Returns null when nothing is unread or
 * when every message is unread (a line above the very first message says
 * nothing). `messages` is newest first, as the inverted lists keep them.
 */
export function findMessengerReadLineId<T extends { id: string }>(
  messages: readonly T[],
  isUnreadIncoming: (message: T) => boolean,
): string | null {
  let oldestUnreadIndex = -1;
  for (let index = 0; index < messages.length; index += 1) {
    if (isUnreadIncoming(messages[index])) oldestUnreadIndex = index;
  }
  if (oldestUnreadIndex < 0 || oldestUnreadIndex === messages.length - 1) return null;
  return messages[oldestUnreadIndex].id;
}
