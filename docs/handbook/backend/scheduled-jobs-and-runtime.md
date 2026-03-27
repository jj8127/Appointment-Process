doc_id: FC-BACKEND-SCHEDULED-RUNTIME
owner_repo: fc-onboarding-app
owner_area: backend
audience: developer, operator
last_verified: 2026-03-26
source_of_truth: supabase/functions/docs-deadline-reminder/index.ts + supabase/functions/user-presence/index.ts + hooks/use-app-presence-heartbeat.ts

# Backend Runbook: Scheduled Jobs And Runtime

## 포함 항목

- `docs-deadline-reminder`
- `user-presence`
- 모바일 presence heartbeat
- request_board messenger polling 연계

## 핵심 메모

- 서류 reminder는 D-3/D-1/D-day/D+1 정책과 `docs_deadline_last_notified_at`에 의존합니다.
- presence는 RPC 실패 시 fallback 경로가 있습니다.
- presence는 공유 datastore가 아니라 각 저장소/프로젝트별 runtime illusion임을 전제로 봅니다.
