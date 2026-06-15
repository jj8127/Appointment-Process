import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const functionRoot = join(__dirname, '..', '..', 'supabase', 'functions');

function readFunctionFile(fileName: string) {
  return readFileSync(join(functionRoot, fileName), 'utf8');
}

describe('group chat edge notification fanout', () => {
  it('filters request-board designer device tokens from group chat push', () => {
    const source = readFunctionFile('group-chat/index.ts');

    expect(source).toContain('filterManagerTokensForNotification');
    expect(source).toContain("category: GROUP_CHAT_NOTIFICATION_CATEGORY");
    expect(source).toContain("select('expo_push_token,resident_id,role')");
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

    expect(source).toContain('async function getEligibleFcMemberByActorId');
    expect(handlerSource).toContain('await getEligibleFcMemberByActorId(targetActorId)');
    expect(handlerSource).not.toContain('listEligibleMembersWithSendPermissions(room.id)');
  });
});
