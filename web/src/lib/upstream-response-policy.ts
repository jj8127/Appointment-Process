const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** A transport 200 is never substituted for an upstream acknowledgement. */
export function parseUpstreamResponse(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw);
    return record(value) && typeof value.ok === 'boolean' ? value : null;
  } catch { return null; }
}

export function isGroupChatSuccess(type: unknown, value: unknown): boolean {
  if (!record(value) || value.ok !== true) return false;
  switch (type) {
    case 'group_chat_bootstrap':
      return record(value.actor) && record(value.room)
        && Array.isArray(value.messages) && Array.isArray(value.members)
        && typeof value.member_count === 'number' && typeof value.muted === 'boolean';
    case 'group_chat_send': case 'group_chat_delete':
      return record(value.message) && typeof value.message.id === 'string';
    case 'group_chat_preferences': return typeof value.muted === 'boolean';
    case 'group_chat_reaction_set': return Array.isArray(value.reactions);
    case 'group_chat_member_send_permission': return record(value.member);
    case 'group_chat_notice_set': return record(value.notice);
    case 'group_chat_notice_clear': return value.notice === null;
    case 'group_chat_mark_read': return true;
    case 'group_chat_notification_retry': return record(value.notification) && record(value.delivery);
    case 'group_chat_search': return Array.isArray(value.results);
    case 'group_chat_context': return Array.isArray(value.messages);
    default: return false;
  }
}

/** Once the primary transaction commits, rejected cleanup cannot undo it. */
export async function cleanupFailed(operation: () => Promise<unknown>): Promise<boolean> {
  try {
    const result = await operation();
    return record(result) && Boolean(result.error);
  } catch { return true; }
}


export function isBoardSuccess(name: unknown, value: unknown): boolean {
  if (!record(value) || value.ok !== true) return false;
  const data = value.data;
  switch (name) {
    case 'board-create': return value.saved === true && record(data) && typeof data.id === 'string';
    case 'board-update': return value.saved === true;
    case 'board-list': return record(data) && Array.isArray(data.items);
    case 'board-detail': return record(data) && record(data.post) && typeof data.post.id === 'string'
      && Array.isArray(data.attachments) && Array.isArray(data.comments) && record(data.reactions);
    case 'board-categories-list': case 'board-attachment-sign': return Array.isArray(data);
    case 'board-comment-create': case 'board-category-create': return record(data) && typeof data.id === 'string';
    case 'board-reaction-toggle': return record(data) && ('myReaction' in data);
    case 'board-comment-like-toggle': return record(data) && typeof data.liked === 'boolean' && typeof data.likeCount === 'number';
    case 'board-notification-retry': return record(value.delivery) && typeof value.delivery.notificationStored === 'boolean';
    // These deployed contracts acknowledge commit with ok alone.
    case 'board-delete': case 'board-comment-delete': case 'board-comment-update': case 'board-pin':
    case 'board-attachment-delete': case 'board-attachment-finalize': case 'board-category-update': return true;
    default: return false;
  }
}
