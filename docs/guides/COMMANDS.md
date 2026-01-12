# Command Reference Guide

> 프로젝트 운영 및 관리에 필요한 주요 명령어 모음

---

## Table of Contents

- [Development](#development)
  - [App Development](#app-development)
  - [Web Development](#web-development)
  - [Testing](#testing)
- [Build & Deployment](#build--deployment)
  - [Building](#building)
  - [Deployment](#deployment)
- [Database Management](#database-management)
  - [Account Management](#account-management)
  - [Password Management](#password-management)
- [Troubleshooting](#troubleshooting)
- [Tools & Utilities](#tools--utilities)

---

## Development

### App Development

#### Run App on Android
```bash
npx expo run:android
```
앱을 Android 기기 또는 에뮬레이터에서 실행하고 설치합니다.

#### Run App on iOS (Expo Go)
```bash
npx expo start
```
실행 후 Expo Go 모드로 전환하여 QR 코드를 스캔합니다.

#### Clean Build with Custom Icon
```bash
# 1. 기존 앱 삭제
adb uninstall com.jj8127.fconboardingapp

# 2. Clean build 및 실행
npx expo prebuild --clean && npx expo run:android
```

#### Run with MCP Server
앱이 이미 설치되어 있어야 합니다.
```powershell
.\start-mcp.ps1
```

### Web Development

#### Start Web Development Server
```bash
cd web
npm run dev
```

### Testing

#### Web Bundle for Testsprite

**1. 웹 번들 생성**
```bash
npx expo export --platform web --output-dir dist-web
npx serve -l 8081 dist-web
```

**2. 이전 실행 락 삭제 (필요시)**
```bash
del testsprite_tests\tmp\execution.lock
```

---

## Build & Deployment

### Building

#### Build for Production

**중요: 빌드 전 버전 업데이트 필수!**

**Android Build**
```bash
eas build --platform android --profile production
```

**iOS Build**
```bash
eas build --platform ios --profile production
```

### Deployment

#### Deploy to Vercel

**1. 프로젝트 디렉토리로 이동**
```bash
cd web  # 배포하고자 하는 루트 디렉토리
```

**2. Vercel과 연동**
```bash
vercel link --project admin_web
```

**3. 웹 빌드 생성**
```bash
npx expo export -p web
```

**4. 프로덕션 배포**
```bash
vercel deploy --prod
```

#### Submit to App Store Connect

최근 빌드한 iOS 앱을 App Store Connect에 제출합니다.
```bash
eas submit --platform ios --latest
```

---

## Database Management

### Account Management

#### Create Manager (본부장) Account

**1. 로컬에서 비밀번호 해시/솔트 생성**
```bash
node -e "const crypto=require('crypto');const password='새비번';const salt=crypto.randomBytes(16);const hash=crypto.pbkdf2Sync(password,salt,100000,32,'sha256');console.log('phone=01012341234');console.log('password_salt(base64)=',salt.toString('base64'));console.log('password_hash(base64)=',hash.toString('base64'));"
```

**2. Supabase SQL Editor에서 계정 생성**
```sql
INSERT INTO public.manager_accounts (
    name,
    phone,
    password_hash,
    password_salt,
    password_set_at,
    active
)
VALUES (
    '홍길동 본부장',
    '01012341234',
    '<hash>',
    '<salt>',
    now(),
    true
);
```

**3. 필요시 잠금 해제/초기화**
```sql
UPDATE public.manager_accounts
SET failed_count = 0,
    locked_until = null
WHERE phone = '01012341234';
```

#### Query Manager Accounts
```sql
SELECT
    id,
    name,
    phone,
    active,
    failed_count,
    locked_until,
    password_set_at
FROM public.manager_accounts
ORDER BY created_at DESC;
```

#### Create FC Account

**1. 비밀번호 해시/솔트 생성**
```bash
node -e "const crypto=require('crypto');const password='qwer1234!';const salt=crypto.randomBytes(16);const hash=crypto.pbkdf2Sync(password,salt,100000,32,'sha256');console.log('PASSWORD_SALT:',salt.toString('base64'));console.log('PASSWORD_HASH:',hash.toString('base64'));"
```

**2. FC 프로필 및 자격증명 생성**
```sql
WITH new_fc AS (
    INSERT INTO public.fc_profiles (
        name,
        affiliation,
        phone,
        recommender,
        email
    ) VALUES (
        '홍길동',
        '1본부',
        '01012345678',
        '추천인명',
        'hong@example.com'
    )
    RETURNING id
)
INSERT INTO public.fc_credentials (
    fc_id,
    password_hash,
    password_salt,
    password_set_at
)
SELECT
    id,
    '<PASSWORD_HASH>',
    '<PASSWORD_SALT>',
    now()
FROM new_fc;
```

### Password Management

#### Reset Account Password
```sql
UPDATE public.manager_accounts
SET
    password_hash = '<새_해시>',
    password_salt = '<새_솔트>',
    password_set_at = now(),
    failed_count = 0,
    locked_until = null
WHERE phone = '<전화번호>';
```

---

## Troubleshooting

### Clear App Data
```bash
adb uninstall com.jj8127.fconboardingapp
```

### Unlock Locked Account
```sql
UPDATE public.manager_accounts
SET failed_count = 0,
    locked_until = null
WHERE phone = '<전화번호>';
```

---

## Tools & Utilities

### Codex MCP Tools

**1. Codex 접속**
```bash
codex
```

**2. 사용 가능한 도구 목록 보기**
```bash
list_mcp_tools
```

### Generate Password Hash

**단일 생성**
```bash
node -e "const crypto=require('crypto');const password='qwer1234!';const salt=crypto.randomBytes(16);const hash=crypto.pbkdf2Sync(password,salt,100000,32,'sha256');console.log('PASSWORD_SALT:',salt.toString('base64'));console.log('PASSWORD_HASH:',hash.toString('base64'));"
```

**매니저 계정용 (전화번호 포함)**
```bash
node -e "const crypto=require('crypto');const password='새비번';const salt=crypto.randomBytes(16);const hash=crypto.pbkdf2Sync(password,salt,100000,32,'sha256');console.log('phone=01012341234');console.log('password_salt(base64)=',salt.toString('base64'));console.log('password_hash(base64)=',hash.toString('base64'));"
```

---

## Security Notes

### Password Hashing
- **Algorithm**: PBKDF2 with SHA-256
- **Iterations**: 100,000
- **Salt Length**: 16 bytes (random)
- **Hash Length**: 32 bytes
- **Encoding**: Base64

### Account Lockout
- **Max Failed Attempts**: 5
- **Lockout Duration**: 10 minutes
- **Auto-unlock**: After lockout period expires

---

## Quick Reference

| Task | Command |
|------|---------|
| Run Android App | `npx expo run:android` |
| Run iOS (Expo Go) | `npx expo start` |
| Start Web Dev | `cd web && npm run dev` |
| Build Android | `eas build --platform android --profile production` |
| Build iOS | `eas build --platform ios --profile production` |
| Deploy to Vercel | `vercel deploy --prod` |
| Submit to App Store | `eas submit --platform ios --latest` |
| Clear App Data | `adb uninstall com.jj8127.fconboardingapp` |
| Generate Password Hash | `node -e "const crypto=require('crypto')..."` |

---

## Related Documentation

- [DEPLOYMENT.md](../deployment/DEPLOYMENT.md) - 상세 배포 가이드
- [README.md](../../README.md) - 프로젝트 개요
- [CLAUDE.md](../../CLAUDE.md) - AI 개발 가이드

---

**Last Updated**: 2026-01-12
**Maintainer**: Development Team
