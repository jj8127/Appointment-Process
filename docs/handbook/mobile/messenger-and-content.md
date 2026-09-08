doc_id: FC-APP-MESSENGER-CONTENT
owner_repo: fc-onboarding-app
owner_area: mobile
audience: developer, operator
last_verified: 2026-09-08
source_of_truth: app/messenger.tsx + app/messenger-search.tsx + app/new-conversation.tsx + app/notification-settings.tsx + app/muted-conversations.tsx + app/chat.tsx + app/group-chat.tsx + app/request-board-messenger.tsx + lib/messenger-hub-model.ts + lib/messenger-search-model.ts + lib/notification-preferences-api.ts + lib/chat-keyboard-layout.ts + app/board*.tsx + app/notice*.tsx + app/notifications.tsx

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
- 가람in 홈의 `메신저` 바로가기 카드는 기존 `internal_unread_count` query 값을 아이콘 우측 상단 badge로 표시한다. 0이면 숨기고 100 이상은 `99+`로 제한하며, 접근성 label에도 같은 읽지 않은 메시지 수를 포함한다.
- 게시판 공지는 legacy notice와 board notice가 동시에 존재할 수 있음
- `board`와 `admin-board-manage` 목록은 같은 게시글 종류 필터(`전체`, `공지`, `교육 일정`, `일반`, `가람pick`)와 정렬 옵션을 제공해야 하며, 총무/본부장 화면에서 필터 UI가 빠지면 회귀로 본다.
- optimistic send가 적용된 화면과 아닌 화면을 혼동하지 않음

## 연관 문서

- [../backend/notifications-inbox-push.md](../backend/notifications-inbox-push.md)
- [../backend/board-api-and-notice-model.md](../backend/board-api-and-notice-model.md)
## Universal messenger interaction contract

- `app/chat.tsx`, `app/group-chat.tsx`, and `app/request-board-messenger.tsx` must render message text through the shared `LinkifiedSelectableText` path so internet URLs open externally and do not steal long-press selection.
- All messenger bubbles must keep a long-press/action-menu path for copy, select-copy where supported, and delete where the sender/role is allowed.
- Long-press presentation must use `components/MessengerMessageActionSheet.tsx`; capability differences such as reaction, reply, notice, and delete must be props on the shared sheet rather than separate per-screen menus.
- Message attachment cards must stay actionable from the same bubble surface and must not replace the text/link action contract.
- Private V2 image attachments in direct and group messages render through `MessengerAttachmentImage` using `useMessengerImagePreview`. Images preserve aspect ratio within a 240px width / 380px height limit; image-only bubbles have no document card or orange padding. Documents retain their existing file cards. Image long press opens the same message actions.
- Preview URL requests use the signed session and the existing authorized download endpoint, are limited to four concurrent requests, and discard queued/late results after attachment, account or focus changes. URLs stay in component memory; inline images disable disk caching. Full-screen opens reauthorize and reuse `ImagePreviewModal`; denied/failed images offer a retry without exposing an object path.
- `sendMessengerAttachmentBatch` distinguishes upload/server rejection from unknown commit results. A lost commit response performs one same-delivery-key reconciliation without another upload or send. A committed result refreshes history; pending/unavailable results keep the existing explicit retry flow. The delivery fingerprint and selected draft survive retries. This does not prove that every production send failure is fixed.
- Message attachment opens in `app/chat.tsx` and `app/group-chat.tsx` must use `openMessengerAttachment` from `lib/messenger-attachment-actions.ts`, not direct `Linking.openURL`, so external opening and failure alerts stay identical across messenger surfaces.
- Linkified message/body text must route link options through `showLinkifiedTextOptions` and `openLinkExternallyWithFeedback` from `lib/linkified-text-actions.ts`, so link opening, copy feedback, and select-copy guidance stay identical anywhere `LinkifiedSelectableText` is used.
- Native attachment/PDF downloads in `app/request-board-messenger.tsx` and `app/hanwha-commission.tsx` must use `downloadRemoteFileToUserStorage` from `lib/native-file-actions.ts`, not direct `FileSystem.downloadAsync` or `StorageAccessFramework`, so Android/iOS save behavior stays identical.
- Message copy actions in `app/chat.tsx`, `app/group-chat.tsx`, and `app/request-board-messenger.tsx` must use `copyTextWithFeedback` from `lib/messenger-copy-actions.ts`, not direct `Clipboard.setStringAsync`, so empty-copy, success, failure, and logging behavior stay identical across messenger surfaces.
- Message delete actions in `app/chat.tsx`, `app/group-chat.tsx`, and `app/request-board-messenger.tsx` must use `confirmMessengerDelete` from `lib/messenger-delete-actions.ts`, so the confirmation, destructive action, failure alert, and logging behavior stay identical across messenger surfaces.
- Sent messages must show KakaoTalk-style unread recipient counts on every messenger surface that has read-state data. 1:1 and request-board direct messages use `lib/message-read-receipts.ts`; group chat uses the room `unread_count`; all mobile surfaces must render the final count through `components/MessageUnreadReceiptBadge.tsx` instead of screen-local `messageUnreadCount` text styles.
- Mobile chat composers use `lib/chat-keyboard-layout.ts`: while the keyboard is open they keep one compact 8px gap regardless of device safe-area, and after it closes they restore the platform safe-area minimum. Custom chat headers sit outside the keyboard avoider, so iOS uses `keyboardVerticalOffset={0}`; Android relies on the manifest's `adjustResize` and must not add the reported keyboard height again.
- Broader UI/action primitive drift is tracked by `scripts/audit/shared-ui-contract-audit.cjs` and `docs/handbook/shared-ui-action-contracts.md`; new raw alert/button/modal/copy/link behavior in messenger/content surfaces needs contract evidence or a documented exception.
- Any change to these files must update `docs/handbook/contract-test-map.json` evidence, a messenger contract test, or this handbook page.

