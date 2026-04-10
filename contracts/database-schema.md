# Database Schema Contract

> 이 문서는 DB 스키마의 "계약"입니다.
> DB 변경 시 이 문서를 먼저 업데이트하고, ADR을 작성하세요.

---

## 1. 핵심 테이블

### 1.1 fc_profiles (FC 프로필)
FC 사용자의 메인 프로필 테이블

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | uuid | PK | 고유 ID |
| phone | text | UNIQUE, NOT NULL | 전화번호 (로그인 ID) |
| name | text | NOT NULL | 이름 |
| affiliation | text | NOT NULL | 소속 |
| email | text | - | 이메일 |
| address | text | - | 주소 |
| address_detail | text | - | 상세주소 |
| recommender | text | - | 추천인 표시 cache(레거시 호환, trusted path만 갱신) |
| recommender_fc_id | uuid | FK → fc_profiles.id, nullable | 구조화된 추천인 FC 링크 |
| resident_id_masked | text | - | 마스킹된 주민번호 (예: 900101-1******) |
| resident_id_hash | text | UNIQUE | 주민번호 해시 (중복체크용) |
| career_type | text | - | '신입' \| '경력' \| null |
| temp_id | text | - | 임시사번 |
| status | text | NOT NULL | 상태값 (아래 참조) |
| identity_completed | boolean | DEFAULT false | 신원확인 완료 여부 |
| phone_verified | boolean | DEFAULT false | 전화번호 인증 여부 |
| allowance_date | date | - | 수당 동의일 |
| appointment_date_life | date | - | 생명보험 위촉일 |
| appointment_date_nonlife | date | - | 손해보험 위촉일 |
| docs_deadline_at | timestamptz | - | 서류 마감일 |
| is_tour_seen | boolean | DEFAULT false | 투어 가이드 본 여부 |
| created_at | timestamptz | DEFAULT now() | 생성일 |

**status 값 (FcStatus 타입)**
```typescript
type FcStatus =
  | 'draft'                    // 초안 (가입 직후)
  | 'temp-id-issued'          // 임시사번 발급됨
  | 'allowance-pending'       // 수당 동의 대기
  | 'allowance-consented'     // 수당 동의 완료
  | 'docs-requested'          // 서류 요청됨
  | 'docs-pending'            // 서류 제출 대기
  | 'docs-submitted'          // 서류 제출됨
  | 'docs-rejected'           // 서류 반려됨
  | 'docs-approved'           // 서류 승인됨
  | 'appointment-completed'   // 위촉 완료
  | 'final-link-sent';        // 최종 링크 발송
```

### 1.2 fc_identity_secure (민감정보 암호화 저장)
주민번호 등 민감정보 암호화 저장

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | uuid | PK | fc_profiles.id 참조 |
| resident_number_encrypted | text | NOT NULL | AES-GCM 암호화된 주민번호 |
| address_encrypted | text | - | 암호화된 주소 |
| created_at | timestamptz | DEFAULT now() | 생성일 |

**보안 규칙**
- 평문 주민번호 저장 절대 금지
- 암호화는 store-identity Edge Function에서만 수행
- 복호화는 서버 사이드에서만 가능

### 1.3 fc_credentials (로그인 자격증명)
FC 비밀번호 저장

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| phone | text | PK | fc_profiles.phone 참조 |
| password_hash | text | NOT NULL | PBKDF2 해시 |
| password_salt | text | NOT NULL | 랜덤 솔트 |
| created_at | timestamptz | DEFAULT now() | 생성일 |

**해시 규칙**
- Algorithm: PBKDF2
- Iterations: 100,000
- Hash: SHA-256
- Salt: 16 bytes random

### 1.4 fc_documents (서류)
FC 제출 서류

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | uuid | PK | 고유 ID |
| fc_id | uuid | FK → fc_profiles.id | FC 참조 |
| doc_type | text | NOT NULL | 서류 종류 |
| storage_path | text | - | Storage 경로 |
| file_name | text | - | 원본 파일명 |
| status | text | DEFAULT 'pending' | 'pending' \| 'approved' \| 'rejected' |
| reviewer_note | text | - | 리뷰어 코멘트 |
| created_at | timestamptz | DEFAULT now() | 생성일 |

### 1.5 admin_accounts / manager_accounts (관리자)
관리자/매니저 계정

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| phone | text | PK | 전화번호 (로그인 ID) |
| name | text | NOT NULL | 이름 |
| password_hash | text | NOT NULL | 비밀번호 해시 |
| password_salt | text | NOT NULL | 솔트 |
| created_at | timestamptz | DEFAULT now() | 생성일 |

### 1.6 referral_codes (추천코드 마스터)
추천인 코드와 소유 FC를 관리

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | uuid | PK | 추천코드 row ID |
| fc_id | uuid | FK → fc_profiles.id | 코드 소유 FC |
| code | text | UNIQUE, NOT NULL | 추천코드 |
| is_active | boolean | DEFAULT true | 현재 활성 코드 여부 |
| disabled_at | timestamptz | - | 비활성화 시각 |
| created_at | timestamptz | DEFAULT now() | 생성일 |
| updated_at | timestamptz | DEFAULT now() | 수정일 |

