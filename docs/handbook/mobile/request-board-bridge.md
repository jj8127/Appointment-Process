doc_id: FC-APP-REQUEST-BOARD-BRIDGE
owner_repo: fc-onboarding-app
owner_area: mobile
audience: developer, operator
last_verified: 2026-10-10
source_of_truth: app/request-board*.tsx + lib/chat-keyboard-layout.ts + lib/request-board-api.ts + lib/request-board-session.ts + request_board/server/src/routes/messages.ts

# Mobile Playbook: GaramLink Bridge

## 2026-10-17 FC 설계요청 홈

- FC 홈은 위에서부터 "새 설계 요청" 버튼 → (검토할 설계가 있으면) "내 차례" 카드 → 진행 상황 4단계(수락 대기 → 설계 중 → 검토 대기 → 완료, 각 단계를 누르면 해당 필터 목록) → 도구 6개(의뢰 목록·고객관리·설계코드·메신저·가람Link 주소·사용법 영상) → 최근 활동 → 알아두세요 순이다.
- 단계 수는 `buildFcRequestPipeline`이 만든다. FC 통계의 `completed`에는 검토 대기가 포함되므로 "완료"는 `completed - reviewPending`이다.
- 설계매니저와 조회 전용 계정 화면(빠른 실행, 통계, 처리할 의뢰, 메신저 카드)은 바꾸지 않았다. 실제 진행과 무관하던 "설계 요청 흐름" 안내는 모든 역할에서 뺐다.

## 2026-10-17 제출 전 막힘 미리 보기

- 작성 화면은 `lib/request-board-submit-readiness.ts`로 운전구분 → 보험 상품 → 요청 내용 → 설계매니저 → 설계코드를 화면 순서대로 계산해 "보내기 전 확인" 카드에 보여준다. 설계코드는 매니저를 고른 뒤에만 판정한다(`ok: null`).
- 막힌 항목이 있으면 제출 버튼은 회색으로 비활성화하지 않고 첫 막힘의 할 일(예: "설계매니저를 선택해주세요")을 문구로 보여주며, 누르면 해당 섹션으로 스크롤·입력 포커스·매니저 시트·설계코드 화면으로 보낸다. `submitRequest`의 기존 검사는 최종 방어선으로 유지한다.
- 운전구분이 없는 기존 고객은 고객 카드 아래에서 바로 고르고 저장하며, 이미 고른 상품·매니저·요청 내용·첨부는 지우지 않는다.
- 설계코드가 없으면 `/request-board-fc-codes?company=…&returnTo=request-create`로 보내 회사명이 채워진 등록창을 열고, 새 코드를 저장하면 작성 화면으로 돌아온다(복귀 시 기존 focus 재조회가 코드를 갱신).
- 상품 수 × 매니저 수가 2 이상이면 버튼 위에 생성될 의뢰 건수를 보여준다.

## 2026-10-15 키보드가 열린 상태의 탭

키보드가 열린 상태에서 화면 안의 버튼·칩·선택 행 탭이 키보드만 닫고 무시되던 문제를 막기 위해 의뢰 첨부 정보 시트와 메신저 첨부 대기 줄은 `keyboardShouldPersistTaps="always"`를 쓴다. 메시지·검색 목록은 `"handled"`를 유지한다.

## Native back in an embedded conversation

- `request-board-messenger` keeps its conversation list and selected room in one route. Focused Android hardware back uses the same room-close handler as the header; after the room closes, the next back follows the existing navigation stack. Remove the listener when the screen loses focus.
- Block room closure while the synchronous send guard is active. Clear room, anchor and notification route parameters when closing so the notification effect cannot reopen that room.
- Image, message-action and conversation-settings modals own their `onRequestClose`. Android may dismiss the keyboard before sending a hardware-back event to the screen.

## 2026-09-30 조회 실패 복구

- 대화·대상·메시지·고객·상품·설계매니저·FC 코드·회사명 조회는 해당 화면에서 `OrThrow` API를 사용한다. 실패를 `[]`로 바꾸지 않고 성공한 빈 응답과 구분한다. 사용처가 없는 이전 호환 조회 API는 제거한다. `rbGetNotificationUnreadCount`는 기존 호출자가 있으므로 유지한다.
- 메신저의 부분 실패는 안내와 재시도를 제공하고, 같은 계정·대화에서 이미 읽은 내용은 보존한다. 계정·세션·대화가 바뀌면 이전 응답과 화면 데이터를 재사용하지 않는다.
- 설계코드의 빈 목록에도 새로고침을 제공한다. 설계요청 필수 조회가 실패하면 코드 미등록으로 판단하거나 제출하지 않는다. focus 복귀 시 조회하는 설계매니저·코드에는 같은 실패 처리를 적용하고 작성 내용은 유지한다.
- 이번 조회 실패 수정에서 사용자가 누르는 재로그인 버튼을 제공한다. 만료 안내 뒤 `/login?skipAuto=1`로 이동하며 자동 로그아웃은 실행하지 않는다. 이 복구 동선은 아래 2026-06-08의 당시 안내 문구 전용 범위를 대체한다.
- 회귀 검증: `lib/__tests__/request-board-strict-reads.test.ts`, `lib/__tests__/request-board-read-state.test.ts`.

