doc_id: FC-DATA-MODEL-CANON
owner_repo: fc-onboarding-app
owner_area: data
audience: developer, operator
last_verified: 2026-03-26
source_of_truth: supabase/schema.sql + supabase/migrations/*

# Data Handbook: Data Model Canon

## canonical 원칙

- `fc-onboarding-app`는 `supabase/schema.sql`과 matching migration을 함께 canonical snapshot으로 봅니다.
- schema 변경은 `schema.sql`과 `supabase/migrations/*.sql`를 반드시 동시 갱신합니다.
- request_board는 별도 canonical runtime contract를 사용하므로 혼동하지 않습니다.

## 핵심 테이블군

- `fc_profiles`
- `fc_identity_secure`
- `fc_credentials`
- `admin_accounts`
- `manager_accounts`
- docs/board/notification/presence/referral 관련 테이블
