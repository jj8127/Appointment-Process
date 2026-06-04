doc_id: FC-BACKEND-NOTIFY-PUSH
owner_repo: fc-onboarding-app
owner_area: backend
audience: developer, operator
last_verified: 2026-05-21
source_of_truth: supabase/functions/fc-notify/index.ts + supabase/functions/board-create/index.ts + supabase/functions/board-update/index.ts + web/src/app/actions.ts + web/src/app/api/admin/push/route.ts + web/src/app/api/web-push/subscribe/route.ts

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
- Expo push API는 한 요청에 최대 100개 payload만 허용하므로 `fc-notify`는 mobile push payload를 100개 단위로 chunk 전송합니다.
- 2026-06-03 현재 카카오톡 delivery adapter는 활성 계약이 아니다. `fc-notify`는 inbox row와 app/web push를 유지하되 `notification_deliveries` 같은 별도 Kakao audit table에 쓰지 않는다.
- 사용자-facing 알림 제목/분기 문구는 `보증 보험 동의`, `다위촉` 명칭을 사용한다. 내부 `allowance_*`, `hanwha_*` identifier는 기존 DB 호환 때문에 유지될 수 있다.

## 2026-03-28 기준 주의점

- 웹 총무/관리자 경로가 `notifications` row를 직접 insert한 뒤 `sendPushNotification()`을 호출할 때는 helper가 다시 row를 만들지 않도록 `skipNotificationInsert`를 사용합니다.
- FC 제출 알림(`fc_update`)의 수신자는 `admin_accounts`와 `manager_accounts`를 함께 해석하고, 실제 device token fanout도 `admin`뿐 아니라 `manager` role을 같이 포함해야 합니다.
- 모바일 홈 unread badge는 checkpoint가 없을 때 `0`으로 초기화하지 않고, 알림센터를 한 번도 열지 않은 사용자에게는 전체 unread를 보여줍니다.

## 2026-04-06 게시판 알림 메모

- 일반 게시판 글 작성은 `board-create`가 inbox row를 직접 저장하는 예외 경로입니다.
- 일반 게시판 글 수정은 `board-update`가 같은 board post target URL로 inbox row와 `fc-notify` push fanout을 함께 보냅니다.
- 이 경로는 row 저장만으로 끝내면 가람in/app/web push가 빠지므로, 같은 change set에서 반드시 `fc-notify` fanout을 함께 호출해야 합니다.
- direct row insert 이후 `fc-notify`를 다시 부를 때는 `skip_notification_insert=true`를 사용해 중복 알림 row를 만들지 않습니다.
- 게시판 글 fanout은 최소 두 축이 필요합니다.
  - `target_role='fc'`: FC 앱 푸시
  - `target_role='admin'`: admin/manager 앱 푸시 + admin web push callback

## 2026-05-16 Codex 보험 브리핑 메모

- Codex 자동 보험소식 브리핑은 `scripts/ops/post-insurance-digest.mjs`를 통해 게시합니다.
- 스크립트는 `보험소식`(`insurance-news`) 카테고리를 확인/생성한 뒤 기존 `board-create` Edge Function으로 게시합니다.
- 따라서 자동 브리핑도 일반 게시글과 같은 inbox row 저장 및 `fc-notify` fanout 경로를 사용해야 하며, `board_posts` 직접 insert로 우회하지 않습니다.
- 같은 KST 날짜의 `보험소식 브리핑 YYYY.MM.DD` 제목이 이미 있으면 스크립트가 게시를 건너뜁니다.
- 홈 최신 공지(`latest_notice`)는 게시판 `공지`뿐 아니라 `보험소식` 카테고리 글도 포함합니다.
- 자동 브리핑 본문에는 긴 원문 URL이나 AI 참고용/비자문 disclaimer를 넣지 않고, 짧은 출처명만 노출합니다.

## 2026-03-30 정합성 메모

- `fc-notify`의 FC 제출 알림(`fc_update`, `fc_delete`)은 수신자 해석 시 `admin_accounts`, `manager_accounts`, `affiliation_manager_mappings`를 함께 참조합니다.
- 모바일 푸시 fanout도 `device_tokens.role in ('admin', 'manager')`를 포함해 총무 기기까지 도달해야 합니다.
- `recipient_role`은 inbox 조회 계약을 유지하기 위해 저장 시 여전히 `admin` 또는 `fc` 축을 사용하지만, 실제 fanout 대상은 이와 별개로 확장될 수 있습니다.
- 앱 unread 집계는 checkpoint가 없을 때 전체 unread를 기준으로 시작하고, 알림센터 진입 후부터 checkpoint 기반 증분 unread로 전환됩니다.

## 운영 실수

- web push identity row를 권한 원천으로 오해하지 않음
- badge 숫자와 앱 unread는 동기화 주기가 다를 수 있음
- bridge notification이 앱 한쪽에만 보이면 request_board fanout부터 추적

## 2026-05-30 unread characterization 메모

- 모바일 unread 집계는 checkpoint 기반 fc-onboarding unread와 live request_board unread를 분리해 계산한다.
- checkpoint key는 `role + residentId + requestBoardRole` scope를 유지해야 하며, request_board FC/designer bridge 사용자가 같은 checkpoint를 공유하면 회귀다.
- live request_board unread를 포함하는 경우에만 `fc-notify` body의 request_board category 제외 플래그도 같이 유지한다.
- polling/orchestration 경로는 checkpoint를 새로 초기화하지 않고, request_board unread fetch 실패 시 `[mobile-unread-count] fetch failed`를 남긴 뒤 `0` fallback을 유지한다.
