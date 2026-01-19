---
name: fc-workflow
description: FC 온보딩 워크플로우 이해 및 상태 관리 가이드. FC 상태, 위촉 프로세스, 권한 관련 질문 시 사용.
allowed-tools: Read, Grep, Glob
---

# FC 온보딩 워크플로우 가이드

FC(Financial Consultant) 온보딩 프로세스와 상태 관리를 설명합니다.

## 사용자 역할

| 역할 | 설명 | 주요 권한 |
|------|------|----------|
| **FC** | 신규 보험 설계사 | 자신의 온보딩 진행, 서류 제출 |
| **Admin** | 관리자 | FC 관리, 승인, 모든 기능 접근 |
| **Manager** | 본부장 | 읽기 전용 조회 (수정 불가) |

## FC 온보딩 상태 흐름

```
draft → temp_id_issued → consent_approved → docs_approved → appointed → completed
```

### 상태별 설명

| 상태 | 설명 | 다음 단계 |
|------|------|----------|
| `draft` | 회원가입 완료, 신원정보 미입력 | 신원정보 입력 |
| `temp_id_issued` | 임시 ID 발급됨 | 수당동의 승인 |
| `consent_approved` | 수당동의 승인됨 | 시험 등록 → 서류 승인 |
| `docs_approved` | 서류 승인 완료 | 위촉 |
| `appointed` | 위촉 완료 | 최종 완료 |
| `completed` | 온보딩 완료 | - |

## 주요 플래그

### `identity_completed`
- **false**: 신원정보(주민번호, 주소) 미입력 → `home-lite` 화면만 접근
- **true**: 신원정보 입력 완료 → 전체 기능 접근

### `phone_verified`
- 회원가입 시 SMS OTP 인증 완료 여부

## 화면 접근 제어

### identity_completed = false (home-lite)
- 1:1 메시지
- 공지사항
- 정보 게시판

### identity_completed = true (full home)
- 위 기능 + 전체 온보딩 프로세스

## 데이터베이스 테이블

### `fc_profiles`
주요 필드:
- `id`: UUID
- `temp_id`: 임시 ID (관리자 발급)
- `name`, `phone`, `affiliation`: 기본 정보
- `status`: 온보딩 상태
- `identity_completed`: 신원정보 입력 완료
- `allowance_date`: 수당동의일
- `appointment_date`: 위촉일

### `fc_identity_secure`
암호화된 민감 정보:
- `resident_number_encrypted`: 암호화된 주민번호
- `address_encrypted`: 암호화된 주소

### `fc_credentials`
로그인 정보:
- `password_hash`, `password_salt`: 비밀번호 해시
- `failed_count`, `locked_until`: 로그인 시도 제한

## 인증 플로우

### 회원가입
```
request-signup-otp → verify-signup-otp → set-password
```

### 로그인
```
login-with-password → JWT 발급 → 세션 저장
```

### 비밀번호 재설정
```
request-password-reset → reset-password
```

## Manager(본부장) 읽기 전용 모드

Manager 계정은 모든 화면에서 읽기 전용:
- 버튼: 회색(disabled)
- 토글: 회색 + 투명도 감소
- 입력 필드: disabled
- 알림 배너: "읽기 전용 모드 - 본부장 계정은 조회만 가능합니다"

```typescript
const { isReadOnly } = useSession();

<Button
  color={isReadOnly ? "gray" : "orange"}
  disabled={isReadOnly}
>
  저장
</Button>
```

## 관련 파일

- `app/index.tsx`: 홈 허브 (identity_completed 기반 분기)
- `app/home-lite.tsx`: 제한된 홈 화면
- `app/identity.tsx`: 신원정보 입력
- `app/apply-gate.tsx`: 온보딩 시작 동의
- `hooks/use-session.tsx`: 세션 관리
- `hooks/use-identity-gate.ts`: 신원정보 게이트
