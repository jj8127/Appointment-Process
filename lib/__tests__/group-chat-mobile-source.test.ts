import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const appRoot = join(__dirname, '..', '..', 'app');

function readAppFile(fileName: string) {
  return readFileSync(join(appRoot, fileName), 'utf8');
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

    expect(source).toContain('unread_count');
    expect(source).toContain('messageUnreadCount');
    expect(source).toContain('showUnreadCount');
    expect(source).toContain('messageBubbleLine');
  });

  it('wires reply, reaction, and soft-delete actions from message long press', () => {
    const source = readAppFile('group-chat.tsx');

    expect(source).toContain('replyTarget');
    expect(source).toContain('actionMessage');
    expect(source).toContain('handleMessagePress');
    expect(source).toContain("import * as Haptics from 'expo-haptics'");
    expect(source).toContain('Haptics.ImpactFeedbackStyle.Light');
    expect(source).toContain('groupChatSetReaction');
    expect(source).toContain('groupChatDeleteMessage');
    expect(source).toContain('onPress={() => handleMessagePress(item)}');
    expect(source).toContain('onLongPress={() => openMessageActions(item)}');
    expect(source).toContain('답장');
    expect(source).toContain('감정 남기기');
    expect(source).toContain('삭제');
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
