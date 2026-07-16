doc_id: FC-DATA-PRESENCE-RPC
owner_repo: fc-onboarding-app
owner_area: data
audience: developer, operator
last_verified: 2026-07-16
source_of_truth: supabase/functions/user-presence/index.ts + supabase/migrations/20260311000003_create_user_presence.sql

# Data Handbook: Presence RPC Fallback

## 핵심 계약

- `user_presence` table
- `get_user_presence`, `touch_user_presence`, `stale_user_presence` RPC
- service-role grants

## 운영 주의

- RPC가 없어도 fallback이 있을 수 있지만 이는 정상 구성과 동일하지 않습니다.
- stale threshold와 sentinel timestamp를 함께 이해해야 합니다.

## 2026-07-16 Diagnostic privacy contract

- RPC failure still falls back to the same table read/write path; diagnostics do not alter fallback timing, state, or return values.
- Read, touch, and stale fallback diagnostics use fixed `user_presence.rpc_fallback` reasons and never serialize a phone, row, RPC error, message, or stack.