## GaramIn direct-message target isolation

- The FC target card is authoritative: a plain-admin, manager, or developer
  phone opens a thread bound to that exact active actor. A plain admin is
  displayed as `{실명}총무`; a developer is displayed as `개발자`. Labels are
  never authorization inputs.
- A manager's active phone-bound `affiliation_manager_mappings` value is the
  headquarters display source. A valid leading 1-10 headquarters/team number
  is rendered as `{N}본부 본부장`; missing mapping data falls back to `본부장`
  and never guesses from the manager name.
- The mobile route must pass the selected target to
  `resolve_garamin_direct_conversation`; a displayed target name must never be
  synthesized while the server resolves a different room.
- `garamin_direct_conversations` remains the one-per-FC compatibility envelope.
  `garamin_direct_threads` owns the exact target identity, and every new
  message is stored with both the legacy envelope and canonical `thread_id`.
- Old clients that omit a target may continue in the legacy shared-admin room,
  but updated target lists never expose that room as a new-conversation target.
  Existing messages addressed only to the old `admin` alias remain shared; historical
  replies with an immutable developer/manager sender actor may be preserved in
  that actor's personal thread.
- Text, attachment, read, delete, unread-summary, notification and broadcast
  paths must enforce the same target tuple. A plain admin can open only threads
  whose counterparty actor is that signed admin UUID; it cannot list or open
  another admin's, manager's, or developer's thread. One developer cannot open
  another developer's thread.
- Rollout order is additive DB migration, updated `fc-notify` and
  `messenger-attachments` Edge Functions, then the new mobile release.

## Messenger V2 navigation and search

- `/messenger?tab=people|chats` is the canonical messenger landing. `사람` is
  the address-book/new-conversation surface and `대화` is the existing-room
  surface; do not merge them back into one channel-card list.
- The `대화` tab renders the unread badge below the label. When the tab is
  active, the badge has exactly 8 px of empty space below it before the orange
  underline. Zero is hidden and values above 99 render as `99+`.
- The top search action opens `/messenger-search`. Before input it shows
  actor-scoped recent searches; after a 250 ms debounce it groups authorized
  results as `친구`, `채팅방`, and `메시지`. A source failure must not discard
  successful sibling sources, and bounded server message results are always
  disclosed as partial rather than complete history.
- Search is read-only. It must not create a room, mark a message read, persist
  a query to the server, or derive authorization from a display label. Recent
  terms stay in process memory, are cleared on actor change, and reject phone
  or resident-number-shaped values.
- Selecting a message uses its typed canonical room reference and exact
  `anchorMessageId`. Direct, group, request-peer, and Request Board direct
  routes load a bounded authorized context, center/highlight the exact row,
  retain that context across polling, and provide `최신 메시지로` when the
  context is separated from the newest history. Request and direct numeric IDs
  are distinct namespaces even when their numbers match.

## Messenger V2 notification preferences

- `앱 푸시 알림` controls native Expo delivery only. Category switches retain
  their stored values while the master is off; inbox history and chat unread
  state are not deleted or rewritten.
- A room mute is a separate canonical preference. It preserves the message,
  realtime delivery, and chat unread count while suppressing new notification
  rows and native fanout for that room. Because this also changes inbox
  persistence, room mute remains editable even when the native push master is
  off.
