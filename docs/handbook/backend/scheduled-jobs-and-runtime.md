doc_id: FC-BACKEND-SCHEDULED-RUNTIME
owner_repo: fc-onboarding-app
owner_area: backend
audience: developer, operator
last_verified: 2026-10-14
source_of_truth: supabase/migrations/20261014140000_platform_withdrawal_drain_schedule.sql + supabase/functions/docs-deadline-reminder/index.ts + supabase/functions/user-presence/index.ts + hooks/use-app-presence-heartbeat.ts

# Backend Runbook: Scheduled Jobs And Runtime

## 2026-10-14 공통 탈퇴 정리 drain 예약

pg_cron `platform-withdrawal-cleanup-drain`이 5분마다 `public.request_platform_withdrawal_drain_v1()`를 실행한다. due 탈퇴가 있고 Vault secret `platform_withdrawal_drain_service_key`가 있을 때만 pg_net으로 `platform-service`의 `withdrawal_cleanup_drain`을 호출한다. Edge는 같은 service-role 값이 `apikey`와 `Authorization: Bearer`에 모두 있을 때만 받아 최대3건을 각 operation lock 아래 처리하고 실패는 backoff로 남긴다.

- secret 값은 source·migration·로그·증거에 넣지 않는다. 등록·교체는 운영자가 대시보드 SQL 편집기에서 `vault.create_secret` / `vault.update_secret`으로 한다. 값은 Edge `SUPABASE_SERVICE_ROLE_KEY`와 정확히 같아야 한다.
- secret이 없으면 job은 아무것도 하지 않는다. 중지는 `select cron.unschedule('platform-withdrawal-cleanup-drain');`이다.
- 호출 결과는 `net._http_response`에서 status만 확인한다. 응답 본문·헤더를 증거로 복사하지 않는다.

## 2026-10-13 필수 target 조회와 presence 결과

presence와 서류 마감 알림은 필수 actor/대상/상태 조회의 오류나 불완전한 페이지를 정상 없음·offline·전송 완료로 처리하지 않는다. 기존 presence-query contract는 actor 권한과 결과 행/count를 검증하고 필수 실패를 호출자에 전달한다. reminder의 대상 조회가 실패하면 당일 checkpoint를 앞당기지 않으며 provider 부분 실패의 기존 재시도 계약을 유지한다.

가까운 `presence-query-contract_test.ts`, `presence-read-response.test.ts`, `docs-deadline-reminder-source.test.ts`와 Edge handler suite를 확장해 결과·호출·checkpoint를 확인한다. 로그는 고정 분류와 count만 사용하며 고객 대상이나 원문 응답을 보관하지 않는다.

## 2026-10-10 CORS 공통 처리

docs-deadline-reminder·user-presence의 공통 serveWithConfiguredCors는 등록된 요청 origin을 반환하고 Vary를 보강한다. Origin 없는 서버/native 호출, 예약 시각, presence 정책과 알림 mutation은 유지한다. cron 전용 함수의 OPTIONS와 브라우저 직접 호출 장애를 구분한다. [공통 계약](./notifications-inbox-push.md#web-edge-cors-boundary-2026-10-10) 및 데이터 없는54개 함수 감사 기록을 따른다.

## 2026-07-29 Persisted reminder target contract

- `docs-deadline-reminder` persists a typed `onboarding_section/docs_upload`
  target with the exact FC actor before attempting push delivery.
- A same-day reminder is reusable only when its persisted recipient role,
  actor, resident identifier, and typed target all validate. A malformed or
  mismatched row fails closed instead of authorizing delivery.
- Expo payloads carry the persisted `notificationId` and the same typed target,
  so notification-center reads and deep links acknowledge the authoritative
  inbox row rather than a client-generated identifier.

## 2026-07-23 Reminder delivery checkpoint

- The production scheduler must call `docs-deadline-reminder` with an `Authorization` header whose value is exactly `Bearer <SUPABASE_SERVICE_ROLE_KEY>`. An anon key, user JWT, or `apikey` header alone is not authorized; Edge `verify_jwt` is only the outer gateway check and is not the job's authorization boundary.
- Keep the service-role value in the scheduler secret store. Never put the value or raw authorization header in job output, diagnostics, or this handbook.
- `docs-deadline-reminder` advances `docs_deadline_last_notified_at` only after the Expo provider accepts every attempted delivery ticket. Zero-attempt, partial, rejected, and timed-out deliveries remain retryable.
- Before token lookup, the reminder evaluates the FC actor's global and `operations` push preferences. An explicit opt-out advances the daily checkpoint without calling Expo; a preference lookup failure is fail-closed, increments only the bounded warning count, and leaves the checkpoint retryable.
- Provider rejection, transport failure, or an empty eligible-token set remains retryable and must not advance the reminder checkpoint.
- Before inserting the reminder inbox row, the job checks for the same FC and `docs-deadline` category inside the current KST calendar-day boundary. An existing row skips only the inbox insert; token lookup and push retry still run.
- This query-before-insert prevents sequential retry duplicates without a schema migration. Concurrent invocations can still race until a database uniqueness constraint or atomic RPC is introduced, so the scheduler must avoid overlapping runs.
- Runtime responses and diagnostics expose only bounded delivery counts and fixed reason codes; they never include tokens, recipient identifiers, or provider response bodies.
- Every Expo chunk has a 10-second deadline so a stalled provider cannot consume the whole Edge handler budget. Timeout handling uses the same aggregate delivery warning contract.

## 2026-07-06 Presence Route Auth Contract

- Admin web presence APIs must use the signed server-session helper before exposing online state. Raw session cookies are not enough to authorize the route.

## 포함 항목

- `docs-deadline-reminder`
- `user-presence`
- 모바일 presence heartbeat
- request_board messenger polling 연계

## 핵심 메모

- 서류 reminder는 D-3/D-1/D-day/D+1 정책과 `docs_deadline_last_notified_at`에 의존합니다.
- presence는 RPC 실패 시 fallback 경로가 있습니다.
- presence는 공유 datastore가 아니라 각 저장소/프로젝트별 runtime illusion임을 전제로 봅니다.
