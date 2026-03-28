doc_id: FC-BACKEND-BOARD-NOTICE
owner_repo: fc-onboarding-app
owner_area: backend
audience: developer, operator
last_verified: 2026-03-28
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
