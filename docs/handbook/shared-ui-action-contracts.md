doc_id: FC-SHARED-UI-ACTION-CONTRACTS
owner_repo: fc-onboarding-app
owner_area: shared-ui
audience: developer
last_verified: 2026-10-14
source_of_truth: components/* + app/* + hooks/use-keyboard-padding.ts + web/src/* + scripts/audit/shared-ui-contract-audit.cjs + scripts/audit/shared-function-contract-audit.cjs + scripts/audit/mobile-keyboard-surface-audit.cjs

# Shared UI Action Contracts

## 2026-10-15 Keyboard-open taps

- Form screens use `keyboardShouldPersistTaps="always"` on their scroll container and on chip/option rows nested inside it; a tap with the keyboard open must reach the control instead of dismissing the keyboard and shifting layout under the finger. Chat and search result lists keep `"handled"` so an empty-area tap still closes the keyboard.
- `KeyboardAwareWrapper` disables `enableResetScrollToCoords`: the animated return scroll on keyboard hide captured the next tap.
- `KeyboardAwareWrapper` and every vertical `"always"` scroll container set `disableScrollViewPanResponder`. With an input focused, the JS scroll responder claimed held taps (about 70ms or longer, a normal finger tap), so the control showed press feedback but never fired. Native drag scrolling does not depend on it. The mobile keyboard audit rejects a vertical `"always"` container or the wrapper without it; `"handled"` lists keep the responder so an empty-area tap still closes the keyboard.
- Android Fabric can drop the native scroll offset when a React commit races its state update; children are then measured at the pre-scroll offset and Pressable cancels any tap whose finger moves (press feedback shows, `onPress` never fires). Native resends the offset only when it changes, so `KeyboardAwareWrapper` moves 1px and back (non-animated, same frame) once scrolling has been quiet for 150ms, after re-renders and content size changes, never while scrolling or at offset 0, and ignores the events of its own nudge. `components/__tests__/KeyboardAwareWrapper.test.tsx` covers it.
- Auth CTAs keep `submitOnPressIn` (login, common signup). Signup validation failures close the keyboard so the message above the CTA is visible, and a successful signup shows a success toast before navigation.

## 2026-10-15 Text-only dialogs and inline field errors

- `AppAlertProvider` renders every `Alert.alert` as a text-only card: left-aligned title and message, no status glyph. Two actions share the row at equal width with the `cancel` action on the leading side; three or more stack with the primary first and `cancel` last. Dispatch still resolves the caller's original button index, so queue, repeated-press, throw and back-button contracts are unchanged.
- Filled destructive actions use `COLORS.errorButton` (#dc2626) for a 4.5:1 white label, matching the `primaryButton` rule for orange.
- Decision dialogs ask a question in the title ("앱을 종료할까요?", "작성 중인 내용을 버릴까요?"). Missing or invalid form input is not a dialog: the insurance additional-info form marks the field, shows the message under it, and scrolls to the first failing field through `KeyboardAwareWrapper`'s `scrollToY` handle. A whitespace `error` only marks a field border; `FormInput` and `OptionSheetField` render no message line for it, and form error text uses `TYPOGRAPHY.fontSize.xs`.
- Android back on a root home (모두온 `ServiceHub`, insurance home, home-lite) goes through `useRootExitConfirm`: with a back stack it navigates normally, otherwise it asks "앱을 종료할까요?" before `BackHandler.exitApp()`.
- `OptionSheetField` is the shared select field for fixed choice lists: a FormInput-sized field that opens a bottom-sheet list with a checked row, replacing wrapped chip walls. It also takes `{ value, label }` options for codes and ids. Email entry suggests `SIGNUP_EMAIL_DOMAINS` after the local part.
- 2026-10-22 (user decision, app-wide): buttons run actions; they never pick a value. Pick values with `components/SelectionControls.tsx`: `SegmentedControl` for 2–4 short options, `ChoiceRows` (radio rows with a check) for up to ~7 or long labels, `OptionSheetField` for longer or data-driven lists, and `ActionRows` (grouped rows with a chevron) instead of stacking several full-width buttons for navigation. Destructive secondary actions such as withdrawal are quiet text buttons. Sources: Apple HIG buttons, SEED Action Button, KRDS, NN/g button states.

## 2026-10-14 Filled mobile actions and active worktree audit

Filled Button/ServiceAction use COLORS.primaryButton with white labels (normal-state contrast4.52:1); decorative primary accents and pale/outline controls remain separate. ServiceAccount groups its existing authorized actions, logout, withdrawal (a text button since 2026-10-22) and privacy link with12px gap and no per-action margin stacking. Labels, role/consent conditions, keyboard/press/loading semantics and withdrawal ownership remain unchanged. The audit applies exclusions only to paths relative to its selected root: excluded ancestor names cannot hide an active checkout, while existing excluded descendants remain skipped. Use the closest native-controls and shared-ui-action-contracts suites and the existing visual capture adapter; do not add another runner.

Active primary Button labels remain white even when an external textStyle supplies a dark color; other caller text properties remain intact. Pale/outline and disabled controls keep their existing contrast policy. Remember-password storage clearing belongs to the actual event handler, not a replayable functional state updater; StrictMode and pressIn/press are covered by the existing login renderer.

The public header exposes separate account-information and functional logout controls for verified common/FC sessions. Restoring state disables the account control and never flashes a guest label. Logout reuses the session's local-first cleanup and the focused owner returns to common home; all controls retain44px minimum touch areas and large-text fit.

Static service-hub leaves use NAVIGATE rather than repeated PUSH. Only successful/default common-account auth landings use dismissTo('/services/account'), including existing-account pop and missing-account replace fallback. Recovery clears local auth before dismissing to common login with preserved service/skipAuto. Notification, role, identity gate, detail and settings-query policies remain distinct. ServiceInformation back uses the existing pop-first helper. Actual callback/handler tests and the installed StackRouter POP_TO check are complementary evidence; neither proves device rollout.

DepartmentIcon changes are confined to two requested shapes: a plastic-surgery face outline plus cross, and herbal-hospital veins clipped to the same leaf outline. The artifact-only synthetic RNW preview renders the actual components; it is not a product route or real-account state injection. Internal development/preview hospital demo flags display fictional directory fixtures, not live publication or operating-account evidence.

## 2026-09-30 Failed reads and complete edit sources

Empty lists and zero counters describe successful reads only. Initial failures show safe feedback and retry; background failures either hide an unverified selection or label retained same-owner data as stale. Missing or expired signed sessions expose the existing login route rather than repeatedly retrying an unusable session. No token or private identifier belongs in a query key or diagnostic evidence.

Board detail and edit surfaces must distinguish a list preview from a complete detail response. Only a matching, successfully loaded post can initialize an editor or enable its save action. Once initialized, refetches must not replace the user's draft. Account/post changes invalidate the previous source; delayed responses cannot restore another editor's data. Native login actions close the current modal before navigating.

## 2026-09-30 Exam target selector recovery

`ExamApplicationTargetSelector` distinguishes loading, safe query errors, an empty eligible population and a search miss. Error actions are available before opening and inside the native modal. Retry keeps the modal and search text; relogin closes the modal and clears its search before opening the login route. Failed or pending queries must not offer cached rows for selection. Executable coverage is in `components/__tests__/exam-application-target-selector.test.tsx` and `hooks/__tests__/use-exam-application-targets.test.ts`.

## 2026-09-09 Alert lifecycle and store return

Shared alerts render visible content without opacity worklets or animation-completion action dispatch. Every queued item has a unique identity. A button or cancel action claims and removes only that item before invoking its callback; duplicate presses, synchronous follow-up alerts and throwing callbacks cannot consume another item or strand a blocker. Preserve the noncancelable default and explicit cancel actions. The modal uses no native transition animation when handing off to a store or route.

`components/__tests__/AppAlertProvider.test.js` executes the actual provider with persisted animation values and interrupted-completion conditions. The former implementation fails six cases, including a second queued card at opacity zero; corrected behavior passes. Native iOS store-return acceptance is separate from this renderer evidence.

Startup update checks are owned only by the root after splash readiness. An unmounted owner ignores late results; remounts share the pending check and cannot present twice. iOS uses one checked response, native installed version, matching bundle ID, valid store ID and minimum-OS eligibility. The optional alert can be canceled and opens the same Korean storefront. Persist only the non-sensitive installed/store version pair and timestamp for a 24-hour reminder cooldown; no account data. A Store `Open` response must not trap the app. `hooks/__tests__/use-in-app-update.test.ts` covers these conditions. The user's exact Store availability discrepancy is not proven without installed-binary/storefront evidence.

Shared business actions must be governed by feature contracts before screen-level styling. The goal is not to force one component across React Native and web, but to keep equivalent behavior identical.

## Governed Primitives

Messenger timestamps, unread receipts and send status must remain within the message row. Direct/group bubbles and their image/file contents yield width to that metadata on narrow screens. The width adjustment preserves existing long-press, copy, attachment-open and download helpers; it does not change action permissions or time formatting.

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
node scripts/audit/mobile-keyboard-surface-audit.cjs
node scripts/audit/mobile-keyboard-surface-audit.cjs --json
```

The audit excludes archive, temporary, deployment, generated, and dependency folders. New clusters should be added to the inventory categories before implementation.

## Implementation Rule

When touching governed primitives, update at least one of:

- `lib/__tests__/shared-ui-action-contracts.test.ts`
- `docs/handbook/shared-ui-action-contracts.md`
- `docs/handbook/feature-contract-matrix.md`
- `docs/handbook/contract-test-map.json`

Screen-only implementations are allowed only when the feature is intentionally unique and the exception is documented in the relevant handbook page.

React Native container children must not rely on raw JSX whitespace or primitive values. Put adjacent closing tags on separate lines, type element-only icon/value slots as `ReactElement`, and keep `lib/__tests__/react-native-text-child-contract.test.ts` green across `app`, `components`, and `hooks`.

Messenger attachment opens in `app/chat.tsx` and `app/group-chat.tsx` must use `openMessengerAttachment` from `lib/messenger-attachment-actions.ts`. The helper owns external URL opening through `openExternalUrl`, failure alerts, and logging. Do not call `Linking.openURL` directly from messenger attachment bubbles.

Clipboard writes on mobile screens must use `copyTextWithFeedback` from `lib/messenger-copy-actions.ts`. The helper owns `Clipboard.setStringAsync`, empty-copy handling, success/failure toasts through `showToast` from `components/Toast.tsx`, and copy failure logging. On Android 13 (API 33) and later the system shows its own clipboard confirmation, so the helper skips the app success toast there; empty and failed copies still use toasts. Do not call `Clipboard.setStringAsync` directly from screens. Copy results never use a blocking `Alert.alert`. Inside a modal that would cover the toast (the request-board image preview), pass `feedback: 'none'` and show the result on the copy control itself.

Feedback weight follows the action: a toggle or selection changes the control itself; reversible or frequent results (copy, small saves, background failures) use `showToast`, which replaces an identical visible toast instead of stacking; field errors stay inline; `Alert.alert` is reserved for confirmations and irreversible or blocking outcomes. Navigation and tab controls fire on `onPress` (release) so sliding off cancels them; `onPressIn` actions are limited to documented keyboard exceptions such as the auth `submitOnPressIn` CTA.

Linkified messenger/body text actions in `components/LinkifiedSelectableText.tsx` must use `showLinkifiedTextOptions` and `openLinkExternallyWithFeedback` from `lib/linkified-text-actions.ts`. The helper owns link option alerts, external open failure feedback, and link copy feedback through `copyTextWithFeedback`; the component should not call `Alert.alert` or `Clipboard.setStringAsync` directly.

Messenger sent-message unread receipt display in `app/chat.tsx`, `app/group-chat.tsx`, and `app/request-board-messenger.tsx` must render through `MessageUnreadReceiptBadge` from `components/MessageUnreadReceiptBadge.tsx`. Direct and request-board 1:1 chats should keep count calculation in `getDirectMessageUnreadCount`; group chat can pass room `unread_count`, but screens should not own local `messageUnreadCount` text styles or formatting branches.

Messenger delete confirmations in `app/chat.tsx`, `app/group-chat.tsx`, and `app/request-board-messenger.tsx` must use `confirmMessengerDelete` from `lib/messenger-delete-actions.ts`. The helper owns the delete confirmation copy, destructive action style, failure alert, and failure logging. Screen code should only provide the delete operation and any domain-specific error formatter.

Native download/save flows in `app/request-board-messenger.tsx` and `app/hanwha-commission.tsx` must use `downloadRemoteFileToUserStorage` from `lib/native-file-actions.ts`. The helper owns temporary download paths, Android Storage Access Framework writes, iOS document copies, duplicate filename fallback, cleanup, and destination labels. Do not call `FileSystem.downloadAsync` or `StorageAccessFramework` directly from those screens.

Image preview modals in `components/ImagePreviewModal.tsx` must route platform behavior through `components/image-preview-modal-policy.ts`. Android uses a non-virtualized static pager inside native modals to avoid Fabric child-insertion crashes; iOS/web keep the gesture/reanimated zoom path. Every preview page shows a spinner until the image loads and `이미지를 불러올 수 없습니다.` when it fails, so an expired or slow image never leaves only the black overlay. Preview pages and board attachment thumbnails use `resizeMethod="resize"`: Android otherwise decodes remote images at full size, and the non-virtualized Android pager would otherwise mount every page at once. The Android pager starts at the tapped image (`contentOffset` plus `scrollTo`) and renders an image only for the current page and its direct neighbours.

Board attachment file opens in `app/board.tsx`, `app/admin-board-manage.tsx`, and the existing-attachment list in `app/admin-board.tsx` must use `openBoardAttachment` from `lib/board-attachment-actions.ts`. The helper owns missing signed URL handling, external opener dispatch, failure feedback, and optional error logging; screens only pass `openExternalUrl`, `Alert.alert`, and the board logger. It opens with `preferExternalBrowser: true` because Android Custom Tabs leave an empty black tab for PDF/HWP/Office downloads. Before opening a file or the image preview, the detail screens call `getFreshBoardAttachments` with `BoardDetail.attachmentsSignedAt` (stamped by `fetchBoardDetail`) and re-fetch the detail when the 1-hour signed URLs are 50 minutes old or more.

Board comment edit/delete action sheets in `app/board.tsx` and `app/admin-board-manage.tsx` must use `showBoardCommentActions` from `lib/board-comment-actions.ts`. The helper owns the "댓글 관리" title, edit/delete/cancel labels, and destructive delete style; screens only pass edit/delete callbacks and the native alert function.

Board reaction/comment failure and empty-comment validation alerts in `app/board.tsx` and `app/admin-board-manage.tsx` must use `showBoardFeedbackAlert` from `lib/board-feedback-alerts.ts`. The helper owns the shared title/message copy; screens only pass the native alert function and the alert kind.

Board reaction counts in `app/board.tsx` and `app/admin-board-manage.tsx` must use `buildBoardReactionCounts` and `applyBoardReactionUpdate` from `lib/board-reaction-state.ts`. The helper owns missing-count normalization, toggle-off behavior, reaction switching, and total delta semantics; screens only own mutation wiring and optimistic cache writes.

Native keyboard surfaces are governed by `scripts/audit/mobile-keyboard-surfaces.json`. The audit discovers direct `TextInput` renderers and consumers of shared input components, then fails when the reviewed registry and live source differ or when a required layout owner disappears. Classify the actual input ancestry rather than accepting a keyboard helper elsewhere in the file.

Fixed-bottom composers must keep the input and primary action inside `KeyboardAvoidingView` or `KeyboardSafeBottomBar`. `KeyboardAwareWrapper` protects only descendants in its scroll tree. Android plain-scroll screens keep explicit keyboard-height scroll room through `useKeyboardPadding`; `softwareKeyboardLayoutMode=resize` alone is not visibility evidence. Run `npm run audit:mobile-keyboard` and `lib/__tests__/mobile-keyboard-surface-contract.test.ts` after adding or restructuring any native input.

Keyboard surfaces must keep the keyboard open while the user drags or scrolls (`keyboardDismissMode="none"`). Scroll forms must also own focus visibility through `KeyboardAwareWrapper`, or through a reviewed `KeyboardAvoidingView` plus explicit focus scrolling/keyboard-height room. Top search fields are exempt from focus scrolling only when the input itself is permanently above the keyboard. The mobile keyboard audit rejects `on-drag` and `interactive` dismissal modes anywhere under `app/` or `components/`.

Admin web reject reason entry in `web/src/app/dashboard/page.tsx`, `web/src/app/dashboard/appointment/page.tsx`, and `web/src/app/dashboard/docs/page.tsx` must use `RejectReasonModal` from `web/src/components/RejectReasonModal.tsx`. The shared component owns textarea layout, cancel/submit buttons, and keyboard behavior: Enter submits, while Shift+Enter inserts a newline.

Admin web document and appointment mutations treat browser payloads as `unknown` and validate them through `web/src/lib/privileged-action-input-policy.ts` after verifying the server session. Client-provided recipient phones are not part of the action contract; server actions derive the canonical FC phone from `fcId` before creating inbox or push notifications. Regression evidence lives in `lib/__tests__/privileged-server-action-input-policy.test.ts`.

## Notification partial-success feedback

Chat, board, document, exam, and notice submission surfaces must distinguish the committed business mutation from its follow-up notification delivery. They await the delivery result, keep an already committed mutation successful, and show a user-safe partial-success warning when no provider accepted the notification. The UI must not expose tokens, recipient identifiers, provider bodies, or raw transport errors, and must not invite users to repeat the committed mutation as a notification retry.

## Shared Function Contracts

Business formatting, normalization, mapping, grouping, and permission predicates must live in shared helpers once more than one screen depends on the same rule. Screen components may keep event handlers and mutation wiring, but duplicated function-level business rules should be moved into `lib/*` helpers and covered by source guards.

- Exam display helpers in `app/exam-manage.tsx` and `app/exam-manage2.tsx` must use `lib/exam-display.ts` for resident-number display, exam date display, round/location summary text, and phone candidate normalization.
- Group chat display helpers in `app/group-chat.tsx` must use `lib/group-chat-display.ts` for staff send permission, member search normalization, role labels, reply labels, copy text, and time display.
- Broad function refactors must run `node scripts/audit/shared-function-contract-audit.cjs` and update either the relevant shared helper test or this handbook when a new duplicated function cluster is found.

## 2026-10-09 Priority-one local recovery contracts

- Business writes require a validated committed receipt. A malformed HTTP200/RPC object is an unknown result, never synthesized success. Notification delivery and bounded physical-file cleanup run after the commit and have separate warning/retry actions.
- Mobile document removal asks for confirmation describing downstream reset, preserves approved-document protection and blocks duplicate execution. `remove_fc_document_atomic_v1` commits the document, existing profile reset and durable cleanup queue together. `types=[]` retains the existing administrator full-request reset policy; nonempty requests preserve uploaded excluded documents. The queue includes the old commission PDF when its metadata is reset.
- Cleanup read/retry actions revalidate the signed actor's current database facts. FC callers use only the signed own profile. Queue rows/paths remain service-only; status exposes a boolean count result. Both mobile document entry and the admin detail modal recover the pending warning after re-entry. Unknown counts are read errors, and post-commit unknown cleanup stays pending. Cleanup retry never repeats the business mutation.
- Mobile submission continuations and completion callbacks are owned by the mounted session/route. Obsolete saves cannot restore a previous account, clear another draft or show a result for another FC. Basic-information controls freeze during saving; cleanup retry owns one pending operation.
- Mobile ordinary board/notice/basic-information drafts ask before navigation, Android back and browser unload; busy exits wait for the current result. Cancel sends no write. Basic-information refetch does not overwrite a dirty draft. Drafts stay in memory, and account/route changes own fresh state. The existing saved-post pending-attachment exit policy is retained separately.
- Mobile board/notice creation retains a stable UUID and payload after an uncertain response. Service-only creation receipts serialize matching requests, replay the original ID and reject changed payloads. Legacy board callers without a request ID retain compatibility but cannot claim retry deduplication. Notice attachment upload and save share one synchronous in-flight guard.
- Admin web chat ignores IME composing/229 Enter, confirms deletion and keeps cancellation local. Profile basic information, recommender and memo drafts survive refetch independently; dirty modal cancel preserves input and pending save blocks close. Notice upload through save owns the same pending/mutex period.
- GaramLink message send restores failed text and attachments, keeps newly typed text beside the failed text, and reports an unknown send result before retry. The measured composer keeps keyboard focus. Synchronous guards block duplicate sends and busy navigation; late results cannot populate another account/conversation.
- Reads distinguish loading, confirmed zero/empty, failure and retained old data. Failed unread reads do not call native badge/notification cleanup. Failed profile/approval/identity reads do not invent an unapproved or incomplete state.
- Date-only fields use `lib/calendar-date.ts` without UTC conversion. An unset exam date displays the stored exam month. Allowance graph metadata distinguishes performance month from scheduled payment date.
- Verification is local: actual-handler mocks, PGlite and isolated PostgreSQL16.14 multi-connection fixtures, compilers and source contracts. Native WebView/back/IME/font acceptance and operational DB/Storage/Edge rollout are separate gates. The migration must be applied and verified before its new callers are deployed; no split-write fallback is allowed.

## 2026-10-16 App alert buttons

- `AppAlertProvider`의 버튼 두 개는 한 줄을 반씩 나눠 쓰고(`flex: 1`), 라벨은 한 줄로 유지한다(필요하면 85%까지 축소). 고정 폭 100은 "내용 버리고 나가기"를 세 줄로 접어 모양이 깨졌다. 세 개 이상은 기존처럼 세로로 쌓는다.

## 2026-10-16 Bottom sheets and the navigation bar

- 화면 아래 가장자리에 붙는 시트는 Android 화면 끝까지 그려지므로 하단 안전 영역(`useSafeAreaInsets().bottom`)을 직접 더한다. `StackSheet`(가입·추가 정보 선택 시트)와 `ExamApplicationTargetSelector` 시트가 이를 따르고, 기존 `OptionSheetField`와 메신저 시트(`bottomInset`)도 같은 방식이다. 마지막 항목이나 버튼이 내비게이션 바에 가리지 않아야 한다.
