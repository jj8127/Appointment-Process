import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanupFailed, isGroupChatSuccess, parseUpstreamResponse } from './upstream-response-policy.ts';

const groupMessage = {
  id: '11111111-1111-4111-8111-111111111111',
  room_id: '22222222-2222-4222-8222-222222222222',
  sender_actor_id: 'fc:01012345678',
  sender_role: 'fc',
  sender_phone: '01012345678',
  sender_name: '테스트',
  content: '안녕하세요',
  message_type: 'text',
  file_url: null,
  file_name: null,
  file_size: null,
  attachments: [],
  created_at: '2026-10-13T01:02:03.000Z',
  unread_count: 1,
  reply_to_message_id: null,
  reply_to_sender_name: null,
  reply_to_content: null,
  deleted_at: null,
  deleted_by_actor_id: null,
  reactions: [{ reaction: '👍', count: 1, reacted_by_me: true }],
} as const;

const groupMember = {
  actor_id: 'fc:01012345678',
  role: 'fc',
  phone: '01012345678',
  name: '테스트',
  headquarters: '1본부',
  appointment_label: '위촉',
  can_send_messages: true,
} as const;

const groupBootstrap = {
  ok: true,
  room: { id: groupMessage.room_id, slug: 'garampa-default', title: '가람PA 단톡방' },
  actor: { id: groupMember.actor_id, role: 'fc', phone: groupMember.phone, name: groupMember.name },
  can_send_messages: true,
  member_count: 1,
  members: [groupMember],
  muted: false,
  unread_count: 1,
  last_read_at: '2026-10-13T01:00:00.000Z',
  last_message: groupMessage,
  messages: [groupMessage],
  notice: null,
} as const;

test('malformed and empty acknowledgements are rejected', () => {
  for (const raw of ['', 'null', '[]', 'garbage', '{"message":"ok"}', '{"ok":1}']) {
    assert.equal(parseUpstreamResponse(raw), null);
  }
  assert.deepEqual(parseUpstreamResponse('{"ok":true,"data":null}'), { ok: true, data: null });
});
test('action success requires the consumed fields', () => {
  assert.equal(isGroupChatSuccess('group_chat_bootstrap', { ok: true }), false);
  assert.equal(isGroupChatSuccess('group_chat_delete', { ok: true }), false);
  assert.equal(isGroupChatSuccess('group_chat_notice_clear', { ok: true }), false);
  assert.equal(isGroupChatSuccess('group_chat_notice_clear', { ok: true, notice: null }), true);
  assert.equal(isGroupChatSuccess('group_chat_delete', { ok: true, message: groupMessage }), true);
});

test('group-chat bootstrap validates every member, message, reaction, and read field', () => {
  assert.equal(isGroupChatSuccess('group_chat_bootstrap', groupBootstrap), true);
  assert.equal(isGroupChatSuccess('group_chat_bootstrap', {
    ...groupBootstrap,
    members: [{ ...groupMember, actor_id: null }],
  }), false);
  assert.equal(isGroupChatSuccess('group_chat_bootstrap', {
    ...groupBootstrap,
    messages: [{ ...groupMessage, reactions: [{ reaction: '👍', count: '1', reacted_by_me: true }] }],
  }), false);
  assert.equal(isGroupChatSuccess('group_chat_bootstrap', {
    ...groupBootstrap,
    unread_count: null,
  }), false);
  assert.equal(isGroupChatSuccess('group_chat_bootstrap', {
    ...groupBootstrap,
    last_read_at: 'not-a-date',
  }), false);
});

