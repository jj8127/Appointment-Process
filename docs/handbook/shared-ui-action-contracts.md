doc_id: FC-SHARED-UI-ACTION-CONTRACTS
owner_repo: fc-onboarding-app
owner_area: shared-ui
audience: developer
last_verified: 2026-07-03
source_of_truth: components/* + app/* + web/src/* + scripts/audit/shared-ui-contract-audit.cjs + scripts/audit/shared-function-contract-audit.cjs

# Shared UI Action Contracts

Shared business actions must be governed by feature contracts before screen-level styling. The goal is not to force one component across React Native and web, but to keep equivalent behavior identical.

## Governed Primitives

- Buttons and icon actions: variants, disabled/loading state, destructive styling, and touch target policy.
- Alerts, confirms, modals, and action sheets: cancel behavior, destructive copy, close behavior, and accessibility basics.
- Messenger actions: long press, copy, select copy, reply, notice, delete, reactions, read counts, and attachment actions.
- Copy, external link, and file-open flows: URL normalization, safe external opening, clipboard feedback, and file fallback.
- Role and visibility rules: manager read-only, developer support account visibility, designer visibility, and test account exceptions.
- Notifications and unread counts: destination routing, badge/unread identity, and read-state display.
- Forms and validation: required field copy, validation source, input normalization, and submission guards.

## Audit Command

Run the live inventory before broad UI or action refactors:

```bash
node scripts/audit/shared-ui-contract-audit.cjs
node scripts/audit/shared-ui-contract-audit.cjs --json
```

The audit excludes archive, temporary, deployment, generated, and dependency folders. New clusters should be added to the inventory categories before implementation.

## Implementation Rule

When touching governed primitives, update at least one of:

- `lib/__tests__/shared-ui-action-contracts.test.ts`
- `docs/handbook/shared-ui-action-contracts.md`
- `docs/handbook/feature-contract-matrix.md`
- `docs/handbook/contract-test-map.json`

Screen-only implementations are allowed only when the feature is intentionally unique and the exception is documented in the relevant handbook page.

Messenger attachment opens in `app/chat.tsx` and `app/group-chat.tsx` must use `openMessengerAttachment` from `lib/messenger-attachment-actions.ts`. The helper owns external URL opening through `openExternalUrl`, failure alerts, and logging. Do not call `Linking.openURL` directly from messenger attachment bubbles.

Messenger clipboard writes in `app/chat.tsx`, `app/group-chat.tsx`, and `app/request-board-messenger.tsx` must use `copyTextWithFeedback` from `lib/messenger-copy-actions.ts`. The helper owns `Clipboard.setStringAsync`, empty-copy handling, success/failure alerts, and copy failure logging. Do not call `Clipboard.setStringAsync` directly from messenger surfaces.

Linkified messenger/body text actions in `components/LinkifiedSelectableText.tsx` must use `showLinkifiedTextOptions` and `openLinkExternallyWithFeedback` from `lib/linkified-text-actions.ts`. The helper owns link option alerts, external open failure feedback, and link copy feedback through `copyTextWithFeedback`; the component should not call `Alert.alert` or `Clipboard.setStringAsync` directly.

Messenger sent-message unread receipt display in `app/chat.tsx`, `app/group-chat.tsx`, and `app/request-board-messenger.tsx` must render through `MessageUnreadReceiptBadge` from `components/MessageUnreadReceiptBadge.tsx`. Direct and request-board 1:1 chats should keep count calculation in `getDirectMessageUnreadCount`; group chat can pass room `unread_count`, but screens should not own local `messageUnreadCount` text styles or formatting branches.

Messenger delete confirmations in `app/chat.tsx`, `app/group-chat.tsx`, and `app/request-board-messenger.tsx` must use `confirmMessengerDelete` from `lib/messenger-delete-actions.ts`. The helper owns the delete confirmation copy, destructive action style, failure alert, and failure logging. Screen code should only provide the delete operation and any domain-specific error formatter.

Native download/save flows in `app/request-board-messenger.tsx` and `app/hanwha-commission.tsx` must use `downloadRemoteFileToUserStorage` from `lib/native-file-actions.ts`. The helper owns temporary download paths, Android Storage Access Framework writes, iOS document copies, duplicate filename fallback, cleanup, and destination labels. Do not call `FileSystem.downloadAsync` or `StorageAccessFramework` directly from those screens.

Board attachment file opens in `app/board.tsx` and `app/admin-board-manage.tsx` must use `openBoardAttachment` from `lib/board-attachment-actions.ts`. The helper owns missing signed URL handling, external opener dispatch, failure feedback, and optional error logging; screens only pass `openExternalUrl`, `Alert.alert`, and the board logger.

Board comment edit/delete action sheets in `app/board.tsx` and `app/admin-board-manage.tsx` must use `showBoardCommentActions` from `lib/board-comment-actions.ts`. The helper owns the "댓글 관리" title, edit/delete/cancel labels, and destructive delete style; screens only pass edit/delete callbacks and the native alert function.

Board reaction/comment failure and empty-comment validation alerts in `app/board.tsx` and `app/admin-board-manage.tsx` must use `showBoardFeedbackAlert` from `lib/board-feedback-alerts.ts`. The helper owns the shared title/message copy; screens only pass the native alert function and the alert kind.

Board reaction counts in `app/board.tsx` and `app/admin-board-manage.tsx` must use `buildBoardReactionCounts` and `applyBoardReactionUpdate` from `lib/board-reaction-state.ts`. The helper owns missing-count normalization, toggle-off behavior, reaction switching, and total delta semantics; screens only own mutation wiring and optimistic cache writes.

## Shared Function Contracts

Business formatting, normalization, mapping, grouping, and permission predicates must live in shared helpers once more than one screen depends on the same rule. Screen components may keep event handlers and mutation wiring, but duplicated function-level business rules should be moved into `lib/*` helpers and covered by source guards.

- Exam display helpers in `app/exam-manage.tsx` and `app/exam-manage2.tsx` must use `lib/exam-display.ts` for resident-number display, exam date display, round/location summary text, and phone candidate normalization.
- Group chat display helpers in `app/group-chat.tsx` must use `lib/group-chat-display.ts` for staff send permission, member search normalization, role labels, reply labels, copy text, and time display.
- Broad function refactors must run `node scripts/audit/shared-function-contract-audit.cjs` and update either the relevant shared helper test or this handbook when a new duplicated function cluster is found.
