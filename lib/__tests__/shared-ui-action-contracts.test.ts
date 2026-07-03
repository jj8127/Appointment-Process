import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

const auditScriptPath = join(root, 'scripts/audit/shared-ui-contract-audit.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { CONTRACT_AUDIT_CATEGORIES, scanSharedUiContracts } = require(auditScriptPath);

function readRepoFile(path: string) {
  return readFileSync(join(root, path), 'utf8');
}

describe('shared UI/action primitive audit', () => {
  it('tracks every high-risk UI and action primitive category', () => {
    const categoryIds = CONTRACT_AUDIT_CATEGORIES.map((category: { id: string }) => category.id);

    expect(categoryIds).toEqual(
      expect.arrayContaining([
        'mobile-alerts',
        'mobile-buttons',
        'modals-and-sheets',
        'copy-link-open',
        'messenger-actions',
        'roles-visibility',
        'notifications-unread',
        'forms-validation',
      ]),
    );
  });

  it('produces a live inventory for the active GaramIn codebase', () => {
    const inventory = scanSharedUiContracts({ root, sampleLimit: 32 });

    expect(inventory.repo).toBe('fc-onboarding-app');
    expect(inventory.excludedGlobs).toEqual(
      expect.arrayContaining(['.archive', '.codex-tmp', '_tmp', '_codex_', '_deploy_']),
    );
    expect(inventory.categories.length).toBeGreaterThanOrEqual(8);
    expect(inventory.categories.find((category: { id: string }) => category.id === 'mobile-alerts').hitCount)
      .toBeGreaterThan(0);
    expect(inventory.categories.find((category: { id: string }) => category.id === 'mobile-buttons').hitCount)
      .toBeGreaterThan(0);
    expect(inventory.categories.find((category: { id: string }) => category.id === 'messenger-actions').samples)
      .toEqual(expect.arrayContaining([expect.stringContaining('app\\group-chat.tsx')]));
  });

  it('documents and governs shared UI/action drift prevention', () => {
    const matrix = readRepoFile('docs/handbook/feature-contract-matrix.md');
    const handbook = readRepoFile('docs/handbook/shared-ui-action-contracts.md');
    const contractMap = JSON.parse(readRepoFile('docs/handbook/contract-test-map.json'));
    const directChatSource = readRepoFile('app/chat.tsx');
    const groupChatSource = readRepoFile('app/group-chat.tsx');
    const requestBoardMessengerSource = readRepoFile('app/request-board-messenger.tsx');
    const hanwhaCommissionSource = readRepoFile('app/hanwha-commission.tsx');
    const attachmentActionsSource = readRepoFile('lib/messenger-attachment-actions.ts');
    const copyActionsSource = readRepoFile('lib/messenger-copy-actions.ts');
    const deleteActionsSource = readRepoFile('lib/messenger-delete-actions.ts');
    const nativeFileActionsSource = readRepoFile('lib/native-file-actions.ts');
    const boardAttachmentActionsSource = readRepoFile('lib/board-attachment-actions.ts');
    const boardCommentActionsSource = readRepoFile('lib/board-comment-actions.ts');
    const boardFeedbackAlertsSource = readRepoFile('lib/board-feedback-alerts.ts');
    const boardReactionStateSource = readRepoFile('lib/board-reaction-state.ts');
    const linkifiedTextSource = readRepoFile('components/LinkifiedSelectableText.tsx');
    const linkifiedTextActionsSource = readRepoFile('lib/linkified-text-actions.ts');

    expect(matrix).toContain('UI action primitives');
    expect(handbook).toContain('Shared UI Action Contracts');
    expect(handbook).toContain('scripts/audit/shared-ui-contract-audit.cjs');
    expect(handbook).toContain('openMessengerAttachment');
    expect(handbook).toContain('copyTextWithFeedback');
    expect(handbook).toContain('confirmMessengerDelete');
    expect(handbook).toContain('downloadRemoteFileToUserStorage');
    expect(handbook).toContain('openBoardAttachment');
    expect(handbook).toContain('showLinkifiedTextOptions');
    expect(handbook).toContain('showBoardCommentActions');
    expect(handbook).toContain('showBoardFeedbackAlert');
    expect(handbook).toContain('applyBoardReactionUpdate');
    expect(attachmentActionsSource).toContain('openExternalUrl');
    expect(attachmentActionsSource).toContain('Alert.alert');
    expect(copyActionsSource).toContain('Clipboard.setStringAsync');
    expect(copyActionsSource).toContain('Alert.alert');
    expect(deleteActionsSource).toContain('Alert.alert');
    expect(nativeFileActionsSource).toContain('FileSystem.downloadAsync');
    expect(boardAttachmentActionsSource).toContain('openExternalUrl(signedUrl)');
    expect(boardAttachmentActionsSource).toContain('첨부파일을 열 수 없습니다.');
    expect(boardCommentActionsSource).toContain('댓글 관리');
    expect(boardCommentActionsSource).toContain("style: 'destructive'");
    expect(boardFeedbackAlertsSource).toContain('반응 처리에 실패했습니다.');
    expect(boardFeedbackAlertsSource).toContain('댓글 내용을 입력해주세요.');
    expect(boardReactionStateSource).toContain('buildBoardReactionCounts');
    expect(boardReactionStateSource).toContain('applyBoardReactionUpdate');
    expect(linkifiedTextActionsSource).toContain('openExternalUrl');
    expect(linkifiedTextActionsSource).toContain('copyTextWithFeedback');
    expect(linkifiedTextActionsSource).toContain('Alert.alert');
    expect(linkifiedTextSource).toContain('showLinkifiedTextOptions');
    expect(linkifiedTextSource).toContain('openLinkExternallyWithFeedback');
    expect(linkifiedTextSource).not.toContain('Clipboard.setStringAsync');
    expect(linkifiedTextSource).not.toContain('Alert.alert');
    expect(directChatSource).toContain('openMessengerAttachment');
    expect(groupChatSource).toContain('openMessengerAttachment');
    for (const source of [directChatSource, groupChatSource, requestBoardMessengerSource]) {
      expect(source).toContain('copyTextWithFeedback');
      expect(source).toContain('confirmMessengerDelete');
      expect(source).not.toContain('Clipboard.setStringAsync');
      expect(source).not.toContain("Alert.alert('메시지 삭제'");
    }
    expect(directChatSource).not.toContain('Linking.openURL');
    expect(groupChatSource).not.toContain('Linking.openURL');
    for (const source of [requestBoardMessengerSource, hanwhaCommissionSource]) {
      expect(source).toContain('downloadRemoteFileToUserStorage');
      expect(source).not.toContain('FileSystem.downloadAsync');
      expect(source).not.toContain('StorageAccessFramework');
    }

    const sharedRule = contractMap.rules.find(
      (rule: { id: string }) => rule.id === 'shared-ui-action-primitives',
    );
    expect(sharedRule).toBeTruthy();
    expect(sharedRule.prefixes).toEqual(
      expect.arrayContaining([
        'components/Button.tsx',
        'components/AppAlertProvider.tsx',
        'components/MessengerMessageActionSheet.tsx',
        'components/MessageUnreadReceiptBadge.tsx',
        'components/LinkifiedSelectableText.tsx',
        'lib/messenger-attachment-actions.ts',
        'lib/messenger-copy-actions.ts',
        'lib/messenger-delete-actions.ts',
        'lib/linkified-text-actions.ts',
        'lib/native-file-actions.ts',
        'lib/board-attachment-actions.ts',
        'lib/board-comment-actions.ts',
        'lib/board-feedback-alerts.ts',
        'lib/board-reaction-state.ts',
        'app/board.tsx',
        'app/admin-board-manage.tsx',
        'scripts/audit/shared-ui-contract-audit.cjs',
      ]),
    );
    expect(sharedRule.requires_any).toEqual(
      expect.arrayContaining([
        'lib/__tests__/shared-ui-action-contracts.test.ts',
        'docs/handbook/shared-ui-action-contracts.md',
      ]),
    );
  });
});