**제약**
- 동일 `code` 중복 금지
- FC당 활성 코드 1개만 허용(partial unique index)
- direct client select/write는 허용하지 않고, 운영/admin 또는 trusted server path만 접근한다.

### 1.7 referral_attributions (추천 관계 추적/확정)
자동 입력, 수동 수정, 가입 완료 후 확정까지의 추천 관계 추적

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | uuid | PK | 추천 관계 row ID |
| inviter_fc_id | uuid | FK → fc_profiles.id, nullable | 추천한 FC FK(삭제 후 null 가능) |
| inviter_phone | text | NOT NULL | 추천인 전화번호 snapshot(11자리 정규화) |
| inviter_name | text | nullable | 추천인 이름 snapshot |
| invitee_fc_id | uuid | FK → fc_profiles.id, nullable | 추천받아 가입한 FC |
| invitee_phone | text | NOT NULL | 가입자 전화번호(11자리 정규화) |
| referral_code_id | uuid | FK → referral_codes.id, nullable | 사용된 추천코드 row |
| referral_code | text | NOT NULL | 사용된 추천코드 원문 |
| source | text | nullable | 최종 확정 source (`auto_prefill`/`manual_entry`/`admin_override`) |
| capture_source | text | NOT NULL | 최초 유입 source (`invite_link`/`manual_entry`/`unknown`) |
| selection_source | text | nullable | 사용자가 최종 선택한 방식 |
| status | text | NOT NULL | `captured`/`pending_signup`/`confirmed`/`rejected`/`cancelled`/`overridden` |
| landing_session_id | text | - | 랜딩/유입 세션 식별자 |
| device_hint | text | - | 기기/채널 힌트 |
| rejection_reason | text | - | 거절 사유 |
| captured_at | timestamptz | DEFAULT now() | 최초 포착 시각 |
| confirmed_at | timestamptz | - | 최종 확정 시각 |
| cancelled_at | timestamptz | - | 취소 시각 |
| created_at | timestamptz | DEFAULT now() | 생성일 |
| updated_at | timestamptz | DEFAULT now() | 수정일 |

**제약**
- invitee phone 기준 `confirmed` row는 1건만 허용
- invitee fc_id 기준 `confirmed` row도 1건만 허용(partial unique index)
- inviter와 invitee가 동일 FC가 되는 self-reference는 차단
- inviter/invitee phone은 숫자 11자리 정규화 문자열만 허용
- inviter 삭제 후에도 row는 남고 snapshot으로 복원 가능해야 한다

### 1.8 referral_events (추천 이벤트 로그)
추천 흐름 단계별 이벤트와 override 이력 저장

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | uuid | PK | 이벤트 row ID |
| attribution_id | uuid | FK → referral_attributions.id, nullable | 연결된 추천 관계 |
| referral_code_id | uuid | FK → referral_codes.id, nullable | 연결된 추천코드 |
| referral_code | text | nullable | 추천코드 snapshot |
| inviter_fc_id | uuid | FK → fc_profiles.id, nullable | 추천인 FC |
| inviter_phone | text | nullable | 추천인 전화번호 snapshot |
| inviter_name | text | nullable | 추천인 이름 snapshot |
| invitee_fc_id | uuid | FK → fc_profiles.id, nullable | 가입자 FC |
| invitee_phone | text | - | 가입자 전화번호 |
| event_type | text | NOT NULL | 추천 이벤트 유형 |
| source | text | nullable | 이벤트 시점 source |
| landing_session_id | text | - | 랜딩 세션 |
| metadata | jsonb | DEFAULT `{}` | 부가 로그 |
| created_at | timestamptz | DEFAULT now() | 생성일 |

**대표 event_type**
- `link_clicked`
- `app_opened_from_link`
- `code_auto_prefilled`
- `code_edited_before_signup`
- `pending_attribution_saved`
- `signup_completed`
- `referral_confirmed`
- `referral_rejected`
- `code_generated`
- `code_rotated`
- `code_disabled`
- `admin_override_applied`

### 1.9 Referral Admin Helper Functions

추천코드 운영 기반은 direct table write 대신 아래 service-role 함수 계약을 사용한다.

