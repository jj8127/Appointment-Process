doc_id: FC-ADMIN-NOTICE-BOARD-CHAT
owner_repo: fc-onboarding-app
owner_area: admin-web
audience: operator, developer
last_verified: 2026-03-28
source_of_truth: web/src/app/dashboard/notifications/* + web/src/app/dashboard/board/page.tsx + web/src/app/dashboard/messenger/page.tsx + web/src/app/dashboard/chat/page.tsx

# Admin Web Playbook: Notice, Board, Chat

## 포함 화면

- `/dashboard/notifications/*`
- `/dashboard/board`
- `/dashboard/messenger`
- `/dashboard/chat`

## 운영 포인트

- 공지는 legacy `notices`와 board `notice` category가 동시에 존재할 수 있습니다.
- manager는 본인 legacy notice만 수정/삭제 가능한 계약을 따릅니다.
- 메신저/채팅은 운영 보조 수단이지 request_board 요청 상태 원천이 아닙니다.
- `/dashboard/chat`은 운영자 대화 확인 화면이지만, 모바일 알림 deep-link와 같은 notice/thread 컨텍스트를 공유하므로 라우팅 규칙을 별도로 어긋나게 바꾸면 안 됩니다.

## 주요 액션

- 공지 생성/수정/삭제
- 게시글 확인
- 운영 메시지 확인
- web push permission 재등록

## 연관 문서

- [../backend/board-api-and-notice-model.md](E:/hanhwa/fc-onboarding-app/docs/handbook/backend/board-api-and-notice-model.md)
- [../backend/notifications-inbox-push.md](E:/hanhwa/fc-onboarding-app/docs/handbook/backend/notifications-inbox-push.md)