test('group-chat search and context validate every returned row', () => {
  const result = {
    source: 'garamin_group',
    ref: { version: 1, kind: 'group_chat', roomId: groupMessage.room_id },
    messageId: groupMessage.id,
    sentAt: groupMessage.created_at,
    excerpt: groupMessage.content,
    roomLabel: '가람PA 단톡방',
    senderLabel: '테스트',
  };
  assert.equal(isGroupChatSuccess('group_chat_search', {
    ok: true,
    results: [result],
    coverage: 'bounded_first_page',
    nextCursor: null,
  }), true);
  assert.equal(isGroupChatSuccess('group_chat_search', {
    ok: true,
    results: [{ ...result, sentAt: null }],
    coverage: 'bounded_first_page',
    nextCursor: null,
  }), false);

  const context = {
    ok: true,
    roomRef: { version: 1, kind: 'group_chat', roomId: groupMessage.room_id },
    anchorMessageId: groupMessage.id,
    messages: [groupMessage],
    hasBefore: false,
    hasAfter: false,
    nextCursor: null,
  };
  assert.equal(isGroupChatSuccess('group_chat_context', context), true);
  assert.equal(isGroupChatSuccess('group_chat_context', {
    ...context,
    messages: [{ ...groupMessage, room_id: 'different-room' }],
  }), false);
  assert.equal(isGroupChatSuccess('group_chat_context', {
    ...context,
    messages: [{ ...groupMessage, unread_count: null }],
  }), false);
});

test('group-chat reaction and member permission acknowledgements validate each row', () => {
  assert.equal(isGroupChatSuccess('group_chat_reaction_set', {
    ok: true,
    reactions: groupMessage.reactions,
  }), true);
  assert.equal(isGroupChatSuccess('group_chat_reaction_set', {
    ok: true,
    reactions: [{ reaction: '👍', count: -1, reacted_by_me: true }],
  }), false);
  assert.equal(isGroupChatSuccess('group_chat_member_send_permission', {
    ok: true,
    member: groupMember,
  }), true);
  assert.equal(isGroupChatSuccess('group_chat_member_send_permission', {
    ok: true,
    member: { ...groupMember, can_send_messages: 'yes' },
  }), false);
  assert.equal(isGroupChatSuccess('group_chat_mark_read', {
    ok: true,
    read_state: {
      room_id: groupMessage.room_id,
      actor_id: groupMember.actor_id,
      last_read_at: groupMessage.created_at,
      last_read_message_id: groupMessage.id,
    },
  }), true);
  assert.equal(isGroupChatSuccess('group_chat_mark_read', {
    ok: true,
    read_state: {
      room_id: groupMessage.room_id,
      actor_id: groupMember.actor_id,
      last_read_at: null,
      last_read_message_id: groupMessage.id,
    },
  }), false);
});
test('cleanup return errors and thrown errors both preserve committed success', async () => {
  assert.equal(await cleanupFailed(async () => ({ error: null })), false);
  assert.equal(await cleanupFailed(async () => ({ error: new Error('synthetic') })), true);
  assert.equal(await cleanupFailed(async () => { throw new Error('synthetic'); }), true);
});


test('board create/update reject missing durable acknowledgement and reads reject missing data', async () => {
  const { isBoardSuccess } = await import('./upstream-response-policy.ts');
  const postId = '33333333-3333-4333-8333-333333333333';
  assert.equal(isBoardSuccess('board-update', { ok: true }), false);
  assert.equal(isBoardSuccess('board-create', { ok: true, saved: true }), false);
  assert.equal(isBoardSuccess('board-list', { ok: true }), false);
  assert.equal(isBoardSuccess('board-update', { ok: true, saved: true }), true);
  assert.equal(isBoardSuccess('board-delete', { ok: true }), false);
  assert.equal(isBoardSuccess('board-delete', {
    ok: true,
    data: { postId, cleanupPending: false },
  }, { postId }), true);
});

