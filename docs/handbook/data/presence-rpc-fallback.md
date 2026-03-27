doc_id: FC-DATA-PRESENCE-RPC
owner_repo: fc-onboarding-app
owner_area: data
audience: developer, operator
last_verified: 2026-03-26
source_of_truth: supabase/functions/user-presence/index.ts + supabase/migrations/20260311000003_create_user_presence.sql

# Data Handbook: Presence RPC Fallback

## 핵심 계약

- `user_presence` table
- `get_user_presence`, `touch_user_presence`, `stale_user_presence` RPC
- service-role grants

## 운영 주의

- RPC가 없어도 fallback이 있을 수 있지만 이는 정상 구성과 동일하지 않습니다.
- stale threshold와 sentinel timestamp를 함께 이해해야 합니다.
