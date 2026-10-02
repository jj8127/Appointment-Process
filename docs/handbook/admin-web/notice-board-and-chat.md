doc_id: FC-ADMIN-NOTICE-BOARD-CHAT
owner_repo: fc-onboarding-app
owner_area: admin-web
audience: operator, developer
last_verified: 2026-07-29
source_of_truth: web/src/app/dashboard/notifications/* + web/src/app/dashboard/board/page.tsx + web/src/app/dashboard/messenger/page.tsx + web/src/app/dashboard/chat/page.tsx

# Admin Web Playbook: Notice, Board, Chat

## 2026-10-02 알림 프록시와 Edge 요청 일치

브라우저 프록시의 대화 resolver는 `target_id` 또는 `conversation_id` 하나만 전송한다. 사용하지 않는 키의 `null`도 Edge에서는 두 식별자를 동시에 제공한 것으로 판단한다. 관리자 미확인 수 요청은 검증된 직원 전화번호로 전달하며 기존 브라우저의 공용 `admin` 표시는 검증된 일반 관리자에서만 호환한다. 다른 계정 식별자와 역할 위조는 거절한다. 실제 웹 정책의 출력이 저장소의 Edge 정책을 통과하는 교차 회귀 테스트로 검증한다. 이 최신 소스 보완은 로컬 수정이며 운영 배포된 게시판 전용 소스와 구분한다.

## 2026-10-02 Comment operation IDs

Admin web shares the mobile comment operation lifetime: an unchanged failed draft keeps its request ID, successful completion releases it, and a different account/post/reply/content creates a new ID. SQL persists the comment and notifications atomically; request-ID conflicts do not overwrite an existing comment. Backend migration/RPC deployment must precede the updated web client. The legacy API body remains supported for existing apps.


## 포함 화면

- `/dashboard/notifications/*`
- `/dashboard/board`
- `/dashboard/messenger`
- `/dashboard/chat`

## 운영 포인트

- 공지는 legacy `notices`와 board `notice` category가 동시에 존재할 수 있습니다.
- `/dashboard/board`의 글 종류는 backend board canonical category와 같은 `공지`, `교육 일정`, `일반`, `상품추천`, `시책` 5종을 따라야 합니다.
- manager는 본인 legacy notice만 수정/삭제 가능한 계약을 따릅니다.
- 메신저/채팅은 운영 보조 수단이지 request_board 요청 상태 원천이 아닙니다.
- `/dashboard/chat`은 운영자 대화 확인 화면이지만, 모바일 알림 deep-link와 같은 notice/thread 컨텍스트를 공유하므로 라우팅 규칙을 별도로 어긋나게 바꾸면 안 됩니다.

## 주요 액션

- 공지 생성/수정/삭제
- 게시글 확인
- 운영 메시지 확인
- 헤더 알림센터에서 unread 확인, 읽음 처리, 정확한 대상 화면 이동
- 브라우저/Windows 알림 권한·테스트·재등록 UI는 제공하지 않음

## 연관 문서

- [../backend/board-api-and-notice-model.md](../backend/board-api-and-notice-model.md)
- [../backend/notifications-inbox-push.md](../backend/notifications-inbox-push.md)