test('board mutation acknowledgements are bound to requested ids, fields, and actor', async () => {
  const { isBoardSuccess } = await import('./upstream-response-policy.ts');
  const postId = '33333333-3333-4333-8333-333333333333';
  const otherPostId = '44444444-4444-4444-8444-444444444444';
  const commentId = '55555555-5555-4555-8555-555555555555';
  const actor = { role: 'admin', residentId: '01012345678', displayName: '관리자' };

  assert.equal(isBoardSuccess('board-pin', {
    ok: true,
    data: {
      postId,
      isPinned: true,
      pinnedAt: '2026-10-13T01:02:03.000Z',
      pinnedByResidentId: actor.residentId,
    },
  }, { actor, postId, isPinned: true }), true);
  assert.equal(isBoardSuccess('board-pin', {
    ok: true,
    data: {
      postId: otherPostId,
      isPinned: true,
      pinnedAt: '2026-10-13T01:02:03.000Z',
      pinnedByResidentId: actor.residentId,
    },
  }, { actor, postId, isPinned: true }), false);

  assert.equal(isBoardSuccess('board-comment-update', {
    ok: true,
    data: { commentId, content: '수정 본문', editedAt: '2026-10-13T01:02:03.000Z' },
  }, { actor, commentId, content: '  수정 본문  ' }), true);
  assert.equal(isBoardSuccess('board-comment-update', {
    ok: true,
    data: { commentId, content: '다른 본문', editedAt: '2026-10-13T01:02:03.000Z' },
  }, { actor, commentId, content: '수정 본문' }), false);

  assert.equal(isBoardSuccess('board-comment-delete', {
    ok: true,
    data: { commentId, postId },
  }, { actor, commentId }), true);
  assert.equal(isBoardSuccess('board-reaction-toggle', {
    ok: true,
    data: { postId, residentId: actor.residentId, myReaction: 'heart' },
  }, { actor, postId, reactionType: 'heart' }), true);
  assert.equal(isBoardSuccess('board-reaction-toggle', {
    ok: true,
    data: { postId, residentId: '01099999999', myReaction: 'heart' },
  }, { actor, postId, reactionType: 'heart' }), false);
  assert.equal(isBoardSuccess('board-comment-like-toggle', {
    ok: true,
    data: { commentId, residentId: actor.residentId, liked: true, likeCount: 1 },
  }, { actor, commentId }), true);
  assert.equal(isBoardSuccess('board-comment-like-toggle', {
    ok: true,
    data: { commentId, residentId: actor.residentId, liked: true, likeCount: null },
  }, { actor, commentId }), false);

  assert.equal(isBoardSuccess('board-category-update', {
    ok: true,
    data: { id: postId, name: '공지', slug: 'notice', sortOrder: 1, isActive: true },
  }, { actor, id: postId, name: '공지', slug: 'notice', sortOrder: 1, isActive: true }), true);
  assert.equal(isBoardSuccess('board-category-update', {
    ok: true,
    data: { id: postId, name: '공지', slug: 'notice', sortOrder: 1, isActive: true },
  }, { actor, id: otherPostId, name: '공지' }), false);
});

test('board attachment mutation acknowledgements require the exact requested id/path set', async () => {
  const { isBoardSuccess } = await import('./upstream-response-policy.ts');
  const postId = '33333333-3333-4333-8333-333333333333';
  const attachmentId = '66666666-6666-4666-8666-666666666666';
  const secondAttachmentId = '77777777-7777-4777-8777-777777777777';
  const actor = { role: 'admin', residentId: '01012345678', displayName: '관리자' };

  assert.equal(isBoardSuccess('board-attachment-delete', {
    ok: true,
    data: {
      postId,
      deletedAttachments: [{ id: attachmentId, storagePath: `board/${postId}/one.png` }],
      cleanupPending: false,
    },
  }, { actor, postId, attachmentIds: [attachmentId] }), true);
  assert.equal(isBoardSuccess('board-attachment-delete', {
    ok: true,
    data: {
      postId,
      deletedAttachments: [{ id: secondAttachmentId, storagePath: `board/${postId}/one.png` }],
      cleanupPending: false,
    },
  }, { actor, postId, attachmentIds: [attachmentId] }), false);
  assert.equal(isBoardSuccess('board-attachment-delete', {
    ok: true,
    data: { postId, deletedAttachments: [], cleanupPending: false },
  }, { actor, postId, attachmentIds: [] }), false);

  const storagePath = `board/${postId}/one.png`;
  const files = [{ storagePath, fileName: 'one.png', fileSize: 1, fileType: 'image' }];
  assert.equal(isBoardSuccess('board-attachment-finalize', {
    ok: true,
    data: { postId, attachments: [{ id: attachmentId, storagePath }] },
  }, { actor, postId, files }), true);
  assert.equal(isBoardSuccess('board-attachment-finalize', {
    ok: true,
    data: { postId, attachments: [{ id: attachmentId, storagePath: `board/${postId}/two.png` }] },
  }, { actor, postId, files }), false);
  assert.equal(isBoardSuccess('board-attachment-finalize', {
    ok: true,
    data: { postId, attachments: [] },
  }, { actor, postId, files: [] }), false);
});
