# API Contracts

> 이 문서는 Edge Functions API의 "계약"입니다.
> API 변경 시 이 문서를 먼저 업데이트하세요.

---

## 1. 인증 API

### 1.1 request-signup-otp
회원가입 OTP 요청

**Request**
```typescript
{
  phone: string;  // 전화번호 (예: "01012345678")
}
```

**Response**
```typescript
{
  ok: boolean;
  message?: string;  // 에러 시 메시지
}
```

### 1.2 verify-signup-otp
OTP 검증

**Request**
```typescript
{
  phone: string;
  code: string;  // 6자리 코드
}
```

**Response**
```typescript
{
  ok: boolean;
  message?: string;
}
```

### 1.3 set-password
비밀번호 설정 (회원가입 완료)

**Request**
```typescript
{
  phone: string;
  password: string;
  name: string;
  affiliation: string;
  recommender?: string;
  email?: string;
}
```

**Response**
```typescript
{
  ok: boolean;
  message?: string;
}
```

### 1.4 login-with-password
로그인

**Request**
```typescript
{
  phone: string;
  password: string;
}
```

**Response**
```typescript
{
  ok: boolean;
  role: 'fc' | 'admin' | 'manager';
  displayName: string;
  token?: string;  // JWT
  message?: string;
}
```

### 1.5 request-password-reset
비밀번호 재설정 OTP 요청

**Request**
```typescript
{
  phone: string;
}
```

**Response**
```typescript
{
  ok: boolean;
  message?: string;
}
```

### 1.6 reset-password
비밀번호 재설정 완료

**Request**
```typescript
{
  phone: string;
  token: string;      // OTP 코드
  newPassword: string;
}
```

**Response**
```typescript
{
  ok: boolean;
  message?: string;
}
```

---

## 2. 신원 확인 API

### 2.1 store-identity
주민번호/주소 암호화 저장

**Request**
```typescript
{
  phone: string;
  residentNumber: string;  // 주민번호 (평문)
  address: string;
  addressDetail?: string;
}
```

**Response**
```typescript
{
  ok: boolean;
  message?: string;
}
```

**보안 노트**
- 주민번호는 서버에서 즉시 암호화
- 클라이언트에서 암호화 시도 금지
- 로그에 평문 출력 금지

---

## 3. 계정 관리 API

### 3.1 delete-account
FC 계정 삭제

**Request**
```typescript
{
  phone: string;
}
```

**Response**
```typescript
{
  ok: boolean;
  message?: string;
}
```

**동작**
- fc_profiles 삭제
- fc_identity_secure 삭제
- fc_credentials 삭제
- fc_documents 삭제
- Storage 파일 삭제

---

## 4. 공통 응답 형식

모든 Edge Function은 다음 형식을 따름:

```typescript
interface ApiResponse<T = any> {
  ok: boolean;           // 성공 여부
  data?: T;              // 성공 시 데이터
  message?: string;      // 에러/안내 메시지
  code?: string;         // 에러 코드 (옵션)
}
```

### 에러 코드
| 코드 | 설명 |
|------|------|
| INVALID_PHONE | 잘못된 전화번호 형식 |
| USER_NOT_FOUND | 사용자 없음 |
| INVALID_PASSWORD | 비밀번호 틀림 |
| OTP_EXPIRED | OTP 만료 |
| OTP_INVALID | OTP 틀림 |
| DUPLICATE_USER | 이미 가입된 사용자 |
| DUPLICATE_RESIDENT_ID | 중복된 주민번호 |

---

## 5. 클라이언트 호출 패턴

```typescript
// 표준 호출 패턴
const { data, error } = await supabase.functions.invoke('function-name', {
  body: { ... },
});

if (error) {
  // 네트워크 오류 등
  throw error;
}

if (!data?.ok) {
  // 비즈니스 로직 실패
  Alert.alert('알림', data?.message ?? '요청에 실패했습니다.');
  return;
}

// 성공 처리
```

---

## 6. 변경 이력

| 날짜 | 변경 내용 | 작성자 |
|------|----------|--------|
| 2025-01-10 | 초기 문서 작성 | AI |
