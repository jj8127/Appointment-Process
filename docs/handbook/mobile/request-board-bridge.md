doc_id: FC-APP-REQUEST-BOARD-BRIDGE
owner_repo: fc-onboarding-app
owner_area: mobile
audience: developer, operator
last_verified: 2026-06-09
source_of_truth: app/request-board*.tsx + lib/request-board-api.ts + lib/request-board-session.ts + request_board/server/src/routes/messages.ts

# Mobile Playbook: GaramLink Bridge

## 2026-07-23 상태 변경 후 알림 부분 실패 계약

- Request Board의 생성·수락·거절·완료·설계 승인/거절 응답은 `warning`과 제한된 `notificationDelivery` 집계를 보존한다.
- DB 상태 변경이 성공한 뒤 알림 전달이 확인되지 않으면 화면은 실패나 재시도 가능한 미처리 상태로 되돌리지 않는다. 대신 `처리 완료 · 알림 확인 필요`와 고정 안내를 표시하고 최신 데이터를 다시 조회한다.
- 부분 실패 안내에서 수신자 식별자, 메시지 원문, 토큰, provider 응답은 노출하지 않는다.
- POST/PATCH/DELETE는 네트워크 응답 유실만으로 자동 재호출하지 않는다. 첨부 후처리 재시도는 저장된 entity id와 동일한 delivery key/manifest를 사용하며 primary mutation을 반복하지 않는다.

## 2026-07-03 Messenger Bridge Contract Notes

- `app/request-board-messenger.tsx` must follow the same messenger interaction contract as direct and group chat: link rendering/opening, long-press action menu, copy/delete actions, and numeric unread count display where read-state data exists.
- Request-board messenger long-press UI must use `components/MessengerMessageActionSheet.tsx`; request-board-only limitations such as no reactions/reply/notice are represented by omitted capability props, not by a separate alert menu.
- Shared UI/action primitive drift for bridge screens is inventoried by `scripts/audit/shared-ui-contract-audit.cjs` and governed by `docs/handbook/shared-ui-action-contracts.md`.
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
- 안내 문구만 정규화하며, 자동 로그아웃/라우팅이나 재로그인 버튼은 별도 제품 결정 없이는 추가하지 않는다.

## 2026-06-09 모바일 설계코드 focus refresh 메모

- `request-board-create`는 최초 데이터 로드 이후 화면 focus 복귀 시 `rbGetDesigners()`와 `rbGetFcCodes()`를 다시 호출한다.
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
