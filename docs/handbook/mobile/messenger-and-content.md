doc_id: FC-APP-MESSENGER-CONTENT
owner_repo: fc-onboarding-app
owner_area: mobile
audience: developer, operator
last_verified: 2026-10-16
source_of_truth: app/messenger.tsx + app/messenger-search.tsx + app/new-conversation.tsx + app/notification-settings.tsx + app/muted-conversations.tsx + app/chat.tsx + app/group-chat.tsx + app/request-board-messenger.tsx + lib/messenger-hub-model.ts + lib/messenger-search-model.ts + lib/notification-preferences-api.ts + lib/chat-keyboard-layout.ts + app/board*.tsx + app/notice*.tsx + app/notifications.tsx

# Mobile Playbook: Messenger And Content

## 2026-10-16 메신저 화면 개편 1차 (설계 기준 문서 '가람in 메신저 화면 개편 방향')

- 날짜와 시간은 기기 시간대와 상관없이 한국 시간으로 계산한다(`lib/messenger-time.ts`, 고정 +9시간).
  - UTC로 설정된 기기에서 오전 9시에 날짜선이 생기던 문제가 없어졌다.
  - 말풍선 시간은 `오후 3:05` 형식이고, 단체방(`formatGroupChatTime`)도 같은 함수를 쓴다.
- 1:1과 단체방은 같은 사람이 같은 1분 안에 보낸 메시지를 묶는다(`messengerRunPosition`).
  - 이름과 프로필은 묶음의 첫 말풍선에, 시간은 마지막 말풍선에만 둔다.
  - 안 읽은 사람 수는 말풍선마다 그대로 둔다.
  - 단체방에서 전송 중이거나 실패한 메시지는 묶음 중간이어도 시간을 보여준다.
- 대화 탭 위에 `전체 · 안읽음 · 단체방 · 가람Link` 칩을 둔다.
  - 메시지가 한 번도 없는 방은 고정하지 않았으면 대화 탭에서 빼고, 사람 탭에서 시작한다.
  - 안 읽은 방은 미리보기를 진하게 보여준다.
- 알림을 끈 방은 자기 배지는 유지하지만 메신저 탭 합계에서 빠진다.
- 1:1 방을 열 때 안 읽은 상대 메시지가 있으면 가장 오래된 안 읽은 메시지 위에 '여기까지 읽었어요' 선을 그린다. 위치는 읽음 처리 전 첫 불러오기에서 한 번 정하고, 방을 나갈 때까지 유지한다. 모든 메시지가 안 읽은 상태면 그리지 않는다(`findMessengerReadLineId`).
- 단체방도 같은 선을 그린다. 입장 응답의 `last_read_at`(이번 입장의 읽음 처리 전 값)보다 늦게 온 다른 사람의 메시지 중 가장 오래된 것 위에 둔다. `last_read_at`이 없으면(처음 입장) 그리지 않는다.
- 방의 첫 페이지를 불러오는 동안 화면 전체 스피너 대신 말풍선 모양 자리 표시(`MessengerRoomSkeleton`)를 보여준다. 1:1은 빈 화면 대신, 단체방은 `MessengerLoadingState` 대신 쓴다.
- 50명 이상 단체방은 말풍선마다 안 읽은 사람 수 대신 묶음 마지막에 `N명 읽음`을 작게 보여준다(`formatGroupChatSeenLabel`). 작은 방은 카카오식 숫자를 유지한다.
- 단체방에서 발언 권한이 없는 사람은 입력창 대신 '공지 전용 방' 안내를 본다. 보내기 시도 뒤 뜨던 경고 대신 미리 이유를 보여준다.
- 1:1에서 서버가 확실히 거절한 전송은 팝업 대신 말풍선을 '실패' 상태로 남기고 입력창을 비운다. '실패'를 누르면 다시 보내기·삭제를 고른다. 다시 보내기는 새 전송 요청이다. 결과가 불확실한 실패는 중복 전송을 막기 위해 기존처럼 같은 요청으로 '다시 확인'하는 팝업을 유지한다.

## 2026-10-15 키보드가 열린 상태의 탭

