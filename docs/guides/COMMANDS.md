# Command Reference Guide

> 프로젝트 운영 및 관리에 필요한 주요 명령어 모음

---

## Table of Contents

- [Development](#development)
  - [App Development](#app-development)
  - [Web Development](#web-development)
  - [Testing](#testing)
  - [Push Preflight (Governance)](#push-preflight-governance)
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
adb uninstall com.jj8127.Garam_in

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

#### Integrated Checklist Run (누락 방지)

**1. 실행 결과 파일 초기화**
```bash
npm run qa:init:integrated
```

**2. 케이스 수행 후 누락/형식 검증**
```bash
npm run qa:validate:integrated
```

> 상세 가이드는 `docs/testing/INTEGRATED_TEST_CHECKLIST.md`를 참고합니다.

### Push Preflight (Governance)

#### Mandatory check before every push
```bash
node scripts/ci/check-governance.mjs
```

#### If governance fails with schema/migration sync error
```text
Schema change policy violation: update supabase/schema.sql and supabase/migrations/*.sql together.
```

Action:
1. If `supabase/migrations/*.sql` changed, add a same-push `supabase/schema.sql` sync edit.
2. Re-run `node scripts/ci/check-governance.mjs`.
3. Push only after `[governance-check] passed`.

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
npm run eas:build:android
```

**iOS Build**
```bash
npm run eas:build:ios
```

> `npm run eas:build:*`는 Git 2.45+에서 발생할 수 있는 `core.hooksPath` shallow-clone(128) 충돌을 자동으로 정리합니다.

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

#### Assign Manager to Affiliation (알림 수신 매핑)
```sql
-- 한 소속에 여러 본부장을 붙일 수 있습니다.
INSERT INTO public.affiliation_manager_mappings (
    affiliation,
    manager_phone,
    active
)
VALUES
    ('1팀(서울1) : 서선미 본부장님', '01012341234', true),
    ('1팀(서울1) : 서선미 본부장님', '01099998888', true)
ON CONFLICT (affiliation, manager_phone)
DO UPDATE SET
    active = EXCLUDED.active,
    updated_at = now();
```

```sql
-- 비활성/해제
UPDATE public.affiliation_manager_mappings
SET active = false,
    updated_at = now()
WHERE affiliation = '1팀(서울1) : 서선미 본부장님'
  AND manager_phone = '01012341234';
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
adb uninstall com.jj8127.Garam_in
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
| Build Android | `npm run eas:build:android` |
| Build iOS | `npm run eas:build:ios` |
| Deploy to Vercel | `vercel deploy --prod` |
| Submit to App Store | `eas submit --platform ios --latest` |
| Clear App Data | `adb uninstall com.jj8127.Garam_in` |
| Generate Password Hash | `node -e "const crypto=require('crypto')..."` |

---

## Related Documentation

- [DEPLOYMENT.md](../deployment/DEPLOYMENT.md) - 상세 배포 가이드
- [README.md](../../README.md) - 프로젝트 개요
- [CLAUDE.md](../../CLAUDE.md) - AI 개발 가이드

---

**Last Updated**: 2026-01-12
**Maintainer**: Development Team
