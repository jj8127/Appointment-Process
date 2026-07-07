doc_id: FC-APP-MESSENGER-CONTENT
owner_repo: fc-onboarding-app
owner_area: mobile
audience: developer, operator
last_verified: 2026-03-26
source_of_truth: app/messenger.tsx + app/chat.tsx + app/board*.tsx + app/notice*.tsx + app/notifications.tsx

# Mobile Playbook: Messenger And Content

## 목적

- 내부 메신저, 알림센터, 게시판, 공지 상세의 동작을 묶어 설명

## 진입 경로

- `messenger`
- `chat`
- `notifications`
- `board`, `board-detail`
- `notice`, `notice-detail`

## 읽는 데이터

- internal unread
- request_board unread 합산치
- board post / notice post
- attachment signed URL

## 쓰는 데이터

- 메시지 전송/읽음
- 게시글/댓글/리액션
- 알림 읽음/삭제

## 주의점

- internal unread와 GaramLink unread가 함께 보일 수 있음
- 게시판 공지는 legacy notice와 board notice가 동시에 존재할 수 있음
- `board`와 `admin-board-manage` 목록은 같은 게시글 종류 필터(`전체`, `공지`, `교육 일정`, `일반`, `가람pick`)와 정렬 옵션을 제공해야 하며, 총무/본부장 화면에서 필터 UI가 빠지면 회귀로 본다.
- optimistic send가 적용된 화면과 아닌 화면을 혼동하지 않음

## 연관 문서

- [../backend/notifications-inbox-push.md](E:/hanhwa/fc-onboarding-app/docs/handbook/backend/notifications-inbox-push.md)
- [../backend/board-api-and-notice-model.md](E:/hanhwa/fc-onboarding-app/docs/handbook/backend/board-api-and-notice-model.md)
## Universal messenger interaction contract

- `app/chat.tsx`, `app/group-chat.tsx`, and `app/request-board-messenger.tsx` must render message text through the shared `LinkifiedSelectableText` path so internet URLs open externally and do not steal long-press selection.
- All messenger bubbles must keep a long-press/action-menu path for copy, select-copy where supported, and delete where the sender/role is allowed.
- Long-press presentation must use `components/MessengerMessageActionSheet.tsx`; capability differences such as reaction, reply, notice, and delete must be props on the shared sheet rather than separate per-screen menus.
- Message attachment cards must stay actionable from the same bubble surface and must not replace the text/link action contract.
- Message attachment opens in `app/chat.tsx` and `app/group-chat.tsx` must use `openMessengerAttachment` from `lib/messenger-attachment-actions.ts`, not direct `Linking.openURL`, so external opening and failure alerts stay identical across messenger surfaces.
- Linkified message/body text must route link options through `showLinkifiedTextOptions` and `openLinkExternallyWithFeedback` from `lib/linkified-text-actions.ts`, so link opening, copy feedback, and select-copy guidance stay identical anywhere `LinkifiedSelectableText` is used.
- Native attachment/PDF downloads in `app/request-board-messenger.tsx` and `app/hanwha-commission.tsx` must use `downloadRemoteFileToUserStorage` from `lib/native-file-actions.ts`, not direct `FileSystem.downloadAsync` or `StorageAccessFramework`, so Android/iOS save behavior stays identical.
- Message copy actions in `app/chat.tsx`, `app/group-chat.tsx`, and `app/request-board-messenger.tsx` must use `copyTextWithFeedback` from `lib/messenger-copy-actions.ts`, not direct `Clipboard.setStringAsync`, so empty-copy, success, failure, and logging behavior stay identical across messenger surfaces.
- Message delete actions in `app/chat.tsx`, `app/group-chat.tsx`, and `app/request-board-messenger.tsx` must use `confirmMessengerDelete` from `lib/messenger-delete-actions.ts`, so the confirmation, destructive action, failure alert, and logging behavior stay identical across messenger surfaces.
- Sent messages must show KakaoTalk-style unread recipient counts on every messenger surface that has read-state data. 1:1 and request-board direct messages use `lib/message-read-receipts.ts`; group chat uses the room `unread_count`; all mobile surfaces must render the final count through `components/MessageUnreadReceiptBadge.tsx` instead of screen-local `messageUnreadCount` text styles.
- Broader UI/action primitive drift is tracked by `scripts/audit/shared-ui-contract-audit.cjs` and `docs/handbook/shared-ui-action-contracts.md`; new raw alert/button/modal/copy/link behavior in messenger/content surfaces needs contract evidence or a documented exception.
- Any change to these files must update `docs/handbook/contract-test-map.json` evidence, a messenger contract test, or this handbook page.
