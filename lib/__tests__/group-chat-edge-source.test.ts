import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const functionRoot = join(__dirname, '..', '..', 'supabase', 'functions');

function readFunctionFile(fileName: string) {
  return readFileSync(join(functionRoot, fileName), 'utf8');
}

describe('group chat edge notification fanout', () => {
  it('matches device tokens to explicitly eligible group chat member roles', () => {
    const source = readFunctionFile('group-chat/index.ts');

    expect(source).not.toContain('filterManagerTokensForNotification');
    expect(source).toContain('selectEligibleRecipientTokens');
    expect(source).toContain('recipientRolesByPhone.get(phone)?.has(role)');
    expect(source).toContain("category: GROUP_CHAT_NOTIFICATION_CATEGORY");
    expect(source).toContain("select('expo_push_token,resident_id,role')");
  });

  it('classifies Expo HTTP and ticket outcomes without returning raw provider payloads', () => {
    const source = readFunctionFile('group-chat/index.ts');

    expect(source).toContain('countAcceptedExpoTickets');
    expect(source).toContain("status === 'ok'");
    expect(source).toContain("reason: 'provider_http_failed'");
    expect(source).toContain("reason: 'provider_ticket_rejected'");
    expect(source).toContain('push_accepted_count: provider.accepted_count');
    expect(source).toContain('push_rejected_count: provider.rejected_count');
    expect(source).not.toContain('result: providerPayload');
  });

  it('does not report recipient notification delivery as successful without an accepted push ticket', () => {
    const source = readFunctionFile('group-chat/index.ts');
    const notifyStart = source.indexOf('async function notifyRecipients');
    const notifyEnd = source.indexOf('function notificationFanoutFailureSummary', notifyStart);
    const notifySource = source.slice(notifyStart, notifyEnd);

    expect(notifySource).toContain('const hasAcceptedPush = provider.accepted_count > 0');
    expect(notifySource).toContain('&& hasAcceptedPush');
    expect(notifySource).toContain("status: ok ? 'provider_accepted' : 'partial'");
    expect(notifySource).not.toContain("? (provider.requested_count > 0 ? 'provider_accepted' : 'inbox_only')");
    expect(notifySource).toContain('notification_count: notificationInsert.inserted_count');
  });

  it('keeps a saved message successful when notification fanout is partial', () => {
    const source = readFunctionFile('group-chat/index.ts');
    const sendStart = source.indexOf('async function handleSend');
    const sendEnd = source.indexOf('async function handleMarkRead', sendStart);
    const sendSource = source.slice(sendStart, sendEnd);

    expect(sendSource).toContain('const message = data as MessageRow');
    expect(sendSource).toContain('try {');
    expect(sendSource).toContain("reason: 'notification_fanout_failed'");
    expect(sendSource).toContain('ok: true');
    expect(sendSource).toContain('read_state: { updated: readStateUpdated }');
    expect(sendSource).toContain('notification,');
    expect(sendSource).toContain('warning: postCommitWarning({ readStateUpdated, notification })');
    expect(source).toContain("code: 'notification_delivery_partial'");
  });

  it('keeps a saved message successful when the post-send read state update fails', () => {
    const source = readFunctionFile('group-chat/index.ts');
    const sendStart = source.indexOf('async function handleSend');
    const sendEnd = source.indexOf('async function handleMarkRead', sendStart);
    const sendSource = source.slice(sendStart, sendEnd);
    const persistedMessage = sendSource.indexOf('const message = data as MessageRow');
    const readTry = sendSource.indexOf('try {', persistedMessage);
    const readUpdate = sendSource.indexOf('await upsertRead(room.id, actor.id, message.id)', readTry);
    const readFailure = sendSource.indexOf("reason: 'read_state_update_failed'", readUpdate);
    const successResponse = sendSource.lastIndexOf('ok: true');

    expect(persistedMessage).toBeGreaterThan(-1);
    expect(readTry).toBeGreaterThan(persistedMessage);
    expect(readUpdate).toBeGreaterThan(readTry);
    expect(readFailure).toBeGreaterThan(readUpdate);
    expect(successResponse).toBeGreaterThan(readFailure);
    expect(source).not.toContain("code: 'read_state_update_partial'");
    expect(source).not.toContain("code: 'post_commit_partial'");
    expect(source).toContain('메시지는 저장됐지만 읽음 상태 반영을 확인하지 못했습니다.');
    expect(sendSource).not.toContain('return dbError(error, origin);\n\n  const message = data as MessageRow;\n  await upsertRead');
  });

  it('bounds Expo requests and classifies timeout or transport aborts as partial delivery', () => {
    const source = readFunctionFile('group-chat/index.ts');
    const pushStart = source.indexOf('async function sendExpoPushPayloads');
    const pushEnd = source.indexOf('async function insertNotificationsWithFallback', pushStart);
    const pushSource = source.slice(pushStart, pushEnd);

    expect(source).toContain('const EXPO_PUSH_TIMEOUT_MS = 8_000');
    expect(pushSource).toContain('signal: AbortSignal.timeout(EXPO_PUSH_TIMEOUT_MS)');
    expect(pushSource).toContain("reason: 'provider_delivery_not_accepted'");
    expect(pushSource).toContain('summary.rejected_count += chunk.length');
    expect(pushSource).not.toContain('error.message');
    expect(pushSource).not.toContain('console.warn(error');
  });

  it('uses high priority Expo push payloads for group chat messages', () => {
    const source = readFunctionFile('group-chat/index.ts');

    expect(source).toContain("priority: 'high'");
    expect(source).toContain("channelId: 'alerts'");
  });

  it('checks member send permission before inserting group chat messages', () => {
    const source = readFunctionFile('group-chat/index.ts');
    const sendStart = source.indexOf('async function handleSend');
    const permissionCheck = source.indexOf('canActorSendMessages', sendStart);
    const forbidden = source.indexOf("'send_forbidden'", sendStart);
    const insert = source.indexOf(".from('group_chat_messages')", sendStart);

    expect(source).toContain('group_chat_member_send_permission');
    expect(source).toContain('group_chat_member_send_permissions');
    expect(source).toContain('normalizeGroupChatMessageContent(payload.content)');
    expect(source).not.toContain('const content = normalizeGroupChatText(payload.content)');
    expect(permissionCheck).toBeGreaterThan(sendStart);
    expect(forbidden).toBeGreaterThan(permissionCheck);
    expect(insert).toBeGreaterThan(forbidden);
  });

  it('returns specific eligibility error codes for group chat participation limits', () => {
    const source = readFunctionFile('group-chat/index.ts');

    expect(source).toContain('getFcActorBlockReason');
    expect(source).toContain("'not_completed'");
    expect(source).toContain("'request_board_designer_only'");
    expect(source).toContain("'inactive_account'");
    expect(source).toContain('본등록이 완료되지 않아 단톡방에 참여할 수 없습니다.');
  });

  it('wires staff-only group chat notice set and clear actions', () => {
    const source = readFunctionFile('group-chat/index.ts');

    expect(source).toContain('group_chat_notice_set');
    expect(source).toContain('group_chat_notice_clear');
    expect(source).toContain("from('group_chat_notices')");
    expect(source).toContain('async function handleNoticeSet');
    expect(source).toContain('async function handleNoticeClear');
    expect(source).toContain("actor.role === 'fc'");
    expect(source).toContain('message.deleted_at');
    expect(source).toContain('notice,');
  });

  it('clears stale or deleted notice messages server-side', () => {
    const source = readFunctionFile('group-chat/index.ts');
    const currentNoticeStart = source.indexOf('async function getCurrentNotice');
    const deleteStart = source.indexOf('async function handleDelete');
    const deleteClear = source.indexOf('clearNoticeForMessage(room.id, message.id)', deleteStart);

    expect(source).toContain('async function clearNoticeForMessage');
    expect(source.indexOf('await clearNoticeForMessage(roomId, notice.message_id)', currentNoticeStart)).toBeGreaterThan(currentNoticeStart);
    expect(deleteClear).toBeGreaterThan(deleteStart);
  });

  it('uses a targeted FC lookup when changing member send permission', () => {
    const source = readFunctionFile('group-chat/index.ts');
    const handlerStart = source.indexOf('async function handleMemberSendPermission');
    const handlerEnd = source.indexOf('async function getMessageInRoom', handlerStart);
    const handlerSource = source.slice(handlerStart, handlerEnd);

    expect(source).toContain('normalizeFcGroupChatActorId');
    expect(source).toContain('async function getEligibleFcMemberByActorId');
    expect(handlerSource).toContain('const targetActorId = normalizeFcGroupChatActorId(payload.target_actor_id)');
    expect(handlerSource).toContain('await getEligibleFcMemberByActorId(targetActorId)');
    expect(handlerSource).not.toContain('listEligibleMembersWithSendPermissions(room.id)');
  });
});