- `generate_referral_code_candidate()`
  - 문자집합 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` 기반 8자리 후보 생성
- `is_request_board_designer_affiliation(text)`
  - `설계매니저` 패턴 여부 판별
- `admin_issue_referral_code(fc_id, actor_phone, actor_role, actor_staff_type, reason, rotate)`
  - completed FC에 대해 추천코드 발급 또는 재발급
  - `admin_accounts`, `manager_accounts`, request_board-linked designer, 비정규 11자리 phone은 발급 금지
  - `referral_events`에 `code_generated` 또는 `code_rotated`와 actor metadata 기록
- `admin_disable_referral_code(fc_id, actor_phone, actor_role, actor_staff_type, reason)`
  - 현재 활성 코드 1건을 비활성화하고 `code_disabled` 이벤트 기록
- `admin_backfill_referral_codes(limit, actor_phone, actor_role, actor_staff_type, reason)`
  - 최대 100건 수동 batch
  - `signup_completed=true`, `11자리 phone`, non-designer, non-admin, non-manager, 활성 코드 없음 조건만 처리
  - 반복 호출 가능하도록 `FOR UPDATE SKIP LOCKED` 기반 resumable batch
- `admin_apply_recommender_override(invitee_fc_id, inviter_fc_id, actor_phone, actor_role, actor_staff_type, reason)`
  - 추천인 선택/변경/clear를 단일 RPC로 처리
  - `fc_profiles.recommender_fc_id`, `fc_profiles.recommender`, `referral_attributions`, `referral_events.admin_override_applied`를 함께 갱신
  - 활성 추천코드가 있는 FC만 추천인으로 선택 가능
  - self-reference 금지, 사유 필수
  - 원격 DB에 migration `20260331000005_admin_apply_recommender_override.sql`가 반영되기 전에는 이 함수를 호출하는 웹 UI를 배포하지 않는다.
- `get_referral_subtree(root_fc_id, max_depth)`
  - 모바일 self-service referral tree(`app/referral.tsx` inline section)용 trusted read RPC
  - root row + ancestor chain + descendant subtree를 한 번에 반환하고, descendant row에는 `direct_invitee_count`, `total_descendant_count`, `relationship_source`를 포함한다.
  - descendant BFS에서는 `is_manager_referral_shadow=true` child row를 제외하지만, ancestor chain은 현재 `recommender_fc_id`에 active manager shadow가 저장된 경우 그 shadow recommender를 그대로 포함한다. execute grant는 `service_role` only 다.

### 1.10 Legacy Note

- `fc_profiles.recommender_fc_id`가 구조화 추천인 링크의 직접 참조다.
- `fc_profiles.recommender`는 현재 표시 cache/레거시 호환 필드이며, 일반 FC 기본정보 수정 경로에서 자유입력으로 갱신하지 않는다.
- 구조화된 추천인 SSOT는 `referral_codes`, `referral_attributions`, `referral_events`, `fc_profiles.recommender_fc_id`다.
- 추천인 테이블 direct access는 V1에서 열지 않고, referral 전용 Edge Function/trusted server path를 통해서만 사용한다.
- invitee 추천코드 조회 함수 `get_invitee_referral_code(uuid)`는 이름 문자열 매칭을 금지하고, `recommender_fc_id`와 structured attribution만 사용한다.
- confirmed attribution이 있으면 invitee 추천코드 표시는 historical signup code를 우선한다. 즉 `referral_code_id row -> referral_code snapshot -> inviter current active code -> recommender_fc_id current active code` 순서로만 fallback 한다.
- `get_invitee_referral_code(uuid)` execute grant의 intended repo contract는 `20260401000002_reassert_get_invitee_referral_code_service_role_only.sql` 이후 `service_role` only 다. 새 구현은 `admin-action:getInviteeReferralCode` 또는 server-only route를 사용한다.
- `get_referral_subtree(uuid, int)`도 동일하게 `service_role` only trusted read helper다. 모바일 앱은 direct RPC를 호출하지 않고 `get-referral-tree` Edge Function을 통해서만 사용한다.

---

## 2. Storage 버킷

### fc-documents
- **용도**: FC 제출 서류 저장
- **접근**: authenticated users only
- **경로 패턴**: `{fc_id}/{doc_type}/{filename}`

---

## 3. RLS 정책

모든 테이블에 Row Level Security 활성화됨

| 테이블 | 정책 |
|--------|------|
| fc_profiles | FC는 자기 데이터만, Admin은 전체 |
| fc_identity_secure | Edge Function만 (service role) |
| fc_documents | FC는 자기 서류만, Admin은 전체 |
| referral_codes | 운영/admin 직접 조회만, 실사용 read/write는 trusted server path |
| referral_attributions | direct client access 금지, trusted server path 또는 운영/admin만 접근 |
| referral_events | direct client access 금지, trusted server path 또는 운영/admin만 접근 |

---

## 4. TypeScript 타입 매핑

DB 스키마와 TypeScript 타입 매핑은 `types/fc.ts`에 정의

```typescript
// types/fc.ts
export type FcProfile = {
  id: string;           // uuid → string
  phone: string;        // text → string
  name: string;         // text → string
  tempId?: string;      // temp_id → tempId (snake→camel)
  createdAt: string;    // created_at → createdAt
  // ...
};
```

**규칙**
- snake_case (DB) → camelCase (TS)
- nullable 컬럼 → optional property (`?`)
- date/timestamptz → string (ISO format)