## 2026-09-09 Logout transition

Request Board home delegates logout navigation to focused `useAppLogout` after local session clearing. The duplicate null-role redirect is removed; background home screens do not navigate during another screen's logout. Bridge authentication/synchronization and permissions are unchanged. Regression: `lib/__tests__/app-logout-navigation.test.js` and `lib/__tests__/logout-source-contract.test.ts`.

## 2026-07-23 상태 변경 후 알림 부분 실패 계약

- Request Board의 생성·수락·거절·완료·설계 승인/거절 응답은 `warning`과 제한된 `notificationDelivery` 집계를 보존한다.
- DB 상태 변경이 성공한 뒤 알림 전달이 확인되지 않으면 화면은 실패나 재시도 가능한 미처리 상태로 되돌리지 않는다. 대신 `처리 완료 · 알림 확인 필요`와 고정 안내를 표시하고 최신 데이터를 다시 조회한다.
- 부분 실패 안내에서 수신자 식별자, 메시지 원문, 토큰, provider 응답은 노출하지 않는다.
- POST/PATCH/DELETE는 네트워크 응답 유실만으로 자동 재호출하지 않는다. 첨부 후처리 재시도는 저장된 entity id와 동일한 delivery key/manifest를 사용하며 primary mutation을 반복하지 않는다.

## 2026-07-03 Messenger Bridge Contract Notes

- `app/request-board-messenger.tsx` must follow the same messenger interaction contract as direct and group chat: link rendering/opening, long-press action menu, copy/delete actions, and numeric unread count display where read-state data exists.
- Request-board messenger long-press UI must use `components/MessengerMessageActionSheet.tsx`; request-board-only limitations such as no reactions/reply/notice are represented by omitted capability props, not by a separate alert menu.
- Shared UI/action primitive drift for bridge screens is inventoried by `scripts/audit/shared-ui-contract-audit.cjs` and governed by `docs/handbook/shared-ui-action-contracts.md`.
- The bridge composer follows `lib/chat-keyboard-layout.ts` with direct and group chat: one compact open-keyboard gap, safe-area only after close, iOS offset 0, and no Android keyboard-height padding on top of `adjustResize`.
- `lib/request-board-api.ts` is the bridge API surface for request-board messages, direct messages, delete actions, attachments, and session retry behavior.
- Any bridge messenger change must update `lib/__tests__/mobile-chat-source.test.ts`, `lib/__tests__/message-read-receipts.test.ts`, `lib/__tests__/feature-contract-matrix.test.ts`, or this handbook contract.

## 목적

- 가람in 안에서 GaramLink 설계요청/메신저를 안전하게 열고 unread/presence를 섞어 보여줌

## 진입 경로

- `request-board`
- `request-board-messenger`
- `request-board-requests`
- `request-board-review`
- `request-board-fc-codes`

## 표시 역할

- `fc`
- `manager` via `requestBoardRole='fc'`
- `developer` via `requestBoardRole='fc'`
- linked `designer`

- 가람Link messenger의 쓰기 여부는 기존 `getMessengerHubCapabilities`와 앱의 signed session role/readOnly/staffType으로 계산한다. manager는 기존 방·메시지·첨부를 조회할 수 있지만 새 DM·전송·업로드·삭제·설정 변경은 수행하지 않는다. runtime `RbUser.role='fc'`만으로 쓰기를 허용하지 않는다.
- 사진/파일 선택·삭제 확인·설정 응답도 기존 read scope로 계정·권한 변경 뒤 늦은 완료를 차단한다. 쓰기 가능한 FC/developer/linked designer의 기존 전송·초안 복구는 유지한다.

## 읽는 데이터

- request_board JWT/session
- unread count
- request list/detail
- presence
- designer directory / FC codes

## 쓰는 데이터

- bridge-login / session sync
- attachment upload (`rbUploadAttachments`) with the same 401 -> bridge-login retry rule
- message read state
- request approval/rejection 흐름 위임

## 실패/예외

