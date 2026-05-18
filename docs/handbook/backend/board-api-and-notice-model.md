doc_id: FC-BACKEND-BOARD-NOTICE
owner_repo: fc-onboarding-app
owner_area: backend
audience: developer, operator
last_verified: 2026-04-06
source_of_truth: supabase/functions/board-* + web/src/app/api/admin/notices/route.ts

# Backend Runbook: Board API And Notice Model

## 소유 범위

- board category/post/comment/reaction/pin APIs
- signed attachment upload/finalize/delete
- notice source merge

## 핵심 포인트

- board API는 Edge Function 중심입니다.
- 공지는 legacy `notices`와 board `notice` category가 공존합니다.
- `latest_notice`는 board notice를 우선 사용합니다.
- attachment metadata와 object 삭제 실패가 완전히 같지 않을 수 있습니다.

## 라우팅 메모

- 모바일 알림함과 홈 notice 진입은 `board_notice:*` 식별자를 notice 전용 상세가 아니라 board post 상세 경험으로 수렴시켜야 합니다.
- 운영 웹의 `/dashboard/chat`도 동일한 notice/thread 컨텍스트를 재사용하므로, board notice 라우팅을 바꿀 때는 모바일 `notice-route`와 함께 검토합니다.

## 2026-04-06 운영 메모

- 일반 게시판 글 작성은 `board-create`가 게시글 저장과 inbox row insert를 담당합니다.
- 다만 push/web-push fanout의 SSOT는 계속 `fc-notify`이므로, `board-create`가 직접 `notifications` row를 넣는 경우에도 같은 요청 흐름에서 `fc-notify`를 다시 호출해야 합니다.
- 이때 중복 inbox row를 막기 위해 `fc-notify`에는 `skip_notification_insert=true`를 함께 전달합니다.
