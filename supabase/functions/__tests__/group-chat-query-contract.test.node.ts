import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const edge = readFileSync(
  join(process.cwd(), 'supabase/functions/group-chat/index.ts'),
  'utf8',
);

function scope(startMarker: string, endMarker: string) {
  const start = edge.indexOf(startMarker);
  const end = edge.indexOf(endMarker, start + startMarker.length);
  assert.ok(start > -1, `missing start marker: ${startMarker}`);
  assert.ok(end > start, `missing end marker: ${endMarker}`);
  return edge.slice(start, end);
}

test('group-chat rejects null and malformed member pages instead of treating them as empty', () => {
  const members = scope(
    'async function listEligibleMembers()',
    'async function getEligibleFcMemberByActorId',
  );
  assert.match(edge, /from '\.\.\/_shared\/query-result-contract\.ts'/);
  assert.match(members, /parseQueryRows\(result\.data, isFcActorProfileListRow\)/);
  assert.match(members, /parseQueryRows\(result\.data, isManagerAccountListRow\)/);
  assert.match(members, /parseQueryRows\(result\.data, isAdminAccountListRow\)/);
  assert.doesNotMatch(members, /result\.data \?\? \[\]/);
  assert.doesNotMatch(members, /fcResult\.data \?\? \[\]/);
});

test('group-chat validates message, search, context, reaction, read-state, and count rows', () => {
  const messages = scope('async function fetchMessages', 'async function findExistingActiveSearchRoom');
  const search = scope('async function handleSearch', 'async function handleContext');
  const context = scope('async function handleContext', 'async function attachmentMapForMessages');
  const reactions = scope('async function listReactions', 'function groupReactionsByMessageId');
  const reads = scope('async function getReadState', 'function buildReplyContent');
  const unread = scope('async function countUnread', 'async function upsertRead');

  assert.match(messages, /parseQueryRows\(data, isMessageRow\)/);
  assert.match(
    messages,
    /\.order\('created_at', \{ ascending: false \}\)[\s\S]*\.order\('id', \{ ascending: false \}\)[\s\S]*\.limit\(safeLimit\)/,
  );
  assert.match(search, /parseQueryRows\(data, isGroupChatSearchMessageRow\)/);
  assert.match(context, /parseQueryRows\(beforeResult\.data, isMessageRow\)/);
  assert.match(context, /parseQueryRows\(afterResult\.data, isMessageRow\)/);
  assert.doesNotMatch(context, /\.is\('deleted_at', null\)/);
  assert.match(
    context,
    /\.order\('created_at', \{ ascending: false \}\)[\s\S]*\.order\('id', \{ ascending: false \}\)/,
  );
  assert.match(
    context,
    /\.order\('created_at', \{ ascending: true \}\)[\s\S]*\.order\('id', \{ ascending: true \}\)/,
  );
  assert.match(reactions, /parseQueryRows\(page\.data, isReactionRow\)/);
  assert.match(reads, /parseQueryRows\(page\.data, isReadStateRow\)/);
  assert.match(unread, /parseQueryCount\(count\)/);
  assert.doesNotMatch(unread, /count \?\? 0/);
});

test('group-chat reuses strict shared app-push row guards', () => {
  assert.match(edge, /from '\.\.\/_shared\/notification-preferences\.ts'/);
  assert.match(edge, /isAppPreferenceActorRow/);
  assert.match(edge, /isAppPushPreferenceRow/);
  assert.doesNotMatch(edge, /function isAppPushPreferenceRow\(/);
  assert.doesNotMatch(edge, /isNullableBoolean\(value\.enabled\)/);
});

test('group-chat pages room-dependent sets beyond the Data API row cap', () => {
  const permissions = scope('async function listSendPermissions', 'function applySendPermissionsToMembers');
  const reactions = scope('async function listReactions', 'function groupReactionsByMessageId');
  const reads = scope('async function listReadStates', 'function buildReplyContent');

  for (const scopedSource of [permissions, reactions, reads]) {
    assert.match(scopedSource, /collectGroupChatDataApiPages/);
    assert.match(scopedSource, /\.range\(from, to\)/);
  }
  assert.match(permissions, /\.order\('actor_id'/);
  assert.match(reads, /\.order\('actor_id'/);
  assert.match(reactions, /chunkGroupChatDataApiValues\(ids\)/);
  assert.match(reactions, /\.order\('message_id'[\s\S]*\.order\('actor_id'/);
  assert.match(reactions, /new Set\(rowKeys\)\.size !== rowKeys\.length/);
});

test('group-chat requires an exact existing message and exact read upsert receipt', () => {
  const upsert = scope('async function upsertRead', 'function countAcceptedExpoTickets');
  const markRead = scope('async function handleMarkRead', 'async function handlePreferences');

  assert.match(markRead, /await getMessageInRoom\(room\.id, messageId\)/);
  assert.match(markRead, /return fail\('not_found'/);
  assert.match(markRead, /await upsertRead\(room\.id, actor\.id, message\)/);
  assert.match(upsert, /\.select\('room_id,actor_id,last_read_at,last_read_message_id'\)/);
  assert.match(upsert, /data\.room_id !== roomId/);
  assert.match(upsert, /data\.actor_id !== actorId/);
  assert.match(upsert, /data\.last_read_message_id !== lastReadMessageId/);
  assert.match(upsert, /Date\.parse\(data\.last_read_at\) !== Date\.parse\(lastReadAt\)/);
});

test('group-chat confirms exact permission, reaction, and attachment deletion state', () => {
  const permission = scope('async function handleMemberSendPermission', 'async function getMessageInRoom');
  const reaction = scope('async function handleReactionSet', 'async function handleDelete');
  const deletion = scope('async function handleDelete', 'serve(async');

  assert.match(permission, /data\.actor_id !== targetActorId/);
  assert.match(permission, /data\.can_send_messages !== canSendMessages/);
  assert.match(reaction, /\.from\('group_chat_reactions'\)/);
  assert.match(reaction, /persisted\.data\.reaction !== persistedReaction/);
  assert.match(deletion, /result\.deleted !== true/);
  assert.match(deletion, /result\.batchId !== message\.attachment_batch_id/);
  assert.match(deletion, /deletedMessage\.deleted_at === null/);
  assert.match(deletion, /deletedMessage\.deleted_by_actor_id !== actor\.id/);
  assert.doesNotMatch(deletion, /: message\.attachment_batch_id/);
});
