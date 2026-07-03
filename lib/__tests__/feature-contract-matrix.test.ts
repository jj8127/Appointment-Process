import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function readRepoFile(path: string) {
  return readFileSync(join(root, path), 'utf8');
}

describe('cross-surface feature contract matrix', () => {
  it('documents the high-risk shared business contracts', () => {
    const matrix = readRepoFile('docs/handbook/feature-contract-matrix.md');
    const contractMap = JSON.parse(readRepoFile('docs/handbook/contract-test-map.json'));

    expect(matrix).toContain('Messenger interactions');
    expect(matrix).toContain('Board and notices');
    expect(matrix).toContain('Login and session');
    expect(matrix).toContain('Roles and permissions');
    expect(matrix).toContain('Designer visibility');
    expect(matrix).toContain('Notification and unread routing');
    expect(matrix).toContain('External links and files');
    expect(matrix).toContain('Sensitive data');

    expect(contractMap.default_enforced).toBe(true);
    expect(contractMap.rules.map((rule: { id: string }) => rule.id)).toEqual(
      expect.arrayContaining([
        'messenger-interactions',
        'board-and-notices',
        'role-session-visibility',
        'request-board-status-notifications',
        'files-links-sensitive-data',
      ]),
    );
  });

  it('keeps every mobile messenger surface on the shared link and action contract', () => {
    const chatSource = readRepoFile('app/chat.tsx');
    const groupChatSource = readRepoFile('app/group-chat.tsx');
    const requestBoardMessengerSource = readRepoFile('app/request-board-messenger.tsx');
    const linkifiedSource = readRepoFile('components/LinkifiedSelectableText.tsx');
    const linkifiedActionsSource = readRepoFile('lib/linkified-text-actions.ts');
    const actionSheetSource = readRepoFile('components/MessengerMessageActionSheet.tsx');

    for (const source of [chatSource, groupChatSource, requestBoardMessengerSource]) {
      expect(source).toContain('LinkifiedSelectableText');
      expect(source).toContain('copyTextWithFeedback');
      expect(source).not.toContain('Clipboard.setStringAsync');
      expect(source).toContain('openMessageActions');
      expect(source).toContain('onLongPress={() => openMessageActions(item)}');
      expect(source).toContain("from '@/components/MessengerMessageActionSheet'");
      expect(source).toContain('<MessengerMessageActionSheet');
      const actionHandlerStart = source.indexOf('openMessageActions');
      const actionHandlerEnd = source.indexOf('const formatTime', actionHandlerStart);
      const actionHandlerSource = source.slice(
        actionHandlerStart,
        actionHandlerEnd > actionHandlerStart ? actionHandlerEnd : actionHandlerStart + 1200,
      );
      expect(actionHandlerSource).not.toContain('const actions = [');
    }

    expect(actionSheetSource).toContain('export const MESSENGER_REACTIONS');
    expect(actionSheetSource).toContain('감정 남기기');
    expect(actionSheetSource).toContain('선택 복사');
    expect(actionSheetSource).toContain('답장');
    expect(actionSheetSource).toContain('공지');
    expect(actionSheetSource).toContain('삭제');
    expect(requestBoardMessengerSource).toContain('rbDeleteMessage');
    expect(requestBoardMessengerSource).toContain('rbDeleteDmMessage');
    expect(requestBoardMessengerSource).toContain('selectCopyMessage');
    expect(requestBoardMessengerSource).toContain('onSelectCopy={');
    expect(requestBoardMessengerSource).toContain('selectable={false}');
    expect(linkifiedSource).toContain('openLinkExternallyWithFeedback');
    expect(linkifiedSource).toContain('showLinkifiedTextOptions');
    expect(linkifiedSource).not.toContain('Clipboard.setStringAsync');
    expect(linkifiedSource).not.toContain('Alert.alert');
    expect(linkifiedActionsSource).toContain('openExternalUrl(normalized, { preferExternalBrowser: true })');
    expect(linkifiedActionsSource).toContain('copyTextWithFeedback');
    expect(linkifiedSource).toContain('const textSelectable = selectable && !hasLinks');
    expect(linkifiedSource).toContain('selectable={false}');
  });

  it('keeps contract-sensitive files mapped to regression evidence', () => {
    const contractMap = JSON.parse(readRepoFile('docs/handbook/contract-test-map.json'));
    const governanceSource = readRepoFile('scripts/ci/check-governance.mjs');
    const notificationRouteTestSource = readRepoFile('lib/__tests__/notification-route.test.ts');
    const externalUrlTestSource = readRepoFile('lib/__tests__/external-url.test.ts');
    const requestBoardSessionTestSource = readRepoFile('lib/__tests__/request-board-session.test.ts');
    const messengerRule = contractMap.rules.find((rule: { id: string }) => rule.id === 'messenger-interactions');
    const boardRule = contractMap.rules.find((rule: { id: string }) => rule.id === 'board-and-notices');
    const roleRule = contractMap.rules.find((rule: { id: string }) => rule.id === 'role-session-visibility');
    const notificationRule = contractMap.rules.find((rule: { id: string }) => rule.id === 'request-board-status-notifications');
    const filesRule = contractMap.rules.find((rule: { id: string }) => rule.id === 'files-links-sensitive-data');

    expect(messengerRule.prefixes).toEqual(
      expect.arrayContaining([
        'app/chat.tsx',
        'app/group-chat.tsx',
        'app/request-board-messenger.tsx',
        'components/MessageUnreadReceiptBadge.tsx',
        'components/LinkifiedSelectableText.tsx',
        'lib/message-read-receipts.ts',
        'web/src/app/dashboard/chat/page.tsx',
        'web/src/lib/message-read-receipts.ts',
      ]),
    );
    expect(messengerRule.requires_any).toEqual(
      expect.arrayContaining([
        'lib/__tests__/feature-contract-matrix.test.ts',
        'docs/handbook/feature-contract-matrix.md',
      ]),
    );
    expect(boardRule.prefixes).toEqual(
      expect.arrayContaining([
        'app/board.tsx',
        'app/board-detail.tsx',
        'app/admin-board-manage.tsx',
        'app/notice.tsx',
        'app/notice-detail.tsx',
        'lib/board-attachment-actions.ts',
        'lib/board-comment-actions.ts',
        'lib/board-feedback-alerts.ts',
        'lib/board-reaction-state.ts',
        'web/src/app/dashboard/board/',
        'web/src/app/dashboard/notifications/',
        'web/src/app/api/admin/notices/',
        'supabase/functions/board-',
      ]),
    );
    expect(boardRule.requires_any).toEqual(
      expect.arrayContaining([
        'lib/__tests__/board-attachment-actions.test.ts',
        'lib/__tests__/board-comment-actions.test.ts',
        'lib/__tests__/board-feedback-alerts.test.ts',
        'lib/__tests__/board-reaction-state.test.ts',
        'lib/__tests__/admin-web-board-source.test.ts',
        'lib/__tests__/board-category-contract.test.ts',
        'lib/__tests__/notification-route.test.ts',
        'docs/handbook/backend/board-api-and-notice-model.md',
      ]),
    );
    expect(roleRule.requires_any).toContain('docs/handbook/role-permission-matrix.md');
    expect(roleRule.prefixes).toEqual(
      expect.arrayContaining([
        'app/login.tsx',
        'lib/saved-login-credentials.ts',
        'supabase/functions/login-with-password/',
        'supabase/functions/refresh-app-session/',
        'supabase/functions/sync-request-board-session/',
      ]),
    );
    expect(notificationRule.requires_any).toEqual(
      expect.arrayContaining([
        'lib/__tests__/notification-route.test.ts',
        'docs/handbook/feature-contract-matrix.md',
      ]),
    );
    expect(filesRule.requires_any).toEqual(
      expect.arrayContaining([
        'lib/__tests__/external-url.test.ts',
        'docs/handbook/data/storage-and-attachments.md',
      ]),
    );
    expect(filesRule.prefixes).toEqual(
      expect.arrayContaining([
        'web/src/app/api/admin/resident-numbers/',
        'web/src/hooks/use-resident-number.ts',
        'web/src/lib/resident-number-route-handler.ts',
        'web/src/lib/resident-number-route-request.ts',
        'web/src/lib/resident-number-edge-response.ts',
        'web/src/lib/server-resident-numbers.ts',
      ]),
    );
    expect(filesRule.requires_any).toEqual(
      expect.arrayContaining([
        'web/src/lib/resident-number-route-handler.test.ts',
        'web/src/lib/resident-number-route-request.test.ts',
        'web/src/lib/resident-number-edge-response.test.ts',
      ]),
    );
    expect(notificationRouteTestSource).toContain('resolveRequestBoardNotificationRoute');
    expect(notificationRouteTestSource).toContain('request_board_message');
    expect(externalUrlTestSource).toContain('normalizeExternalUrl');
    expect(externalUrlTestSource).toContain('stripTrailingUrlPunctuation');
    expect(requestBoardSessionTestSource).toContain('canUseRequestBoardSession');
    expect(requestBoardSessionTestSource).toContain('deriveRequestBoardFlags');
    expect(governanceSource).toContain('docs/handbook/contract-test-map.json');
    expect(governanceSource).toContain('git ls-files --others --exclude-standard');
    expect(governanceSource).toContain('collectTriggeredContractRules');
    expect(governanceSource).toContain('Feature contract violation');
  });
});
