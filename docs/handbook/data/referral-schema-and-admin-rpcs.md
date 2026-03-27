doc_id: FC-DATA-REFERRAL
owner_repo: fc-onboarding-app
owner_area: data
audience: developer, operator
last_verified: 2026-03-26
source_of_truth: supabase/migrations/20260323000001_add_referral_schema.sql + supabase/migrations/20260325000001_add_referral_code_admin_foundation.sql

# Data Handbook: Referral Schema And Admin RPCs

## 핵심 테이블

- `referral_codes`
- `referral_attributions`
- `referral_events`

## 운영 함수

- backfill
- issue
- rotate
- disable

## 문서 주의

- 1차 schema migration만 보면 불완전합니다.
- admin foundation migration까지 반영된 현재 계약을 기준으로 읽습니다.
