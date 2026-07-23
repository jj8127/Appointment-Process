doc_id: FC-BACKEND-SCHEDULED-RUNTIME
owner_repo: fc-onboarding-app
owner_area: backend
audience: developer, operator
last_verified: 2026-07-23
source_of_truth: supabase/functions/docs-deadline-reminder/index.ts + supabase/functions/user-presence/index.ts + hooks/use-app-presence-heartbeat.ts

# Backend Runbook: Scheduled Jobs And Runtime

## 2026-07-23 Reminder delivery checkpoint

- The production scheduler must call `docs-deadline-reminder` with an `Authorization` header whose value is exactly `Bearer <SUPABASE_SERVICE_ROLE_KEY>`. An anon key, user JWT, or `apikey` header alone is not authorized; Edge `verify_jwt` is only the outer gateway check and is not the job's authorization boundary.
- Keep the service-role value in the scheduler secret store. Never put the value or raw authorization header in job output, diagnostics, or this handbook.
- `docs-deadline-reminder` advances `docs_deadline_last_notified_at` only after the Expo provider accepts every attempted delivery ticket. Zero-attempt, partial, rejected, and timed-out deliveries remain retryable.
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
