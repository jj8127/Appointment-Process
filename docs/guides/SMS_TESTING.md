# SMS 인증 테스트 가이드

> NCP SENS SMS 인증 시스템 테스트 및 디버깅 가이드

---

## 목차

- [사전 준비](#사전-준비)
- [Supabase 환경변수 설정](#supabase-환경변수-설정)
- [테스트 모드](#테스트-모드)
- [프로덕션 테스트](#프로덕션-테스트)
- [문제 해결](#문제-해결)

---

## 사전 준비

### 1. NCP SENS API 키 확보

NCP 콘솔에서 다음 정보를 확보하세요:

- **Access Key ID**: API 인증키 ID
- **Secret Key**: API 인증 비밀키
- **Service ID**: SMS 서비스 ID
- **발신번호**: 등록된 발신 전화번호

### 2. Edge Function 배포 확인

```bash
# Supabase 프로젝트에 Edge Function이 배포되었는지 확인
supabase functions list
```

필요한 함수:
- `request-signup-otp` - OTP 발송
- `verify-signup-otp` - OTP 인증
- `request-password-reset` - 비밀번호 재설정 OTP 발송

---

## Supabase 환경변수 설정

### Supabase Dashboard에서 설정

1. **Project Settings > Edge Functions** 메뉴로 이동
2. 다음 환경변수 추가:

```bash
# NCP SENS 필수 설정
NCP_SENS_ACCESS_KEY=<your-access-key>
NCP_SENS_SECRET_KEY=<your-secret-key>
NCP_SENS_SERVICE_ID=<your-service-id>
NCP_SENS_SMS_FROM=<your-phone-number>

# 선택: 테스트 모드 (개발환경)
TEST_SMS_MODE=true
TEST_SMS_CODE=123456

# 선택: CORS 설정
ALLOWED_ORIGINS=http://localhost:8081,https://yourdomain.com
```

### 환경변수 설명

| 변수 | 필수 | 설명 | 예시 |
|------|------|------|------|
| `NCP_SENS_ACCESS_KEY` | ✅ | NCP API Access Key | `1b084d361393...` |
| `NCP_SENS_SECRET_KEY` | ✅ | NCP API Secret Key | `3588e60216e2...` |
| `NCP_SENS_SERVICE_ID` | ✅ | SMS 서비스 ID | `a81fa4240263...` |
| `NCP_SENS_SMS_FROM` | ✅ | 등록된 발신번호 | `4130c2c2d85b...` |
| `TEST_SMS_MODE` | ❌ | 테스트 모드 활성화 | `true` / `false` |
| `TEST_SMS_CODE` | ❌ | 테스트용 고정 OTP | `123456` |

---

## 테스트 모드

### 테스트 모드란?

- 실제 SMS를 발송하지 않고 OTP 로직만 테스트
- 개발 중 비용 절감 및 빠른 테스트
- 서버 로그에 OTP 코드 출력

### 테스트 모드 활성화

Supabase 환경변수에 다음 추가:

```bash
TEST_SMS_MODE=true
TEST_SMS_CODE=123456
```

### Node.js 테스트 스크립트 실행

```bash
# 환경변수 설정 (.env 파일)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key

# 테스트 실행
node test-sms.js 01012345678
```

**출력 예시 (테스트 모드):**
```
📱 NCP SENS SMS 인증 테스트
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
전화번호: 01012345678
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1️⃣  OTP 요청 전송 중...

HTTP Status: 200
Response: {
  "ok": true,
  "sent": true,
  "test_mode": true
}

✅ SMS 전송 성공!
⚠️  테스트 모드로 실행됨 (실제 SMS 발송 안됨)
💡 프로덕션 환경에서는 TEST_SMS_MODE=false로 설정하세요.
```

**Supabase Edge Function 로그 확인:**
```
Logs > Functions > request-signup-otp

[TEST MODE] OTP code for 01012345678 : 123456
```

### 테스트 모드에서 OTP 인증

테스트 모드에서는 항상 `TEST_SMS_CODE`에 설정한 값으로 인증됩니다:

```bash
# 앱에서 OTP 입력 시
코드 입력: 123456  # TEST_SMS_CODE 값

# 또는 API로 직접 테스트
curl -X POST https://your-project.supabase.co/functions/v1/verify-signup-otp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -d '{
    "phone": "01012345678",
    "code": "123456"
  }'
```

---

## 프로덕션 테스트

### 1. 테스트 모드 비활성화

Supabase 환경변수에서 제거 또는 변경:

```bash
TEST_SMS_MODE=false
```

### 2. 실제 SMS 발송 테스트

```bash
# 본인 번호로 테스트
node test-sms.js 01012345678
```

**출력 예시 (프로덕션):**
```
📱 NCP SENS SMS 인증 테스트
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
전화번호: 01012345678
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1️⃣  OTP 요청 전송 중...

HTTP Status: 200
Response: {
  "ok": true,
  "sent": true
}

✅ SMS 전송 성공!
📲 SMS가 발송되었습니다. 휴대폰을 확인하세요.
```

### 3. 수신된 SMS 확인

휴대폰에서 다음 형식의 메시지 수신 확인:

```
[FC 위촉] 회원가입 인증 코드: 456789 (5분 유효)
```

### 4. OTP 인증 테스트

앱 또는 API로 수신한 코드 인증:

```bash
curl -X POST https://your-project.supabase.co/functions/v1/verify-signup-otp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -d '{
    "phone": "01012345678",
    "code": "456789"
  }'
```

---

## 문제 해결

### 1. SMS 전송 실패 (sms_send_failed)

**증상:**
```json
{
  "ok": false,
  "code": "sms_send_failed",
  "message": "SMS 전송에 실패했습니다."
}
```

**해결 방법:**

#### A. 환경변수 확인
```bash
# Supabase Dashboard에서 다음 확인:
NCP_SENS_ACCESS_KEY   ✓ 설정됨, 값 올바름
NCP_SENS_SECRET_KEY   ✓ 설정됨, 값 올바름
NCP_SENS_SERVICE_ID   ✓ 설정됨, 값 올바름
NCP_SENS_SMS_FROM     ✓ 설정됨, 값 올바름
```

#### B. NCP 콘솔 확인
1. NCP 콘솔 > Simple & Easy Notification Service
2. SMS 서비스 상태 확인 (활성화되어 있어야 함)
3. 발신번호 등록 상태 확인
4. API 인증키 상태 확인

#### C. Edge Function 로그 확인
```
Supabase Dashboard > Logs > Functions > request-signup-otp
```

로그에서 구체적인 에러 메시지 확인:
- `401 Unauthorized` → Access Key/Secret Key 오류
- `403 Forbidden` → 권한 또는 서비스 ID 오류
- `404 Not Found` → 서비스 ID 오류
- `400 Bad Request` → 발신번호 또는 페이로드 형식 오류

### 2. 쿨다운 에러 (cooldown)

**증상:**
```json
{
  "ok": false,
  "code": "cooldown",
  "message": "잠시 후 다시 시도해주세요."
}
```

**해결:**
- 60초 대기 후 재시도
- 또는 DB에서 직접 `phone_verification_sent_at` 초기화

```sql
UPDATE fc_profiles
SET phone_verification_sent_at = NULL
WHERE phone = '01012345678';
```

### 3. 계정 잠김 (locked)

**증상:**
```json
{
  "ok": false,
  "code": "locked",
  "message": "인증 시도가 너무 많아 잠시 후 다시 시도해주세요."
}
```

**해결:**
- `phone_verification_locked_until` 시간 경과 후 자동 해제
- 또는 DB에서 직접 잠금 해제

```sql
UPDATE fc_profiles
SET phone_verification_locked_until = NULL,
    phone_verification_attempts = 0
WHERE phone = '01012345678';
```

### 4. 환경변수 누락

**증상:**
```
Error: Missing required NCP SMS credentials
```

**해결:**
Supabase Dashboard에서 모든 필수 환경변수 설정 확인

### 5. CORS 에러

**증상:**
```
Access to fetch at '...' from origin '...' has been blocked by CORS policy
```

**해결:**
```bash
# Supabase 환경변수에 추가
ALLOWED_ORIGINS=http://localhost:8081,https://yourdomain.com
```

---

## 보안 권장사항

### ✅ DO (권장)

1. **프로덕션에서 TEST_SMS_MODE 비활성화**
   ```bash
   TEST_SMS_MODE=false  # 또는 환경변수 제거
   ```

2. **환경변수를 .gitignore에 추가**
   ```bash
   # .env 파일은 절대 커밋하지 않음
   .env
   .env.local
   ```

3. **최소 권한 원칙**
   - NCP IAM에서 SMS 서비스만 접근 가능한 별도 키 생성

4. **모니터링**
   - Supabase Logs에서 SMS 전송 실패 모니터링
   - NCP 콘솔에서 SMS 전송량 모니터링

### ❌ DON'T (금지)

1. **테스트 모드를 프로덕션에서 활성화하지 않음**
2. **환경변수를 코드에 하드코딩하지 않음**
3. **공개 레포지토리에 키를 업로드하지 않음**
4. **로그에 OTP 코드를 남기지 않음** (테스트 모드 제외)

---

## 비용 관리

### SMS 발송 비용 (NCP SENS)

- SMS (단문): 건당 약 9원
- LMS (장문): 건당 약 30원

### 비용 절감 팁

1. **테스트는 테스트 모드 사용**
   ```bash
   TEST_SMS_MODE=true
   ```

2. **쿨다운 설정으로 남용 방지**
   - 현재 설정: 60초 쿨다운
   - 5분 유효기간

3. **실패 시 재시도 제한**
   - 최대 5회 실패 시 계정 잠금

---

## 관련 문서

- [COMMANDS.md](./COMMANDS.md) - 개발 명령어 참조
- [DEPLOYMENT.md](../deployment/DEPLOYMENT.md) - 배포 가이드
- [NCP SENS API 문서](https://api.ncloud-docs.com/docs/ai-application-service-sens-smsv2)

---

**Last Updated**: 2026-01-12
**Maintainer**: Development Team
