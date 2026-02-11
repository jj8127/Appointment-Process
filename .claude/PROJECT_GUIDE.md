# 프로젝트 가이드 (All-in-One)

> 이 문서는 `fc-onboarding-app`의 실무 기준 문서입니다.  
> 새 세션 AI Agent는 작업 전에 이 파일과 `WORK_LOG.md`를 먼저 확인하세요.

---

## 📋 목차

0. [문서 SSOT](#0-문서-ssot)
1. [프로젝트 개요](#1-프로젝트-개요)
2. [핵심 비즈니스/보안 규칙](#2-핵심-비즈니스보안-규칙)
3. [기술 스택 & 아키텍처](#3-기술-스택--아키텍처)
4. [코딩/구현 패턴](#4-코딩구현-패턴)
5. [AI Agent 워크플로우](#5-ai-agent-워크플로우)
6. [프롬프트 템플릿](#6-프롬프트-템플릿)
7. [Quick Reference](#7-quick-reference)

---

## 0. 문서 SSOT

### 파일 역할 분리 (Single Source of Truth)
- `PROJECT_GUIDE.md`: 정책/규칙/표준 절차의 단일 기준
- `WORK_LOG.md`: 최근 작업 요약 인덱스(상세 앵커 링크만 유지)
- `WORK_DETAIL.md`: 구현 배경/변경 파일/검증 결과의 상세 이력

### 중복 최소화 원칙
- 동일 규칙은 `PROJECT_GUIDE.md`에만 정의하고, 다른 문서는 링크로 참조
- `WORK_LOG.md`에는 설명 문장을 늘리지 않고, 작업명 + 핵심 파일 + 상세 링크만 기록
- 세부 구현 설명은 `WORK_DETAIL.md`로만 누적

### 자동 검증/강제
- CI(`.github/workflows/governance-check.yml`)에서 문서/스키마 규칙을 자동 검증
- PR 템플릿(`.github/pull_request_template.md`) 체크리스트를 충족하지 않으면 CI 실패

---

## 1. 프로젝트 개요

### 🎯 목적
보험 FC(설계사) 온보딩/위촉 과정을 모바일 앱과 웹 관리자 페이지에서 통합 관리합니다.

### 👥 사용자 역할
- `fc`: 회원가입, 신원확인, 수당동의, 시험 신청, 서류 업로드, 위촉 진행
- `admin`: FC 상태 관리/승인/알림 발송/공지/시험 관리
- `manager`: 웹에서 조회 중심(읽기 전용) 운영

### 🔄 핵심 플로우
1. 회원가입 (OTP + 비밀번호 설정)
2. 신원확인/기본정보 등록
3. 임시사번 발급
4. 수당 동의 및 승인
5. 시험 일정 확인/신청
6. 서류 요청/제출/승인
7. 위촉 일정/완료 처리
8. 최종 완료

### 📌 FC 상태값 (source: `types/fc.ts`)
```ts
'draft'
| 'temp-id-issued'
| 'allowance-pending'
| 'allowance-consented'
| 'docs-requested'
| 'docs-pending'
| 'docs-submitted'
| 'docs-rejected'
| 'docs-approved'
| 'appointment-completed'
| 'final-link-sent'
```

---

## 2. 핵심 비즈니스/보안 규칙

### 🚨 반드시 지킬 규칙

1. **모바일 인증 구조**
   - 모바일은 Supabase Auth 세션이 아닌 커스텀 인증(전화번호+비밀번호, Edge Function) 중심입니다.
   - `use-session` 상태(`role`, `residentId`)를 권한 판단 기준으로 사용합니다.

2. **RLS 환경에서의 쓰기 작업**
   - RLS로 인해 익명(anon) 클라이언트 직접 `update/delete`가 차단될 수 있습니다.
   - 관리자 쓰기 작업은 `admin-action` 같은 service-role Edge Function 경유를 기본 원칙으로 합니다.

3. **민감정보 처리**
   - 주민번호 평문 저장 금지.
   - 암호화 저장은 `fc_identity_secure` 및 관련 Edge Function(`store-identity`) 경유.

4. **권한 모델 유지**
   - `admin`: 수정/승인/삭제 가능
   - `manager`: 읽기 전용 UI/동작 유지
   - `fc`: 자기 데이터 중심 접근

5. **스키마 변경 절차**
   - `supabase/schema.sql` + `supabase/migrations/*.sql` 같이 관리
   - 스키마만 수정하고 마이그레이션 누락 금지

6. **기존 API 계약 유지**
   - Edge Function은 기존 `ok` 기반 응답 계약 유지
   - 기존 클라이언트 파싱 형식(`data?.ok`, `data?.message`) 깨지지 않게 유지

---

## 3. 기술 스택 & 아키텍처

### 스택
```txt
Mobile App: Expo + React Native + Expo Router + TanStack Query
Admin Web : Next.js(App Router) + Mantine + TanStack Query
Backend   : Supabase(Postgres + Storage + Edge Functions)
```

### 모노레포 구조 (핵심)
```txt
fc-onboarding-app/
├── app/                    # 모바일(Expo Router) 화면
├── components/             # 재사용 컴포넌트
├── hooks/                  # 세션/키보드/게이트 훅
├── lib/                    # supabase, logger, theme 등
├── types/                  # 공용 타입
├── supabase/
│   ├── schema.sql
│   ├── migrations/
│   └── functions/          # Edge Functions
├── web/src/app/            # 관리자 웹(Next.js)
├── contracts/              # API/DB/컴포넌트 계약 문서
└── adr/                    # 아키텍처 의사결정 기록
```

### 핵심 엔트리
- 모바일 라우팅: `app/_layout.tsx`
- 모바일 홈: `app/index.tsx`
- 관리자 웹 대시보드: `web/src/app/dashboard/page.tsx`
- DB 스키마: `supabase/schema.sql`
- Edge Functions: `supabase/functions/*`

---

## 4. 코딩/구현 패턴

### 4.1 TypeScript 엄격 모드 유지
- `any` 최소화(불가피할 때만 범위 제한)
- 에러 처리: `unknown` → `instanceof Error`로 메시지 추출

```ts
try {
  // ...
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : '오류가 발생했습니다.';
}
```

### 4.2 React Query 패턴
- 조회는 `useQuery`, 변경은 `useMutation`
- 변경 성공 후 관련 query key invalidate/refetch

### 4.3 모바일 UI 패턴
- 디자인 토큰 우선: `lib/theme.ts`
- 직접 하드코딩보다 공용 컴포넌트(`Button`, `FormInput`, `LoadingSkeleton`) 재사용
- 키보드 이슈는 `KeyboardAwareWrapper`/관련 훅 패턴 우선 적용

### 4.4 알림/공지 패턴
- 알림센터 데이터 소스: `fc-notify` (`notifications + notices`)
- 클릭 이동성 보장을 위해 알림 저장 시 `target_url` 같은 명시적 이동정보 유지 권장

### 4.5 금지/주의
- RLS 정책을 무시한 클라이언트 직접 관리자 쓰기 로직 추가 금지
- 스키마 컬럼 추가 후 함수/클라이언트/마이그레이션 불일치 방치 금지
- 읽기 전용(manager) 계정에서 쓰기 동작 가능하도록 만드는 변경 금지

---

## 5. AI Agent 워크플로우

### 5.1 작업 시작 체크리스트
- [ ] `PROJECT_GUIDE.md` 확인
- [ ] `WORK_LOG.md` 확인 (요약 인덱스)
- [ ] 필요 앵커만 `WORK_DETAIL.md` 부분 확인
- [ ] 최근 Git 확인 (`git log --oneline -10`)
- [ ] 기존 유사 코드 검색 후 패턴 확인

### 5.2 문서화 시스템 (정책 + 로그 2계층)
```txt
PROJECT_GUIDE.md : 규칙/정책 기준
WORK_LOG.md      : 요약 인덱스 (200줄 이하 유지)
WORK_DETAIL.md   : 상세 누적 이력 (앵커 기반)
```

#### 앵커 규칙
- 형식: `YYYYMMDD-N` (예: `20260211-1`)
- `WORK_LOG.md`의 각 항목은 `WORK_DETAIL.md` 앵커 링크 필수

### 5.3 작업 완료 시 업데이트 순서
1. `WORK_DETAIL.md` 상단에 상세 항목 추가
2. `WORK_LOG.md` 최근 작업 테이블에 요약 1행 추가
3. 테이블 30행 초과 시 오래된 행 제거
4. 프로젝트 현황/주의사항 변경 시 상단 섹션 갱신
5. 스키마 변경 시 `supabase/schema.sql` + `supabase/migrations/*.sql` 동시 반영

### 5.4 자동 검증 (CI)
- PR/Push에서 아래 항목을 자동 검사합니다.
- 필수 문서 파일 존재 여부 (`PROJECT_GUIDE.md`, `WORK_LOG.md`, `WORK_DETAIL.md`)
- `WORK_LOG.md` 상세 링크 앵커가 `WORK_DETAIL.md`에 실제 존재하는지
- 코드 변경 시 `WORK_LOG.md` + `WORK_DETAIL.md` 동시 갱신 여부
- 스키마 변경 시 `schema.sql`과 `migrations` 동시 변경 여부

---

## 6. 프롬프트 템플릿

### 기본
```txt
.claude/PROJECT_GUIDE.md와 .claude/WORK_LOG.md를 읽고
[작업 설명]을 기존 패턴으로 구현해줘.
필요 시 WORK_DETAIL의 관련 앵커도 참고해.
```

### 버그 수정
```txt
PROJECT_GUIDE/WORK_LOG 확인 후,
[현상]의 근본 원인을 코드 기준으로 찾고 수정해줘.
수정 범위 파일/검증 결과/리스크를 함께 정리해줘.
```

### 리팩터링
```txt
기존 구조 유지 원칙으로 [대상 파일]을 정리해줘.
동작 변화 없이 타입 안정성과 가독성 개선 위주로 진행해.
```

---

## 7. Quick Reference

### 자주 쓰는 명령
```bash
# Mobile
npm start
npx expo run:android
npx expo run:ios
npm run lint

# Web
cd web
npm run dev
npm run build
npm run lint
```

### Supabase
```bash
supabase login
supabase projects list
supabase link --project-ref <project-ref>
supabase functions deploy <function-name> --project-ref <project-ref>
supabase secrets list --project-ref <project-ref>
```

### 주요 문서
- 계약: `contracts/database-schema.md`, `contracts/api-contracts.md`, `contracts/component-contracts.md`
- 아키텍처 결정: `adr/README.md`
- 명령 모음: `docs/guides/COMMANDS.md`
- 핸드오버: `HANDOVER.md`
