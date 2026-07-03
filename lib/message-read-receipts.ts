export type DirectMessageReadReceiptInput = {
  isOwn: boolean;
  isRead?: boolean | null;
  isDeleted?: boolean | null;
  participantCount?: number | null;
};

export function getDirectMessageUnreadCount({
  isOwn,
  isRead,
  isDeleted,
  participantCount = 1,
}: DirectMessageReadReceiptInput): number {
  if (!isOwn || isDeleted || isRead) return 0;
  const count = Number(participantCount);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 1;
}

export function formatUnreadReceiptCount(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '';
  return count > 99 ? '99+' : String(Math.floor(count));
}
