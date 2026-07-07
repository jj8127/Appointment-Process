import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const appRoot = join(__dirname, '..', '..', 'app');
const componentRoot = join(__dirname, '..', '..', 'components');

function readAppFile(fileName: string) {
  return readFileSync(join(appRoot, fileName), 'utf8');
}

function readComponentFile(fileName: string) {
  return readFileSync(join(componentRoot, fileName), 'utf8');
}

describe('group chat mobile wiring', () => {
  it('exposes the group chat card from the messenger hub', () => {
    const source = readAppFile('messenger.tsx');

    expect(source).toContain('가람PA 단톡방');
    expect(source).toContain("router.push('/group-chat')");
    expect(source).toContain('groupChatBootstrap');
    expect(source).toContain('canUseGroupChat &&');
    expect(source).not.toContain("staffType !== 'developer'");
  });

  it('registers the group chat route in the Expo stack', () => {
    const source = readAppFile('_layout.tsx');

    expect(source).toContain('Stack.Screen name="group-chat"');
  });

  it('supports message sending, attachment sending, keyboard persistence, and subscription cleanup', () => {
    const source = readAppFile('group-chat.tsx');

    expect(source).toContain('groupChatSend');
    expect(source).toContain('classifyGroupChatError');
    expect(source).toContain('showGroupChatErrorAlert(error)');
    expect(source).toContain('buildOptimisticMessage');
    expect(source).toContain('sendOptimisticToServer');
    expect(source).toContain('send_status');
    expect(source).toContain('DocumentPicker.getDocumentAsync');
    expect(source).toContain('ImagePicker.launchImageLibraryAsync');
    expect(source).toContain('keyboardShouldPersistTaps="handled"');
    expect(source).toContain('supabase.removeChannel(channel)');
  });

  it('renders internet URLs as tappable, underlined links in group chat messages', () => {
    const source = readAppFile('group-chat.tsx');

    expect(source).toContain('LinkifiedSelectableText');
    expect(source).toContain('msgLinkText');
  });

  it('keeps direct messenger text linkified too', () => {
    const source = readAppFile('chat.tsx');

    expect(source).toContain('LinkifiedSelectableText');
    expect(source).toContain('msgLinkText');
  });

  it('shows KakaoTalk-style unread recipient counts on sent messages', () => {
    const source = readAppFile('group-chat.tsx');
    const badgeSource = readComponentFile('MessageUnreadReceiptBadge.tsx');

    expect(source).toContain('unread_count');
    expect(source).toContain("from '@/components/MessageUnreadReceiptBadge'");
    expect(source).toContain('<MessageUnreadReceiptBadge');
    expect(source).toContain('showUnreadCount');
    expect(source).toContain('messageBubbleLine');
    expect(source).not.toContain('<Text style={styles.messageUnreadCount}>');
    expect(badgeSource).toContain('formatUnreadReceiptCount');
    expect(badgeSource).toContain('messageUnreadCount');
  });

  it('keeps direct and request-board messengers on the same unread recipient count contract', () => {
    const directSource = readAppFile('chat.tsx');
    const requestBoardSource = readAppFile('request-board-messenger.tsx');
    const badgeSource = readComponentFile('MessageUnreadReceiptBadge.tsx');

    for (const source of [directSource, requestBoardSource]) {
      expect(source).toContain("from '@/lib/message-read-receipts'");
      expect(source).toContain('getDirectMessageUnreadCount');
      expect(source).toContain("from '@/components/MessageUnreadReceiptBadge'");
      expect(source).toContain('<MessageUnreadReceiptBadge');
      expect(source).not.toContain('<Text style={styles.messageUnreadCount}>');
    }

    expect(directSource).toContain('messageBubbleLine');
    expect(requestBoardSource).toContain('isRead: message.is_read');
    expect(badgeSource).toContain('formatUnreadReceiptCount');
    expect(badgeSource).toContain('messageUnreadCount');
  });

  it('wires reply, reaction, and soft-delete actions from message long press', () => {
    const source = readAppFile('group-chat.tsx');
    const actionSheetSource = readComponentFile('MessengerMessageActionSheet.tsx');

    expect(source).toContain('replyTarget');
    expect(source).toContain('actionMessage');
    expect(source).toContain('handleMessagePress');
    expect(source).toContain("import * as Haptics from 'expo-haptics'");
    expect(source).toContain('Haptics.ImpactFeedbackStyle.Light');
    expect(source).toContain('groupChatSetReaction');
    expect(source).toContain('groupChatDeleteMessage');
    expect(source).toContain('onPress={() => handleMessagePress(item)}');
    expect(source).toContain('onLongPress={() => openMessageActions(item)}');
    expect(source).toContain('handleReplyAction');
    expect(source).toContain('MESSENGER_REACTIONS');
    expect(actionSheetSource).toContain('감정 남기기');
    expect(actionSheetSource).toContain('답장');
    expect(actionSheetSource).toContain('삭제');
  });

  it('renders a KakaoTalk-style message action menu with copy, select-copy, and notice actions', () => {
    const source = readAppFile('group-chat.tsx');
    const actionSheetSource = readComponentFile('MessengerMessageActionSheet.tsx');

    expect(source).toContain('copyTextWithFeedback');
    expect(source).not.toContain('Clipboard.setStringAsync');
    expect(source).toContain('selectCopyMessage');
    expect(source).toContain("from '@/components/MessengerMessageActionSheet'");
    expect(source).toContain('<MessengerMessageActionSheet');
    expect(source).toContain('<MessageSelectCopySheet');
    expect(actionSheetSource).toContain('actionMenuBackdrop');
    expect(actionSheetSource).toContain('actionMenu');
    expect(actionSheetSource).toContain('복사');
    expect(actionSheetSource).toContain('선택 복사');
    expect(actionSheetSource).toContain('공지');
    expect(source).toContain('groupChatSetNotice');
    expect(source).toContain('groupChatClearNotice');
    expect(source).toContain('canManageNotice &&');
    expect(source).toContain('actionMessage &&');
  });

  it('prevents native text selection from intercepting message long press', () => {
    const source = readAppFile('group-chat.tsx');
    const linkifiedSource = readComponentFile('LinkifiedSelectableText.tsx');
    const actionSheetSource = readComponentFile('MessengerMessageActionSheet.tsx');
    const messageContentSection = source.slice(
      source.indexOf('<LinkifiedSelectableText'),
      source.indexOf('const renderItem'),
    );

    expect(messageContentSection).toContain('selectable={false}');
    expect(linkifiedSource).toContain('const textSelectable = selectable && !hasLinks');
    expect(linkifiedSource).toContain('const nonSelectableStyle = textSelectable ? undefined : styles.nonSelectableText');
    expect(linkifiedSource).toContain('selectable={textSelectable}');
    expect(linkifiedSource).toContain('selectable={false}');
    expect(linkifiedSource).toContain("userSelect: 'none'");
    expect(actionSheetSource).toContain('<Text selectable style={styles.selectCopyText}>');
  });

  it('renders the current group chat notice as a fixed top banner', () => {
    const source = readAppFile('group-chat.tsx');

    expect(source).toContain('const [notice, setNotice]');
    expect(source).toContain('setNotice(data.notice ?? null)');
    expect(source).toContain('noticeBanner');
    expect(source).toContain('notice.message');
    expect(source).toContain('handleNoticeClear');
  });

  it('keeps the outgoing group chat bubble on the GaramIn orange style', () => {
    const source = readAppFile('group-chat.tsx');

    expect(source).toContain('bubbleMe: { backgroundColor: HANWHA_ORANGE');
    expect(source).toContain("msgTextMe: { color: '#fff'");
  });

  it('shows an immediate file download affordance in file message cards', () => {
    const source = readAppFile('group-chat.tsx');

    expect(source).toContain('fileDownloadButton');
    expect(source).toContain('탭하여 열기');
  });

  it('exposes a searchable member list from the group chat screen', () => {
    const source = readAppFile('group-chat.tsx');

    expect(source).toContain('대화상대');
    expect(source).toContain('이름으로 검색');
    expect(source).toContain('appointment_label');
    expect(source).toContain('headquarters');
    expect(source).toContain('memberSearch');
  });

  it('keeps the member list search visible above the keyboard', () => {
    const source = readAppFile('group-chat.tsx');

    expect(source).toContain('memberSheetKeyboardAvoider');
    expect(source).toContain("behavior={Platform.OS === 'ios' ? 'padding' : 'height'}");
    expect(source).toContain('memberList: { flexShrink: 1');
  });

  it('lets staff toggle FC group chat send permission from the member list', () => {
    const source = readAppFile('group-chat.tsx');

    expect(source).toContain('Switch');
    expect(source).toContain('groupChatSetMemberSendPermission');
    expect(source).toContain('can_send_messages');
    expect(source).toContain('handleMemberSendPermissionToggle');
    expect(source).toContain('const permissionTargetActorId = result.member.actor_id');
    expect(source).toContain('sendPermissionNotice');
    expect(source).toContain("'허용' : '금지'");
    expect(source).toContain('검색 결과가 없습니다.');
  });

  it('keeps member search and send-permission toggles responsive with virtualized memoized rows', () => {
    const source = readAppFile('group-chat.tsx');

    expect(source).toContain('useDeferredValue');
    expect(source).toContain('SearchableGroupChatMember');
    expect(source).toContain('const MemberListRow = memo');
    expect(source).toContain('const searchableMembers = useMemo');
    expect(source).toContain('renderItem={renderMemberItem}');
    expect(source).toContain('initialNumToRender={18}');
    expect(source).toContain('removeClippedSubviews={Platform.OS ===');
  });

  it('keeps staff group chat input enabled regardless of per-FC send permission', () => {
    const source = readAppFile('group-chat.tsx');

    expect(source).toContain("from '@/lib/group-chat-display'");
    expect(source).toContain('isStaffGroupChatActor(actor)');
    expect(source).toContain('resolveGroupChatSendPermission(data.actor, data.can_send_messages)');
    expect(source).toContain('setCanSendMessages(resolveGroupChatSendPermission(data.actor, data.can_send_messages))');
    expect(source).not.toContain('function isStaffGroupChatActor');
    expect(source).not.toContain('function resolveCanSendMessages');
  });

  it('routes group chat notifications to the group chat screen', () => {
    const source = readAppFile('notifications.tsx');

    expect(source).toContain("category === 'group_chat_message'");
    expect(source).toContain("return '/group-chat'");
  });

  it('registers push tokens from mobile admin sessions too', () => {
    const source = readAppFile('index.tsx');
    const pushRegistrationSection = source.slice(
      source.indexOf('모바일 푸시 토큰 등록'),
      source.indexOf('const handleLogout'),
    );

    expect(pushRegistrationSection).toContain('resolvePushRegistrationDeviceRole');
    expect(pushRegistrationSection).toContain('buildPushRegistrationAttemptKey');
    expect(pushRegistrationSection).toContain('role: pushRole');
    expect(pushRegistrationSection).not.toContain("if (role !== 'fc' || !residentId) return;");
  });
});