- bridge secret mismatch
- requestBoardRole 오판정
- attachment upload 401인데 retry를 안 태워 generic failure로 끝나는 경로
- message attachment bucket MIME allowlist가 모바일 이미지(`webp/gif/bmp/heic/heif`)보다 좁아 업로드 단계에서 실패하는 drift
- unread/badge 합산 불일치
- 가람Link 세션/브릿지 실패는 화면별 `데이터 로드 실패` 같은 일반 문구로 숨기지 않고, 앱 재로그인 후 설계요청 재진입 안내로 정규화한다.

## 2026-06-08 모바일 설계요청 세션 오류 메모

- `ensureRequestBoardSession()` 실패, bridge-login 실패, request_board API 인증 만료는 `lib/request-board-session-error.ts`를 통해 같은 사용자 안내로 표시한다.
- 명시적인 역할 제한이나 계정 상태 안내는 세션 만료 안내로 덮어쓰지 않는다.
- 최초 bridge-login의 일반403도 app sync나 재로그인으로 변환하지 않는다. HTTP503은 저장된 인증을 유지하는 실패로 표시하고, 구조화된 상태·코드를 메시지 추정보다 우선한다.
- 안내 문구만 정규화하며, 자동 로그아웃/라우팅이나 재로그인 버튼은 별도 제품 결정 없이는 추가하지 않는다.

## 2026-06-09 모바일 설계코드 focus refresh 메모

- `request-board-create`는 최초 데이터 로드 이후 화면 focus 복귀 시 `rbGetDesignersOrThrow()`와 `rbGetFcCodesOrThrow()`를 다시 호출한다.
- `/request-board-fc-codes`에서 회사별 설계코드를 등록/수정한 뒤 작성 화면으로 돌아온 경우, 고객/요청/첨부 draft는 유지하고 설계매니저/FC 코드 목록만 갱신해야 한다.
- 설계매니저 sheet의 `FC 코드 필요` 표시는 현재 FC 코드 목록과 설계매니저 회사명이 매칭되지 않을 때만 보여야 하며, 운영 API가 코드를 반환하는데 stale local state 때문에 막히면 회귀다.

## 2026-06-05 모바일 설계요청 메모

- `request-board-create`는 고객 중심 흐름에서 고객 선택, 신규 고객 등록, 요청 구성, 설계매니저 선택, 완료 단계를 내부 step으로 관리한다.
- 첨부는 선택값이고 설계매니저 선택은 필수값이다. 설계매니저 선택 sheet는 이름 검색, 완료 CTA, keyboard-safe layout, drag/close 동작을 유지해야 한다.
- 신규 고객 등록/요청 구성의 text input은 스크롤 중 키보드가 닫히지 않도록 기존 앱의 `keyboardShouldPersistTaps`/keyboard avoidance 패턴을 따른다.
- `request-board-fc-codes`의 회사 선택 목록은 검색 결과 전체를 스크롤로 탐색할 수 있어야 하며, 표시 수 제한으로 일부 보험사가 가려지면 회귀다.
- 운전 여부/운전 관련 상태값은 `lib/request-board-driving-status.ts`의 옵션 계약을 따른다.

## 연관 문서

- [../shared/cross-repo-bridge-contract.md](../shared/cross-repo-bridge-contract.md)
- [request_board handbook](../../../../request_board/docs/handbook/INDEX.md)

## 2026-07-22 설계 요청 생성 응답 제한시간 계약

- 모바일 Request Board API의 기본 제한시간은 8초를 유지한다.
- `POST /api/requests`는 저장 뒤 신규 요청 알림 fanout을 응답 전에 완료하므로, 이 생성 호출에만 30초 제한시간을 적용한다.
- 생성 호출은 제한시간 초과 시 자동 재시도하지 않는다. 서버 저장이 이미 끝났을 수 있으므로 사용자가 재시도하기 전에 요청 목록을 확인할 수 있어야 한다.
- 운영 검증을 위해 합성 고객이나 설계 요청을 생성하지 않는다. 지연 재현은 계약 테스트와 로컬 Android 번들로 확인한다.

## 2026-07-13 app-session 전달 계약

- `app/request-board.tsx`의 notification inbox 조회와 모바일 board Edge Function 호출은 저장된 앱 세션을 `x-app-session-token`으로 전달한다. 세션이 없으면 네트워크 호출 전에 401 의미의 세션 오류로 종료한다.
- 화면이 보내는 role/resident/display-name 값은 표시·호환용 claim일 뿐 actor의 진실 원천이 아니다. Edge Function은 서명된 세션과 canonical account/profile을 기준으로 actor를 확정하고 claim 불일치를 거부한다.

## 2026-07-21 모바일 상태전이 성공 피드백 계약

- 수락·거절·완료처럼 사용자가 직접 실행한 Request Board 상태전이는 서버 성공 직후 명시적인 성공 안내를 보여야 한다.
- 목록 새로고침은 성공 안내를 대체하지 않는다. 성공 안내를 먼저 표시하고 후속 데이터 갱신을 수행한다.
- 홈 빠른 카드와 상세 검토 화면은 같은 성공·실패 피드백 계약을 유지하며, 소스 계약 테스트로 두 경로를 함께 보호한다.