키보드가 열린 상태에서 화면 안의 버튼·칩·선택 행 탭이 키보드만 닫고 무시되던 문제를 막기 위해 게시판 작성·상세·관리와 공지 작성 폼, 중첩 칩 행은 `keyboardShouldPersistTaps="always"`를 쓴다. 채팅·메신저 메시지와 검색 결과 목록은 빈 곳 탭으로 키보드를 닫도록 `"handled"`를 유지하며, 채팅 FC 선택 목록에도 `"handled"`를 명시했다. 첨부 대기 줄은 `"always"`다.

## 2026-10-13 조회 결과와 실패 복구

개인·단체·관리자·의뢰 대화와 공지 목록은 정상 배열과 실패를 구분한다. 잘못된 행·페이지·cursor 응답은 빈 목록이나 미확인 수 0으로 바꾸지 않는다. 같은 계정·조건의 성공 자료는 갱신 실패 안내와 함께 유지하며 계정/대화가 바뀐 뒤 이전 응답은 노출하지 않는다. 대화 대상과 unread 권한은 서명 세션에서 정한다.

단체 채팅은 여러 Data API 페이지를 모두 확인한 뒤 목록·요약을 반환한다. 중복 cursor나 불완전한 필수 조회를 성공으로 처리하지 않는다. 기존 `group-chat-query-contract.test.node.ts`, `group-chat-mobile-source.test.ts`, `inbox-list-contract.test.ts`와 Request Board strict-read suite가 이 경계를 검증한다. 배포·게시 성공은 실제 계정 수신이나 인증 화면 acceptance를 대신하지 않는다.