- Canonical room keys are server-derived: direct threads and group rooms use
  UUID ownership, Request Board request rooms group authorized assignments by
  peer, and Request Board direct rooms use their direct-conversation ID.
- Every conversation screen uses `ConversationSettingsSheet`; load and save
  failures are distinct retry operations. A room change resets stale state and
  disables interaction only until that room's preference read has completed.
- The messenger `대화` list also exposes a compact bell at the right edge of
  every canonical room. The icon is a direct per-room toggle: bell means
  notifications are on and bell-off means they are muted. It must not navigate
  into the room, and a failed save must retain the previous state and offer a
  retry. Legacy rows without a canonical room reference do not expose a toggle.
- The messenger `사람` list does not append `가람in` or `가람Link` as a source
  suffix. It strips those source suffixes from role details; a designer is
  rendered as `회사명 설계 매니저`.
- `/notification-settings` owns OS permission recovery, the native push master,
  categories, and the muted-room summary. `/muted-conversations` combines
  GaramIn and GaramLink results with independent source errors; it must not show
  a definitive empty state if a source failed, and direct rooms should show the
  resolved counterpart name with a neutral fallback when unavailable.
- Direct text, attachment, and broadcast notification persistence is guarded
  inside the same database transaction as the message. Preference read/schema
  failure keeps the message but fails closed for notification creation. Generic
  and group fanout must evaluate global/category/room policy before Expo send.
- GaramLink remains authenticated in-app-only. Do not restore Web Push,
  foreground browser popups, app/system badges, service-worker presentation,
  or Electron notification presentation as a fallback.
- Database migrations, Edge Functions, Request Board server changes, and the
  mobile build require a coordinated rollout and authenticated smoke test.
  Local source/test completion alone keeps the release at `HOLD`.

## Messenger V2 low-latency hub

- The hub renders an actor-and-permission-scoped process-memory snapshot before
  background revalidation. It never persists the directory or conversation
  snapshot to AsyncStorage, files, or logs, and a changed actor scope rejects
  results from the previous scope.
- Network loading is a list-local empty state, not a full-screen interaction
  gate. Tabs and role accordions remain local state and do not start network
  requests or navigation.
- The people and chats virtualized lists are mounted once and retained in fixed
  panes so a tab press never pays list teardown/recreation cost. The inactive
  pane is transparent, ignores pointer/accessibility input, and cannot trigger
  pagination. Row components keep memoized boundaries and stable parent
  callbacks, and role accordions start collapsed to bound the retained people
  tree.
- GaramIn internal conversation summaries come from service-role-only RPCs.
  `chat_targets` supplies server-derived target IDs to
  `get_internal_messenger_summaries_v1`; `internal_chat_list` uses
  `list_internal_chat_page_v1` so eligible FC selection, latest preview/time,
  unread count, and 30-row keyset paging stay inside PostgreSQL. Deleted rows
  are excluded in both paths.
- GaramIn internal and GaramLink conversation lists use 30-row keyset pages.
  The hub merges another
  page at scroll end, while legacy directory/search callers transparently read
  every page so conversations after the first page are not lost.
- The hub has no fixed timer polling. Focus and foreground revalidation share a
  two-minute cooldown, while manual pull-to-refresh remains immediate. Slow
  source updates run in a React transition so tab and accordion input stays
  urgent. Realtime Broadcast delta sync and durable encrypted local history are
  later increments. Database apply, coordinated server and Edge deployment, and
  authenticated backend smoke remain `HOLD`; the user confirmed the local
  Android interaction latency repair on 2026-08-08.
- A `404` from GaramLink room preferences identifies a legacy server. The mobile
  client records that capability once per process, uses an empty preference list,
  and stops subsequent GET/PATCH HTTP attempts until restart. Deploying the
  additive server endpoint restores the normal preference path.

## Native keyboard ownership

- Every direct or registered shared native input under `app/**` and `components/**` is classified in `scripts/audit/mobile-keyboard-surfaces.json`; `npm run audit:mobile-keyboard` must remain exact.
- A fixed board or chat composer must keep both its focused input and primary submit action inside `KeyboardAvoidingView` or `KeyboardSafeBottomBar`. A keyboard-aware scroll sibling does not own a fixed footer.
- Plain-scroll Android forms may use the normalized reported keyboard height as explicit scroll room. Modal editors own avoidance inside the modal, and reviewed top-search lists dismiss on drag.
- Source and build checks prove structural coverage only. Physical Android/iOS focus, typing, multiline growth, submit, dismiss, rotation, and reopen evidence remains mandatory before native release.
