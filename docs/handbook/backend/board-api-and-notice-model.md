doc_id: FC-BACKEND-BOARD-NOTICE
owner_repo: fc-onboarding-app
owner_area: backend
audience: developer, operator
last_verified: 2026-06-08
source_of_truth: supabase/functions/board-* + web/src/app/api/admin/notices/route.ts

# Backend Runbook: Board API And Notice Model

## 소유 범위

- board category/post/comment/reaction/pin APIs
- signed attachment upload/finalize/delete
- notice source merge

## 핵심 포인트

- board API는 Edge Function 중심입니다.
- 공지는 legacy `notices`와 board `notice` category가 공존합니다.
- 기본 board category seed에는 `공지`, `교육 일정`, `일반`, `상품추천`(`garam-pick`), `시책`(`policy`) 5종만 포함됩니다.
- `latest_notice`는 board notice를 우선 사용합니다.
- attachment metadata와 object 삭제 실패가 완전히 같지 않을 수 있습니다.
- category create/update Edge Function은 canonical slug/name/sort order만 허용하며, legacy "four types" 문구를 사용자 노출 에러로 되살리지 않습니다.

## 라우팅 메모

- 모바일 알림함과 홈 notice 진입은 `board_notice:*` 식별자를 notice 전용 상세가 아니라 board post 상세 경험으로 수렴시켜야 합니다.
- 운영 웹의 `/dashboard/chat`도 동일한 notice/thread 컨텍스트를 재사용하므로, board notice 라우팅을 바꿀 때는 모바일 `notice-route`와 함께 검토합니다.

## 2026-04-06 운영 메모

- 일반 게시판 글 작성은 `board-create`가 게시글 저장과 inbox row insert를 담당합니다.
- 일반 게시판 글 수정은 `board-update`가 게시글 수정 후 같은 `/board-detail?postId=...` target으로 inbox row insert와 push fanout을 담당합니다.
- 다만 push/web-push fanout의 SSOT는 계속 `fc-notify`이므로, `board-create`가 직접 `notifications` row를 넣는 경우에도 같은 요청 흐름에서 `fc-notify`를 다시 호출해야 합니다.
- 이때 중복 inbox row를 막기 위해 `fc-notify`에는 `skip_notification_insert=true`를 함께 전달합니다.

## 2026-06-08 카테고리 운영 메모

- `garam-pick`의 표시명은 `상품추천`이며 stable slug는 계속 `garam-pick`입니다.
- `policy`는 `시책` 표시명과 sort order 5를 사용합니다.
- canonical 5종 밖의 legacy category 게시글은 migration에서 `general`로 재배치하고 old category는 inactive 처리합니다.