Request Board room, busy-send and Android hardware-back behavior follows the [embedded conversation back contract](./request-board-bridge.md#native-back-in-an-embedded-conversation).

## 2026-10-12 웹 단체 메시지 반전

단체 채팅의 기존 RefreshControl은 Android/iOS에서만 전달한다. 설치된 RN Web0.21.2는 inverted 목록의 `scaleY(-1)`을 새로고침 바깥 View에도 복사한다. 목록·셀의 두 반전에 바깥 반전까지 더해져 글자·시각·아바타가 뒤집힌다. 웹 RefreshControl은 실제 onRefresh를 제공하지 않으므로 웹에서는 해당 wrapper를 생성하지 않는다. 최신순 메시지 배열·anchor 인덱스·최신 복귀의 offset0은 그대로 유지한다. 개인/의뢰 목록은 같은 wrapper가 없어 두 반전으로 정상 표시된다. 검증은 기존 suite의 플랫폼 분기와 실제 합성 웹의 방향·긴 대화 스크롤을 함께 확인한다.

## 2026-10-10 Web read transport and bridge recovery

The insurance-home notice and latest-message errors can share a browser CORS failure in fc-notify. Successful empty history remains distinct from failed reads. The current audit checks configured origins and actual OPTIONS without reading production message bodies. [CORS contract](../backend/notifications-inbox-push.md#web-edge-cors-boundary-2026-10-10).

GaramLink reads recover once from403 SESSION_INVALID, preserve ordinary permission403, and preserve auth during retryable bridge/network/service failure. Account-bound refresh/auth-check results cannot overwrite a newer login or re-run an older account's create payload. [Bridge contract](../shared/cross-repo-bridge-contract.md#2026-10-10-mobile-bridge-read-recovery). Existing per-source last-good history and strict read failure semantics remain in force.

## 2026-10-03 Message width and timestamps

- Direct and group message rows reserve space for the timestamp, unread receipt and send status. Bubble width is relative to the remaining row after avatar and padding, and the bubble may shrink while metadata keeps its measured width.
- Images and file cards must also fit inside the reduced bubble. A fixed preview width or attachment minimum width must not extend into the timestamp at narrow viewport widths or larger text settings.
- Keep link, long-press, preview and download actions unchanged when adjusting these dimensions. Verify both sent and received messages with long text and attachments; synthetic Yoga geometry does not replace physical-device font and rendering checks.

## 2026-10-02 Comment retries

- Global automatic mutation retries are disabled. Reads retain their existing retry policy. A write that needs automatic retry must establish an explicit idempotency contract.
- Mobile and admin-web comment composers assign a UUID before submission and reuse it for an unchanged failed draft, including manual retries. Changes to account scope, post, parent or trimmed content create a new operation. Only confirmed completion releases that operation.
- `create_board_comment_idempotent` serializes `(actor_role, canonical actor_id, request_id)`, validates parent/thread membership, and commits the comment, actor-bound inbox notifications and replay response together. A payload mismatch is HTTP409. Receipts survive post/comment deletion so late retries cannot recreate deleted content.
- Older app bodies without requestId remain accepted, but deduplication requires updated clients. The server must deploy after its migration and before the client release. New changes are not included in published 4.2.14(89).
- Regression evidence: board-comment request/reply tests, PGlite idempotency scenarios, and real independent-connection PostgreSQL concurrency/rollback tests.


## 2026-09-30 Read failure recovery

- Embedded GaramLink messenger, codes and request/customer screens use strict list reads. A failed read rejects; it never becomes a successful empty list or a false missing-code decision. Existing tolerant API wrappers remain only for compatibility with callers outside this migration.
- Conversation/message reads belong to the current account and conversation. A refresh failure preserves that owner's last successful history with error feedback; late results from an older scope are ignored. Contact-list partial failures remain visible.
- Codes and request forms expose retry even when no list rendered. Required lookup failure blocks submission until recovery. Group-chat failures remain visible after an alert is dismissed.
- Board detail reads expose loading/error/retry before body, attachments and comments. A preview is not a complete post, and failed reads must not render a fabricated zero-comment result.
- Board composers distinguish category loading/failure/empty, require complete current edit data, preserve drafts on refetch and prevent save while the edit source is unverified.

## 2026-09-09 Logout transition

Board and admin-board logout redirects are owned by focused `useAppLogout` after local session clearing. Retained background screens must not run another null-role replacement. Message/board mutation policy is unchanged. Regression: `lib/__tests__/app-logout-navigation.test.js` and `lib/__tests__/logout-source-contract.test.ts`.

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

## GaramIn 1:1 change cursor

- `messages.changed_at` moves on every insert and update (trigger
  `messages_touch_changed_at`, `clock_timestamp()`), so sends, read marks and
  deletes all advance it.
- `direct_message_list` returns `mode`, `deleted_ids` and `cursor` (the newest
  `changed_at` it read, deleted rows included). Sent back as `since`, it returns
  only rows changed after `since` minus a 10-second overlap, with deleted rows as
  ids filtered by the same visibility rules. A missing, unreadable, future or
  over-24-hour cursor gets the whole conversation (`mode: 'full'`) as before.
- `app/chat.tsx` sends the cursor only on quiet refreshes of the same room and
  merges changes into the rows it holds; opening a room always loads it whole.
  A server without cursors answers `full` with no cursor, so old and new clients
  and servers mix safely.
- Every statement that inserts or updates `messages` sends one content-free
  `changed` broadcast per thread (`messages_signal_direct_change`). The channel
  is public because the app has no Supabase Auth session; its name is
  `dm-` + HMAC-SHA256(thread id, Vault `messenger_realtime_topic_key`), handed
  out only on a full `direct_message_list` as `realtime_topic`. A missing key
  or a failed send skips the signal and never blocks the write.
- `lib/direct-message-realtime.ts` shares one channel per topic across screens
  (a fixed topic returns the existing channel and adding a listener to it
  throws). On a signal or a reconnect the room fetches changes after its
  cursor; the timer drops from 5 to 30 seconds while the channel is live.

## Native keyboard ownership

- Every direct or registered shared native input under `app/**` and `components/**` is classified in `scripts/audit/mobile-keyboard-surfaces.json`; `npm run audit:mobile-keyboard` must remain exact.
- A fixed board or chat composer must keep both its focused input and primary submit action inside `KeyboardAvoidingView` or `KeyboardSafeBottomBar`. A keyboard-aware scroll sibling does not own a fixed footer.
- Plain-scroll Android forms may use the normalized reported keyboard height as explicit scroll room. Modal editors own avoidance inside the modal, and reviewed top-search lists dismiss on drag.
- Source and build checks prove structural coverage only. Physical Android/iOS focus, typing, multiline growth, submit, dismiss, rotation, and reopen evidence remains mandatory before native release.
