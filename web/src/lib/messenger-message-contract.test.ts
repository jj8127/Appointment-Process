import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  parseDirectMessengerMessage,
  parseDirectMessengerMessageList,
  parseGroupMessengerMessage,
  parseGroupMessengerMessageList,
} from './messenger-message-contract.ts';

const attachment = {
  id: '7d493f2e-21c9-4c86-b94b-43c875555001',
  name: '계약서.pdf',
  size: 128,
  mimeType: 'application/pdf',
  sha256: 'a'.repeat(64),
};

const directMessage = {
  id: 'message-1',
  conversation_id: 'conversation-1',
  sender_id: 'admin:one',
  receiver_id: 'fc:01011112222',
  content: 'hello',
  created_at: '2026-10-13T00:00:00.000Z',
  is_read: false,
  message_type: 'text',
  file_url: null,
  file_name: null,
  file_size: null,
  attachments: [],
};

const groupMessage = {
  id: 'message-2',
  room_id: 'room-1',
  sender_actor_id: 'actor-1',
  sender_role: 'admin',
  sender_phone: '01011112222',
  sender_name: '관리자',
  content: 'hello',
  message_type: 'text',
  file_url: null,
  file_name: null,
  file_size: null,
  attachments: [],
  created_at: '2026-10-13T00:00:00.000Z',
  unread_count: 1,
  reply_to_message_id: null,
  reply_to_sender_name: null,
  reply_to_content: null,
  deleted_at: null,
  deleted_by_actor_id: null,
  reactions: [{ reaction: '👍', count: 1, reacted_by_me: false }],
};

const unsafeUrls = [
  'javascript:alert(1)',
  'data:text/html,unsafe',
  'http://storage.example.test/file',
  'https://user:secret@storage.example.test/file',
];

test('direct and group message rows allow only null or credential-free HTTPS file URLs', () => {
  assert.deepStrictEqual(parseDirectMessengerMessage(directMessage), directMessage);
  assert.deepStrictEqual(parseGroupMessengerMessage(groupMessage), groupMessage);

  for (const file_url of unsafeUrls) {
    assert.equal(parseDirectMessengerMessage({ ...directMessage, file_url }), null);
    assert.equal(parseGroupMessengerMessage({ ...groupMessage, file_url }), null);
  }
});

test('message lists reject one malformed row instead of filtering it out', () => {
  assert.deepStrictEqual(
    parseDirectMessengerMessageList([directMessage], directMessage.conversation_id),
    [directMessage],
  );
  assert.equal(
    parseDirectMessengerMessageList([directMessage, { ...directMessage, id: 'message-2', is_read: 'false' }]),
    null,
  );
  assert.deepStrictEqual(parseGroupMessengerMessageList([groupMessage]), [groupMessage]);
  assert.equal(
    parseGroupMessengerMessageList([groupMessage, { ...groupMessage, id: 'message-3', reactions: [{}] }]),
    null,
  );
});

test('direct rows must belong to the requested conversation', () => {
  assert.deepStrictEqual(
    parseDirectMessengerMessage(directMessage, directMessage.conversation_id),
    directMessage,
  );
  assert.equal(parseDirectMessengerMessage(directMessage, 'different-conversation'), null);
  assert.equal(
    parseDirectMessengerMessageList([directMessage], 'different-conversation'),
    null,
  );
});

test('message contracts require dates, message kinds, attachment metadata, and reaction fields', () => {
  for (const malformed of [
    { ...directMessage, id: '' },
    { ...directMessage, created_at: 'not-a-date' },
    { ...directMessage, message_type: 'unknown' },
    { ...directMessage, attachments: {} },
    { ...directMessage, message_type: 'file', content: '', attachments: [{ ...attachment, sha256: 'bad' }] },
  ]) {
    assert.equal(parseDirectMessengerMessage(malformed), null);
  }
  for (const malformed of [
    { ...groupMessage, room_id: '' },
    { ...groupMessage, created_at: 'not-a-date' },
    { ...groupMessage, unread_count: -1 },
    { ...groupMessage, attachments: {} },
    { ...groupMessage, reactions: [{ reaction: '👍', count: 1, reacted_by_me: 'false' }] },
  ]) {
    assert.equal(parseGroupMessengerMessage(malformed), null);
  }
});

test('direct pages and group client apply the shared row contract before updating UI state', () => {
  const directSources = [
    readFileSync('web/src/app/chat/page.tsx', 'utf8'),
    readFileSync('web/src/app/dashboard/chat/page.tsx', 'utf8'),
  ];
  for (const source of directSources) {
    assert.match(source, /parseDirectMessengerMessageList\([\s\S]*?activeConversationId/);
    assert.match(source, /parseDirectMessengerMessage\([\s\S]*?activeConversationId/);
  }
  const groupClient = readFileSync('web/src/lib/group-chat-client.ts', 'utf8');
  const groupPage = readFileSync('web/src/app/dashboard/group-chat/page.tsx', 'utf8');
  assert.match(groupClient, /parseGroupMessengerMessageList\(result\.messages\)/);
  assert.match(groupClient, /requireGroupChatMessage\(rawResult\.message\)/);
  assert.match(groupPage, /setLoadError\(classifyGroupChatError\(error\)\.message\)/);
});