## 2026-07-22 설계 요청 화면 성능 계약

- Request Board 홈의 초기 마운트, 포커스, 앱 활성화 이벤트가 겹쳐도 동일한 조회를 중복 실행하지 않는다. 진행 중인 조회를 공유하고, 수동 새로고침과 상태전이 직후만 강제 갱신한다.
- 모바일 요청 목록은 `ssnView=masked&includeAttachments=false` 요약 응답을 사용한다. 목록 첫 화면은 거절 사유 보강 조회를 기다리지 않고 먼저 표시하며, 보강 결과는 최신 조회 순번일 때만 반영한다.
- 새 요청 화면은 고객 목록이 준비되면 고객 선택 단계를 먼저 표시한다. 상품·설계 매니저·FC 코드 카탈로그는 병렬로 계속 불러오고, 작성 단계에 진입했을 때 아직 준비 중이면 명시적인 로딩 안내를 보여준다.
- 목록 요약 최적화는 request_board 서버의 기본 첨부파일 포함 응답을 변경하지 않는다. 기존 웹 호출자는 쿼리 옵션을 생략하면 이전 계약을 그대로 유지한다.

## 2026-08-10 대화 컨텍스트 표시 계약

- 알림 딥링크로 과거 메시지 컨텍스트를 연 경우 상단 배너는 서버가 보고한 앞·뒤 생략 범위에 맞는 안내 문구를 표시하고, 최신 메시지 복귀 동작을 유지한다.
- 방 전환·메시지·알림 설정의 실제 최신성 경계는 사용 중인 sequence/ref만 소유한다. 실행 경로에서 읽히지 않는 중복 generation, preference key, route-consumption 선언을 배포 계약처럼 남겨두지 않는다.
- 이 정리는 Request Board 세션, 권한, 방 식별자, 읽음 처리, 알림 영수증 또는 메시지 조회 API 계약을 변경하지 않는다.

## 2026-08-10 메신저·입력 화면 키보드 계약

- 설계 요청의 `실시간 메신저` 진입은 가람in 메신저 V2 경로인 `/messenger`를 사용한다.
- Request Board 메신저와 FC 코드·검토 입력 화면은 드래그 중 키보드를 유지하고, 전송 실패 복원 시 사용자가 새로 입력한 내용이나 첨부를 덮어쓰지 않는다.
- 하단 입력 바는 `KeyboardSafeBottomBar`가 측정한 키보드·안전영역 인셋을 사용한다. 기기별 고정 여백이나 Android 내비게이션 모드 가정은 허용하지 않는다.

## 2026-10-09 Local send and quick-action feedback

Quick acceptance displays saved success even if follow-up notification feedback is absent. Failed/uncertain sends show a safe confirmation-needed alert and restore the failed draft with any newly typed text; duplicate writes and busy conversation changes are blocked. Failed unread reads remain unknown and do not erase native notifications. FC-code deletion owns visible pending state and rejects duplicate confirmation callbacks. Bridge roles, session exchange and inbox/terminal notification policies are unchanged; native/network acceptance remains unverified.

## 2026-10-10 중복 구현 정리

- JSON과 첨부 업로드는 `rbFetch`의 같은 인증·세션 소유자·401 복구 경로를 사용한다. 첨부는 재시도마다 FormData를 새로 만들고 Content-Type을 직접 지정하지 않는다. 일반 403은 재인증하지 않는다.
- 직접·그룹 채팅의 알림 설정 준비 여부는 현재 방 key와 loaded key의 일치로 계산한다. 조회 순번 보호는 유지한다.
- 알림 전달 미확정 시 `getRequestBoardNotificationFeedback`은 2026-07-23 계약의 고정 안내를 반환한다. 진단에 식별자나 원문을 추가하지 않고, 완료한 상태 변경을 다시 실행하지 않는다.
- 홈과 상세의 수락·거절 가능 여부는 기존 `getDesignerRequestDetailActions`를 사용한다. 연결 메신저의 실패 응답과 예외는 한 복구 경로를 사용하며 새 초안과 최신 미리보기를 보존한다.

## 2026-10-15 복사 피드백

- 가람Link 주소 복사는 토스트로 결과를 알린다.
- 이미지 미리보기는 Modal이 토스트를 가리므로 `feedback: 'none'`으로 복사하고 버튼이 `복사됨`/`복사 실패`로 바뀐다. 다른 이미지를 열면 원래 상태로 돌아간다. 규칙은 `docs/handbook/shared-ui-action-contracts.md`의 피드백 등급을 따른다.
