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
| recommender | text | - | 추천인 |
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
