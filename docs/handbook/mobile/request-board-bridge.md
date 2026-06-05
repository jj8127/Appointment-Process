doc_id: FC-APP-REQUEST-BOARD-BRIDGE
owner_repo: fc-onboarding-app
owner_area: mobile
audience: developer, operator
last_verified: 2026-04-16
source_of_truth: app/request-board*.tsx + lib/request-board-api.ts + lib/request-board-session.ts + request_board/server/src/routes/messages.ts

# Mobile Playbook: GaramLink Bridge

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

## 2026-06-05 모바일 설계요청 메모

- `request-board-create`는 고객 중심 흐름에서 고객 선택, 신규 고객 등록, 요청 구성, 설계매니저 선택, 완료 단계를 내부 step으로 관리한다.
- 첨부는 선택값이고 설계매니저 선택은 필수값이다. 설계매니저 선택 sheet는 이름 검색, 완료 CTA, keyboard-safe layout, drag/close 동작을 유지해야 한다.
- 신규 고객 등록/요청 구성의 text input은 스크롤 중 키보드가 닫히지 않도록 기존 앱의 `keyboardShouldPersistTaps`/keyboard avoidance 패턴을 따른다.
- `request-board-fc-codes`의 회사 선택 목록은 검색 결과 전체를 스크롤로 탐색할 수 있어야 하며, 표시 수 제한으로 일부 보험사가 가려지면 회귀다.
- 운전 여부/운전 관련 상태값은 `lib/request-board-driving-status.ts`의 옵션 계약을 따른다.

## 연관 문서

- [../shared/cross-repo-bridge-contract.md](E:/hanhwa/fc-onboarding-app/docs/handbook/shared/cross-repo-bridge-contract.md)
- [request_board handbook](E:/hanhwa/request_board/docs/handbook/INDEX.md)
