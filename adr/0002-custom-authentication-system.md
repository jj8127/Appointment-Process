# ADR 0002: Custom Authentication System

## Status
Accepted

## Context
FC(보험 설계사) 온보딩 앱은 전화번호 기반 인증이 필수:
- 사용자는 전화번호로 로그인
- SMS OTP 인증 필요
- Supabase Auth의 기본 이메일/소셜 로그인은 적합하지 않음

Supabase Auth를 전화번호용으로 커스터마이징하는 것보다 직접 구현이 더 간단하다고 판단.

## Decision
Supabase Auth를 사용하지 않고, 커스텀 인증 시스템 구현:

### 1. 데이터 구조
```
fc_credentials: 비밀번호 해시/솔트 저장
admin_accounts: 관리자 비밀번호 저장
manager_accounts: 매니저 비밀번호 저장
```

### 2. 인증 플로우
```
[회원가입]
request-signup-otp → verify-signup-otp → set-password

[로그인]
login-with-password → JWT 발급

[비밀번호 재설정]
request-password-reset → reset-password
```

### 3. 보안 구현
- 비밀번호: PBKDF2 (100,000 iterations, SHA-256)
- OTP: 6자리, 5분 유효
- JWT: Edge Function에서 생성

### 4. 세션 관리
- 클라이언트: safe-storage에 세션 정보 저장
- 서버: JWT 검증 (필요 시)

## Consequences

### Pros
- 전화번호 중심 UX에 최적화
- 인증 로직 완전 제어 가능
- Supabase Auth 제약 없음
- SMS OTP 통합 간단

### Cons
- 보안 구현 책임이 우리에게 있음
- 소셜 로그인 추가 시 직접 구현 필요
- 세션 관리 직접 구현 필요

## Alternatives Considered

### 1. Supabase Auth Phone Login
- Supabase Auth의 전화번호 인증 사용
- **기각 이유**: Twilio 연동 필수, 비용 증가, 커스터마이징 제한

### 2. Firebase Auth
- Firebase의 전화번호 인증 사용
- **기각 이유**: Supabase DB와 별도 시스템 운영 복잡, 데이터 분산

### 3. Auth0
- 외부 인증 서비스 사용
- **기각 이유**: 비용, 복잡성, 한국 SMS 지원 불확실

---

## 관련 파일
- `supabase/functions/login-with-password/`
- `supabase/functions/request-signup-otp/`
- `supabase/functions/verify-signup-otp/`
- `supabase/functions/set-password/`
- `hooks/use-session.tsx`
