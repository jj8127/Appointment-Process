import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  formatGroupChatTime,
  getGroupChatMessageCopyText,
  getGroupChatReplyLabel,
  getMessengerAttachmentSummary,
  getGroupChatRoleLabel,
  isStaffGroupChatActor,
  normalizeGroupChatMemberSearch,
  resolveGroupChatSendPermission,
} from '../group-chat-display';

const root = process.cwd();

function readRepoFile(path: string) {
  return readFileSync(join(root, path), 'utf8');
}

describe('group chat display/function contracts', () => {
  it('normalizes permissions, search text, role labels, and message labels', () => {
    expect(isStaffGroupChatActor({ role: 'admin' })).toBe(true);
    expect(isStaffGroupChatActor({ role: 'manager' })).toBe(true);
    expect(isStaffGroupChatActor({ role: 'fc' })).toBe(false);
    expect(resolveGroupChatSendPermission({ role: 'fc' }, true)).toBe(true);
    expect(resolveGroupChatSendPermission({ role: 'fc' }, false)).toBe(false);
    expect(resolveGroupChatSendPermission({ role: 'manager' }, false)).toBe(true);
    expect(normalizeGroupChatMemberSearch(' 홍 길 동  010 ')).toBe('홍길동010');
    expect(getGroupChatRoleLabel('fc')).toBe('FC');
    expect(getGroupChatReplyLabel({ message_type: 'text', content: 'hello' })).toBe('hello');
    expect(getGroupChatReplyLabel({ message_type: 'file', file_name: 'report.pdf', content: '' })).toBe('report.pdf');
    expect(getGroupChatMessageCopyText({ message_type: 'file', file_name: 'report.pdf', content: 'fallback' })).toBe('report.pdf');
    expect(getGroupChatReplyLabel({
      message_type: 'file',
      attachments: [{ name: '첫째.pdf' }, { name: '둘째.pptx' }],
      content: '',
    })).toBe('첫째.pdf 외 1개');
    expect(getGroupChatMessageCopyText({
      message_type: 'file',
      attachments: [{ name: '첫째.pdf' }, { name: '둘째.pptx' }],
      content: '',
    })).toBe('첫째.pdf\n둘째.pptx');
    expect(getGroupChatMessageCopyText({ message_type: 'text', content: 'copy me' })).toBe('copy me');
    // Photos read as 사진 in replies and the conversation list, not as their camera file names.
    expect(getGroupChatReplyLabel({
      message_type: 'file',
      attachments: [{ name: 'IMG_3402.png', mimeType: 'image/png' }],
      content: '',
    })).toBe('사진');
    expect(getMessengerAttachmentSummary([
      { name: 'IMG_3402.png', mimeType: 'image/png' },
      { name: 'IMG_3403.jpg', mimeType: 'image/jpeg' },
    ])).toBe('사진 2장');
    expect(getMessengerAttachmentSummary([
      { name: 'IMG_3402.png', mimeType: 'image/png' },
      { name: '안내.pdf', mimeType: 'application/pdf' },
    ])).toBe('IMG_3402.png 외 1개');
  });

  it('formats group chat message time through one helper', () => {
    expect(formatGroupChatTime('2026-07-03T01:02:00Z')).toMatch(/\d{1,2}:\d{2}/);
  });

  it('keeps group chat screen on shared function helpers', () => {
    const source = readRepoFile('app/group-chat.tsx');

    expect(source).toContain("from '@/lib/group-chat-display'");
    expect(source).toContain('resolveGroupChatSendPermission');
    expect(source).toContain('formatGroupChatTime');
    expect(source).toContain('getGroupChatReplyLabel');
    expect(source).toContain('getGroupChatMessageCopyText');
    expect(source).not.toContain('function isStaffGroupChatActor');
    expect(source).not.toContain('function resolveCanSendMessages');
    expect(source).not.toContain('function normalizeMemberSearch');
    expect(source).not.toContain('function formatTime');
    expect(source).not.toContain('function getReplyLabel');
    expect(source).not.toContain('function getMessageCopyText');
  });
});
