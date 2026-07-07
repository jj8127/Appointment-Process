import {
  formatUnreadReceiptCount,
  getDirectMessageUnreadCount,
} from '../message-read-receipts';

describe('direct message read receipts', () => {
  it('shows one unread recipient for unread sent 1:1 messages', () => {
    expect(getDirectMessageUnreadCount({ isOwn: true, isRead: false })).toBe(1);
  });

  it('hides the count for received, read, or deleted messages', () => {
    expect(getDirectMessageUnreadCount({ isOwn: false, isRead: false })).toBe(0);
    expect(getDirectMessageUnreadCount({ isOwn: true, isRead: true })).toBe(0);
    expect(getDirectMessageUnreadCount({ isOwn: true, isRead: false, isDeleted: true })).toBe(0);
  });

  it('formats bounded numeric receipt counts', () => {
    expect(formatUnreadReceiptCount(0)).toBe('');
    expect(formatUnreadReceiptCount(1)).toBe('1');
    expect(formatUnreadReceiptCount(101)).toBe('99+');
  });
});
