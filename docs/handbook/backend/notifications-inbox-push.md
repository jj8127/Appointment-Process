doc_id: FC-BACKEND-NOTIFY-PUSH
owner_repo: fc-onboarding-app
owner_area: backend
audience: developer, operator
last_verified: 2026-03-26
source_of_truth: supabase/functions/fc-notify/index.ts + web/src/app/api/admin/push/route.ts + web/src/app/api/web-push/subscribe/route.ts

# Backend Runbook: Notifications, Inbox, And Push

## 소유 범위

- inbox list/unread/delete
- Expo push
- admin web push callback
- latest notice
- request_board unread merge

## 핵심 계약

- `fc-notify`가 notification persistence와 push fanout의 중심입니다.
- admin web push는 `/api/admin/push`와 subscription registry를 통해 보조됩니다.
- request_board bridge unread는 admin/developer session에서 `requestBoardRole='fc'`일 때 함께 합산될 수 있습니다.

## 운영 실수

- web push identity row를 권한 원천으로 오해하지 않음
- badge 숫자와 앱 unread는 동기화 주기가 다를 수 있음
- bridge notification이 앱 한쪽에만 보이면 request_board fanout부터 추적
