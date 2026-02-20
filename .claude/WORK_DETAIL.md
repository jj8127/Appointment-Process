# 작업 상세 로그 (Work Detail)

> **상세 이력 누적 파일**입니다.  
> 최근 1개월 Git 이력(`2026-01-12` ~ `2026-02-11`, 총 44 commits)을 기준으로 재구성했습니다.
>
> 요약 인덱스는 [WORK_LOG.md](WORK_LOG.md)를 확인하세요.

---

## <a id="20260220-1"></a> 2026-02-20 | 모바일 시험 신청(생명/손해) 마감 필터 기준 통일 및 당겨서 새로고침 제스처 복구

**Commit**: `0c25c96`  
**작업 내용**:
- `app/exam-apply.tsx`, `app/exam-apply2.tsx`의 시험 일정 조회 기준을 동일화:
  - `registration_deadline`이 최근 7일 이내인 일정만 조회되도록 통일
  - cutoff 비교 포맷을 `YYYY-MM-DD`로 정렬해 화면 간 날짜 비교 일관성 확보
- 두 화면 모두 새로고침 UX를 동일화:
  - 당겨서 새로고침/헤더 새로고침 버튼이 모두 `round list + my applications + profile allowance state`를 함께 갱신하도록 변경
- 새로고침 제스처 미동작 원인(중첩 스크롤 구조) 제거:
  - `KeyboardAwareWrapper` 내부의 중첩 `ScrollView`를 제거하고, `RefreshControl`을 wrapper에 직접 연결해 단일 스크롤 소유 구조로 수정
- 관련 진행 이력을 `AGENTS.md` Progress Ledger에 추가

**핵심 파일**:
- `app/exam-apply.tsx`
- `app/exam-apply2.tsx`
- `AGENTS.md`
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`

**검증**:
- `npm run lint -- app/exam-apply.tsx app/exam-apply2.tsx` 통과
- 실제 기기 확인 기준: 생명/손해 시험 신청 화면에서 pull-to-refresh 제스처 정상 동작 및 상단 새로고침 버튼과 동일한 데이터 갱신 경로 사용

---

## <a id="20260219-8"></a> 2026-02-19 | 웹 대시보드 서류 배지의 "검토 중" 카운트를 제출 문서 기준으로 보정

**작업 내용**:
- 관리자 웹 대시보드 FC 카드의 서류 요약 배지에서 `검토 중` 카운트 조건을 조정
- 기존에는 `approved/rejected`가 아닌 모든 문서를 카운트해 미제출 문서도 포함되던 문제를 수정
- 이제 `storage_path`가 존재하고 `deleted`가 아닌 제출 문서 중, `approved/rejected`가 아닌 문서만 `검토 중`에 집계

**핵심 파일**:
- `web/src/app/dashboard/page.tsx`

**검증**:
- `cd web && npm run lint` 통과

---

## <a id="20260219-7"></a> 2026-02-19 | 웹 FC 상세 페이지에서 프로필/관리자 메모 수정 경로를 서버 API로 전환하고 관리자만 수정 가능하도록 권한 제어 보강

**작업 내용**:
- FC 상세 페이지(`web/src/app/dashboard/profile/[id]/page.tsx`)의 프로필 저장/메모 저장 로직에서 클라이언트 직접 `supabase.from('fc_profiles').update(...)` 호출을 제거
- `/api/admin/fc`의 `updateProfile` 액션을 사용하도록 변경해 관리자 쓰기 경로를 서버 중계 경로로 통일
- `useSession` 기반 권한 상태(`role`, `isReadOnly`)를 반영해 관리자(admin)만 수정 가능하도록 버튼/입력 상태를 제어하고, manager 계정에서는 읽기 전용 동작을 명시적으로 유지
- 저장 후 `fc-profile` 쿼리 invalidate를 통해 화면 반영을 안정화

**핵심 파일**:
- `web/src/app/dashboard/profile/[id]/page.tsx`
- `AGENTS.md`

**검증**:
- `cd web && npm run lint` 통과

---

## <a id="20260219-6"></a> 2026-02-19 | 주민번호 표기 경로 전반에서 마스킹 fallback 제거 및 관리자 화면 전체번호 조회 확장

**작업 내용**:
- 주민번호 전체 조회 액션(`admin-action:getResidentNumbers`)의 내부 전용 제약을 해제해 관리자 모바일 화면에서도 동일 액션을 사용 가능하도록 조정
- 웹 신청자/프로필 화면의 주민번호 표시 fallback에서 `resident_id_masked` 사용을 제거하고, 원문 조회 실패 시 `-`로 처리하도록 정리
- 모바일 관리자 시험 신청자 화면(`exam-manage`, `exam-manage2`)에 주민번호 원문 조회(`getResidentNumbers`)를 연결
- FC 기본정보 화면(`fc/new`)의 기존 마스킹 문자열 노출을 제거하고, 관리자 세션에서는 원문 조회 시 원문 표시하도록 보강

**핵심 파일**:
- `supabase/functions/admin-action/index.ts`
- `web/src/app/dashboard/exam/applicants/page.tsx`
- `web/src/app/dashboard/profile/[id]/page.tsx`
- `app/exam-manage.tsx`
- `app/exam-manage2.tsx`
- `app/fc/new.tsx`

**검증**:
- `npm run lint` (mobile) 통과
- `cd web && npm run lint` 통과

---

## <a id="20260219-5"></a> 2026-02-19 | WORK_LOG 최근 작업 행수 제한 제거(정책/CI 동기화)

**작업 내용**:
- 문서 정책에서 `WORK_LOG` 최근 작업 테이블의 행수 상한(30행) 규칙을 제거
- CI 거버넌스 검사(`check-governance.mjs`)에서 최근 작업 행수 초과 실패 검사를 제거
- 연동 문서 표현을 상한 기준에서 "최신 항목 상단 정렬 유지" 기준으로 정리

**핵심 파일**:
- `AGENTS.md`
- `.claude/PROJECT_GUIDE.md`
- `.claude/WORK_LOG.md`
- `scripts/ci/check-governance.mjs`

**검증**:
- `node scripts/ci/check-governance.mjs` 통과
- `WORK_LOG` ↔ `WORK_DETAIL` 앵커 링크 규칙 유지 확인

---

## <a id="20260219-4"></a> 2026-02-19 | 관리자 웹 서류 탭에서 미제출 항목 노출 필터 보정

**작업 내용**:
- 관리자 웹 대시보드의 FC 상세 > 서류 탭에서 `제출된 서류` 집계/목록 필터가
  `storage_path !== 'deleted'`만 검사하던 조건을 수정
- `storage_path`가 실제로 존재하는(업로드된) 항목만 `제출된 서류`에 노출되도록 보정
- 결과적으로 미제출 항목(빈 `storage_path`)은 `제출된 서류` 영역에서 제외됨

**핵심 파일**:
- `web/src/app/dashboard/page.tsx`

**검증**:
- `cd web && npm run lint` 통과
- 제출된 서류 count/list 조건이 동일 필터(`storage_path && storage_path !== 'deleted'`)로 정렬된 것 확인

---

## <a id="20260219-3"></a> 2026-02-19 | 웹 FC 상세에서 관리자 주민번호 원문 조회 표시 연동

**작업 내용**:
- 웹 FC 상세 페이지에서 `resident_id_masked`만 표시하던 로직을 보완해, 관리자 권한일 때 서버 API(`/api/admin/resident-numbers`)를 통해 주민번호 원문을 조회하도록 변경
- 주민번호 원문 조회 실패 또는 관리자 권한이 아닌 경우에는 기존 마스킹값으로 자동 fallback하도록 유지
- 생년월일 표시도 동일한 표시값(원문 우선, 실패 시 마스킹) 기준으로 계산되도록 정렬

**핵심 파일**:
- `web/src/app/dashboard/profile/[id]/page.tsx`

**검증**:
- `cd web && npm run lint` 통과
- 관리자 전용 주민번호 조회 경로를 기존 서버-중계 API 기반으로 사용해 보안 경로 유지 확인

---

## <a id="20260219-2"></a> 2026-02-19 | 수당동의 임시사번 선검증 및 계정 중복 차단 강화

**작업 내용**:
- 수당 동의 입력 시 임시사번(`temp_id`)이 없는 FC를 서버/클라이언트에서 선차단하도록 보강:
  - `fc-consent`에서 `temp_id`를 조회하고 미발급 시 실패 응답 반환
  - 모바일 `app/consent.tsx` 제출 전 임시사번 존재 여부를 확인하고 안내 알림 후 중단
- 비밀번호 설정 시 전화번호 중복 계정 차단 강화:
  - `set-password`에서 `admin_accounts`, `manager_accounts` 중복을 선검사해 FC 계정 생성 차단
- 웹 프로필 페이지 effect 의존성 경고를 정리해 폼 초기화 동작을 안정화
- Supabase Edge Functions용 Deno import map 파일(`supabase/functions/deno.json`) 추가 및 IDE Deno 설정 반영

**핵심 파일**:
- `app/consent.tsx`
- `supabase/functions/fc-consent/index.ts`
- `supabase/functions/set-password/index.ts`
- `web/src/app/dashboard/profile/[id]/page.tsx`
- `supabase/functions/deno.json`
- `.vscode/settings.json`
- `.claude/settings.json`

**검증**:
- 변경 파일 diff 검토로 수당 동의 선검증/중복 차단 로직 반영 확인
- 문서 거버넌스 규칙(`WORK_LOG` + `WORK_DETAIL` 동시 갱신) 충족 확인

---

## <a id="20260219-1"></a> 2026-02-19 | 회원가입 사전 중복검증/홈 플로우 안정화 및 AGENTS 거버넌스 문서 추가

**Commit**: `46d7a59`  
**작업 내용**:
- 회원가입 시작 단계에서 OTP 발송 전 번호 중복 여부를 사전 확인하도록 보강:
  - `request-signup-otp`에 `checkOnly` 모드 추가
  - FC/총무/본부장 전화번호 중복을 서버에서 일괄 판정
  - 이미 가입된 번호는 `ok: false`와 안내 메시지로 반환
- 앱 가입 화면에서 `checkOnly` 호출을 사용해 중복 번호를 조기 차단하고, 확인 중 버튼 비활성화 처리 추가
- 신원정보 저장 이후 홈 진입 단계 계산이 즉시 갱신되도록 `my-fc-status` 쿼리 invalidate/refetch 추가
- Android 홈 화면 뒤로가기 시 앱 종료 확인 다이얼로그 추가 (`app/index.tsx`, `app/home-lite.tsx`)
- 루트/하위 `AGENTS.md` 문서군 및 `AGENT.md`를 추가해 모듈별 컨텍스트 라우팅 문서 체계 정리

**핵심 파일**:
- `app/signup.tsx`
- `supabase/functions/request-signup-otp/index.ts`
- `app/identity.tsx`
- `app/index.tsx`
- `app/home-lite.tsx`
- `app/_layout.tsx`
- `AGENT.md`
- `AGENTS.md`
- `app/AGENTS.md`
- `components/AGENTS.md`
- `hooks/AGENTS.md`
- `web/AGENTS.md`
- `supabase/AGENTS.md`
- `supabase/functions/AGENTS.md`

**검증**:
- 커밋 기준 코드/문서 diff 검토
- 거버넌스 조건(코드 변경 시 `WORK_LOG` + `WORK_DETAIL` 동시 갱신) 충족 확인

---

## <a id="20260211-15"></a> 2026-02-11 | Android 릴리즈 난독화/리소스 축소 설정 반영

**작업 내용**:
- `expo-build-properties`의 Android 릴리즈 옵션에 아래 값을 추가:
  - `enableMinifyInReleaseBuilds: true`
  - `enableShrinkResourcesInReleaseBuilds: true`
- 목적:
  - 릴리즈 AAB에서 R8 난독화/코드 최적화 활성화
  - 리소스 축소로 앱 크기 감소
  - Play Console의 deobfuscation 관련 경고 원인(난독화 미설정 상태) 해소 기반 마련

**핵심 파일**:
- `app.json`

**검증**:
- `npx expo config --type public --json` 성공

---

## <a id="20260211-16"></a> 2026-02-11 | iOS 빌드 번들ID 등록 실패(Apple Maintenance) 대응

**작업 내용**:
- `eas build` 실패 로그의 HTML 본문(`Maintenance - Apple Developer`) 기준으로 Apple Developer 포털 점검 응답을 원인으로 확인
- Git/EAS 로컬 환경 점검:
  - `eas --version`을 `16.32.0`으로 업데이트
  - `eas whoami`로 계정 인증 상태 확인(`jj8127`)
- 운영 문서 보강:
  - Apple 점검 시 우회 빌드 커맨드(`--non-interactive --freeze-credentials`)와 재설정 순서를 명령어 문서에 추가

**핵심 파일**:
- `docs/guides/명령어 모음집.txt`

**검증**:
- `Invoke-WebRequest https://developer.apple.com/maintenance/` 결과에서 maintenance 문구 확인
- `eas --version` 결과 `16.32.0` 확인

---

## <a id="20260211-14"></a> 2026-02-11 | 정책/보안 정리(B): 로컬 산출물/설정 추적 해제

**작업 내용**:
- 정책 불일치 정리:
  - 추적 중이던 `testsprite_tests/` 산출물 삭제(이미 `.gitignore` 대상)
  - 고아 gitlink 상태의 `Claude-Code-Usage-Monitor` 제거
- 보안/로컬 설정 정리:
  - 민감값이 포함될 수 있는 `.codex/config.toml`, `.codex/mcp.json` 추적 제거
  - `.gitignore`에 `.codex/`, `Claude-Code-Usage-Monitor/` 추가

**핵심 파일**:
- `.gitignore`
- `.codex/config.toml` (삭제)
- `.codex/mcp.json` (삭제)
- `testsprite_tests/*` (삭제)
- `Claude-Code-Usage-Monitor` (gitlink 삭제)

---

## <a id="20260211-13"></a> 2026-02-11 | 안전 묶음(A): 빌드 산출물/미사용 모듈 정리

**작업 내용**:
- 빌드 산출물 정리:
  - `dist-web-new2/` 전체 삭제
  - 재추적 방지를 위해 `.gitignore`에 `dist-web/`, `dist-web-new2/` 추가
- 미사용 코드/자산 정리:
  - 미사용 라우트/모듈 삭제:
    - `app/admin-register.tsx`
    - `components/LoginForm.tsx`, `components/ImageTourGuide.tsx`
    - `components/BoardCard.tsx`, `components/EmptyState.tsx`
    - `components/external-link.tsx`, `components/haptic-tab.tsx`, `components/hello-wave.tsx`
    - `components/ui/icon-symbol.tsx`, `components/ui/icon-symbol.ios.tsx`
    - `hooks/use-dashboard-data.ts`, `hooks/use-theme-color.ts`
    - `constants/theme.ts`, `lib/docRules.ts`
  - 미사용 자산 삭제:
    - `assets/guide/shortcuts-guide.jpg`
    - `assets/guide/shortcuts-guide.png`
    - `agreement_imag/00.jpg`

**검증**:
- `npm run lint` (mobile) 통과
- `npx tsc --noEmit` (mobile) 통과
- `npm test -- --runInBand` 통과
- `npm run lint` (web) 통과
- `npm run build` (web) 통과

---

## <a id="20260211-12"></a> 2026-02-11 | 앱/웹 미점검 영역 종합 점검 및 안정화 패치

**작업 내용**:
- 모바일/웹 전체 정적 검사 및 테스트 실행:
  - 모바일 `expo lint`, `tsc --noEmit`, `jest --runInBand`
  - 웹 `eslint`, `next build`, `tsc --noEmit`
- 실결함 보정:
  - `app/_layout.tsx`에서 누락된 `safeStorage` import 추가(런타임 참조 안정화)
  - `useIdentityGate`의 잘못된 경로(`'/auth'`)를 실제 로그인 경로(`'/login'`)로 수정
  - Jest가 `web/.next`를 스캔해 실패하던 문제를 ignore 패턴으로 차단
  - 홈 가이드 시작 안정화: 메인/바로가기 가이드 상호 정지 후 `start(1)` 명시 시작 + 재시도 타이밍 보강
- 품질 경고 정리(동작 변경 없는 리팩터링):
  - 미사용 변수/임포트 제거
  - Hook dependency 누락 경고 정리
  - 웹 채팅 메시지 로딩 effect 의존성 정합성 보강
  - 웹 공지 상세 이미지 렌더링 경고(`no-img-element`) 해소

**핵심 파일**:
- `app/_layout.tsx`
- `hooks/use-identity-gate.ts`
- `jest.config.js`
- `app/consent.tsx`
- `app/index.tsx`
- `app/exam-apply.tsx`
- `app/exam-apply2.tsx`
- `app/fc/new.tsx`
- `components/BoardCard.tsx`
- `components/EmptyState.tsx`
- `components/LoadingSkeleton.tsx`
- `components/Toast.tsx`
- `web/src/app/dashboard/chat/page.tsx`
- `web/src/app/dashboard/notifications/[id]/page.tsx`

**검증**:
- `npm run lint` (mobile) 통과
- `npx tsc --noEmit` (mobile) 통과
- `npm test -- --runInBand` 통과 (2 suites, 53 tests)
- `npm run lint` (web) 통과
- `npm run build` (web) 통과
- `npx tsc --noEmit` (web) 통과

---

## <a id="20260211-11"></a> 2026-02-11 | 문서 거버넌스 CI/PR 강제 및 SSOT 정리

**작업 내용**:
- `.github/workflows/governance-check.yml` 추가로 문서/스키마 규칙 자동 검사 도입
- PR 본문 체크리스트 미충족 시 실패하도록 `scripts/ci/check-pr-template.mjs` 추가
- 코드 변경 시 `WORK_LOG` + `WORK_DETAIL` 동시 갱신 여부를 검사하는 `scripts/ci/check-governance.mjs` 추가
- `PROJECT_GUIDE.md`에 문서 SSOT 역할 분리와 자동 검증 규칙 명시

**핵심 파일**:
- `.github/workflows/governance-check.yml`
- `.github/pull_request_template.md`
- `scripts/ci/check-governance.mjs`
- `scripts/ci/check-pr-template.mjs`
- `.claude/PROJECT_GUIDE.md`

---

## <a id="20260211-10"></a> 2026-02-11 | 시험 접수 마감 기준을 당일 23:59:59로 변경

**작업 내용**:
- FC 시험 신청 화면(생명/손해)에서 마감 판정 기준을 `마감일 18:00`에서 `마감일 23:59:59`로 수정
- 웹 시험 일정 화면의 `(마감)` 표시 판정도 동일 기준(`endOf('day')`)으로 통일
- 결과적으로 `마감일=19일` 설정 시 `20일 00:00`부터 마감 처리되도록 보정

**핵심 파일**:
- `app/exam-apply.tsx`
- `app/exam-apply2.tsx`
- `web/src/app/dashboard/exam/schedule/page.tsx`

---

## <a id="20260211-9"></a> 2026-02-11 | 서류 마감일(18:00 기준) 알림 로직 정합성 보정

**작업 내용**:
- `docs-deadline-reminder` 조회 범위를 `D-1 ~ D+3`로 조정하여 사전 리마인드가 가능하도록 보정
- 마감 문구를 분기형(D-3/D-1/D-day/마감 경과)으로 교체
- 마감 기준 시각을 `마감일 18:00(KST)`로 반영 (`DEADLINE_HOUR_KST = 18`)
- `notifications` insert 시 `target_url` 컬럼 불일치(42703) fallback 처리 추가
- 서류 요청 업데이트 시 `fc_profiles` 업데이트 에러 누락 구간 보강

**핵심 파일**:
- `supabase/functions/docs-deadline-reminder/index.ts`
- `supabase/functions/admin-action/index.ts`
- `web/src/app/api/admin/fc/route.ts`

---

## <a id="20260211-8"></a> 2026-02-11 | 임시번호 발급 알림 탭 시 수당 동의 페이지 이동 보정

**작업 내용**:
- 알림센터 라우팅 fallback에서 `임시번호/임시사번` 키워드 분기를 추가
- `target_url`이 없거나 기존 알림 데이터여도, 해당 알림 탭 시 `/consent`로 이동하도록 보정

**핵심 파일**:
- `app/notifications.tsx`

---

## <a id="20260211-7"></a> 2026-02-11 | 알림센터 저장 누락(푸시만 수신) 대응

**작업 내용**:
- 증상: 푸시 알림은 도착하지만 알림센터(`notifications` 테이블) 저장이 누락됨
- 원인: 일부 경로에서 `target_url` 컬럼 포함 insert 실패 시 로그만 남기고 계속 진행
- 대응:
  - `fc-notify`에 `notifications` insert fallback 추가 (`target_url` 실패 시 컬럼 제외 재시도)
  - `admin-action`의 `sendNotification` 경로에도 동일 fallback 추가
  - 웹 관리자 `sendPushNotification` 및 관리자 채팅 알림 insert에 fallback 추가
  - `fc-notify`, `admin-action` Edge Function 재배포 완료
- 검증:
  - `fc-notify notify(target_id=00000000000)` 호출 후 `inbox_list`에서 저장 레코드 확인

**핵심 파일**:
- `supabase/functions/fc-notify/index.ts`
- `supabase/functions/admin-action/index.ts`
- `web/src/app/actions.ts`
- `web/src/app/dashboard/chat/page.tsx`

---

## <a id="20260211-6"></a> 2026-02-11 | FC 사전등록 안내 화면 임시 공지/알림 섹션 제거

**작업 내용**:
- 사용자 요청에 따라 `apply-gate` 화면에 추가했던 `먼저 확인해보세요` 블록(공지사항/알림센터 버튼)을 제거
- 기존 등록 신청 안내 및 기본 버튼(나중에/등록 신청 시작)만 유지

**핵심 파일**:
- `app/apply-gate.tsx`

---

## <a id="20260211-5"></a> 2026-02-11 | FC 사전등록 공지/알림 접근 개선 및 CORS 기본값 보정

**작업 내용**:
- FC 사전등록 안내 화면(`apply-gate`)에서 공지/알림센터로 즉시 이동 가능한 버튼 추가
- `home-lite` 바로가기 영역에서 불필요한 3번째 카드(알림센터 카드) 제거 요청 반영
- `fc-notify` Edge Function CORS 기본 `Access-Control-Allow-Origin` 값을 `*`로 보정하여, `ALLOWED_ORIGINS` 미설정 환경에서 공지/알림 조회 실패 가능성 완화

**핵심 파일**:
- `app/apply-gate.tsx`
- `app/home-lite.tsx`
- `supabase/functions/fc-notify/index.ts`

---

## <a id="20260211-1"></a> 2026-02-11 | 웹 공지 상세 페이지 및 목록 행 클릭 이동 구현

**Commit**: `778d48e`  
**작업 내용**:
- 관리자 웹 공지 목록에서 행 클릭 시 상세 페이지로 이동하도록 라우팅 개선
- 공지 상세 페이지(`notifications/[id]`) 동선 정리
- 서버 API와 상세 뷰 연결 강화

**핵심 파일**:
- `web/src/app/dashboard/notifications/page.tsx`
- `web/src/app/dashboard/notifications/[id]/page.tsx`
- `web/src/app/api/admin/notices/route.ts`

---

## <a id="20260211-2"></a> 2026-02-11 | 웹 공지 조회를 서버 API 경유로 전환(RLS 우회)

**Commit**: `50586dc`  
**작업 내용**:
- 웹 공지 목록이 RLS 영향으로 비어 보이던 문제 해결
- 클라이언트 직접 조회 대신 서버 라우트 API를 통해 공지 목록 조회

**핵심 파일**:
- `web/src/app/api/admin/notices/route.ts`
- `web/src/app/dashboard/notifications/page.tsx`

---

## <a id="20260211-3"></a> 2026-02-11 | 앱 공지 페이지를 fc-notify 기반 조회로 전환

**Commit**: `0074887`  
**작업 내용**:
- 모바일 공지 페이지에서 Supabase 직접 조회 대신 `fc-notify`(`inbox_list`) 응답 기반으로 전환
- RLS 환경에서도 공지/알림센터 데이터가 보이도록 안정화

**핵심 파일**:
- `app/notice.tsx`
- `supabase/functions/fc-notify/index.ts`

---

## <a id="20260211-4"></a> 2026-02-11 | 계정 삭제 플로우 실패 대비(fail-safe) 보강

**Commit**: `ca34a72`  
**작업 내용**:
- 앱 설정의 계정 삭제 로직이 특정 경로 실패 시 중단되던 문제 보완
- 대시보드/설정/Edge Function 삭제 경로를 보강해 삭제 복구 가능성 향상

**핵심 파일**:
- `app/settings.tsx`
- `app/dashboard.tsx`
- `supabase/functions/delete-account/index.ts`

---

## <a id="20260210-1"></a> 2026-02-10 | Windows 환경 Next.js dev lockfile 충돌 완화

**Commits**: `93f1336`, `05d3aec`  
**작업 내용**:
- Windows에서 `.next` lockfile/권한 충돌로 dev/build가 막히는 문제 완화
- dev 시작 전 프로세스 정리 및 안전한 클린업 스크립트 추가

**핵심 파일**:
- `web/package.json`
- `web/scripts/clean-next.mjs`
- `web/scripts/kill-next-dev.mjs`

---

## <a id="20260210-2"></a> 2026-02-10 | 웹 세션 쿠키 동기화 및 재로드 후 API 인증 안정화

**Commits**: `91fc04c`, `bdaa8eb`, `b462f4c`  
**작업 내용**:
- 웹 세션 복원 시 쿠키 동기화가 누락되어 관리자 API가 실패하던 문제 수정
- 세션 하이드레이션 이후 주민번호 조회 등 민감 API를 지연/조건부 호출

**핵심 파일**:
- `web/src/hooks/use-session.tsx`
- `web/src/app/dashboard/exam/applicants/page.tsx`

---

## <a id="20260210-3"></a> 2026-02-10 | 시험 신청자 화면 UX/타입/주민번호 표시 개선

**Commits**: `70d61de`, `18ea173`, `02a7d12`, `cb63c19`, `d4eeb52`, `1cdb808`  
**작업 내용**:
- 신청자 테이블 가로 스크롤 및 컬럼 폭 조정
- 주민등록번호 표시 컬럼 정합성 개선
- `no-explicit-any` 대응 등 타입 안정성 개선

**핵심 파일**:
- `web/src/app/dashboard/exam/applicants/page.tsx`
- `web/src/app/api/admin/resident-numbers/route.ts`
- `web/src/app/api/admin/fc/route.ts`

---

## <a id="20260210-4"></a> 2026-02-10 | 시험 일정/신청 도메인 null 날짜 처리 및 연계 안정화

**Commits**: `d674396`, `554342c`, `12e2625`  
**작업 내용**:
- `exam_date`가 `null`(미정)일 때 `Invalid Date`/`1970-01-01` 노출 문제 대응
- 시험 과목/라벨 표시 로직 정리
- 앱/웹/함수/스키마 동시 보정으로 일정 등록-조회 흐름 안정화

**핵심 파일**:
- `types/exam.ts`
- `app/exam-apply.tsx`, `app/exam-apply2.tsx`
- `web/src/app/dashboard/exam/schedule/actions.ts`
- `supabase/functions/admin-action/index.ts`
- `supabase/schema.sql`

---

## <a id="20260210-5"></a> 2026-02-10 | 대시보드 사이드바 토글/호버 확장 UX 도입

**Commits**: `e47da92`, `9957364`  
**작업 내용**:
- 사이드바를 버튼 기반 토글에서 호버 확장 UX까지 확장
- 좌측 네비게이션 가시성/작업 동선 개선

**핵심 파일**:
- `web/src/app/dashboard/layout.tsx`

---

## <a id="20260209-1"></a> 2026-02-09 | 앱/웹 누적 미반영 수정 일괄 반영 및 정리

**Commit**: `94a3fe6`  
**작업 내용**:
- 대시보드, 시험, 알림센터, 문서/회원가입 등 다수 화면/함수 정리
- 앱/웹 종단 간 누적 이슈를 하나의 정리 커밋으로 반영

**핵심 파일(대표)**:
- `app/dashboard.tsx`, `app/notifications.tsx`, `app/index.tsx`
- `supabase/functions/admin-action/index.ts`, `supabase/functions/fc-notify/index.ts`
- `web/src/app/dashboard/page.tsx`, `web/src/app/dashboard/exam/schedule/*`

---

## <a id="20260205-1"></a> 2026-02-05 | 온보딩 플로우 및 관리자 대시보드 대규모 업데이트

**Commit**: `904f020`  
**작업 내용**:
- 앱 온보딩 흐름(로그인/가입/수당/서류/위촉) 및 관리자 도메인 로직 동시 업데이트
- 스키마/함수/웹 관리 페이지 연동 정비
- 문서(README/CLAUDE/COMMANDS) 갱신

**핵심 파일(대표)**:
- `app/*` 다수
- `supabase/functions/*` 일부
- `supabase/schema.sql`
- `web/src/app/dashboard/*` 다수

---

## <a id="20260205-2"></a> 2026-02-05 | 서비스 계정/앱 키 파일 Git 관리 정책 조정

**Commits**: `9a1338b`, `14f4040`, `629b29a`  
**작업 내용**:
- `google-services.json`의 추적/제외 정책을 빌드 상황에 맞게 조정
- 캐시/민감 파일 ignore 정책 정리

**핵심 파일**:
- `.gitignore`
- `google-services.json`

---

## <a id="20260129-1"></a> 2026-01-29 | 미등록 계정 로그인/재설정 처리 및 FC 삭제 개선

**Commit**: `75defa8`  
**작업 내용**:
- 등록되지 않은 계정의 로그인/비밀번호 재설정 UX 보강
- FC 삭제 API/대시보드 연계 개선

**핵심 파일**:
- `app/auth.tsx`, `app/reset-password.tsx`
- `hooks/use-login.ts`
- `supabase/functions/login-with-password/index.ts`
- `supabase/functions/request-password-reset/index.ts`
- `web/src/app/api/fc-delete/route.ts`

---

## <a id="20260126-1"></a> 2026-01-26 | fc-delete API의 cookies 비동기 처리 보정

**Commit**: `23e4d8d`  
**작업 내용**:
- Next.js Route Handler에서 `cookies()` 사용 방식 보정
- 삭제 API 런타임 오류 방지

**핵심 파일**:
- `web/src/app/api/fc-delete/route.ts`

---

## <a id="20260126-2"></a> 2026-01-26 | 동의/서류/일정/알림 액션 흐름 개선

**Commit**: `1d3b6b6`  
**작업 내용**:
- 수당 동의 및 대시보드 액션 관련 웹 서버 액션/알림 처리 보정
- 앱 홈/동의 플로우와 웹 액션의 상태 동기화 강화

**핵심 파일**:
- `app/consent.tsx`, `app/index.tsx`
- `supabase/functions/fc-consent/index.ts`
- `web/src/app/dashboard/*/actions.ts`

---

## <a id="20260126-3"></a> 2026-01-26 | 앱 브랜딩 자산 및 일부 대시보드/삭제 경로 조정

**Commit**: `faa61c1`  
**작업 내용**:
- 로그인/아이콘 자산 업데이트
- FC 삭제/대시보드 일부 경로 정리

**핵심 파일**:
- `app/login.tsx`
- `assets/images/*`
- `web/src/app/api/fc-delete/route.ts`

---

## <a id="20260121-1"></a> 2026-01-21 | 모바일 게시판 홈 네비게이션 동선 조정

**Commit**: `c496aa7`  
**작업 내용**:
- 게시판 화면에서 홈/주요 경로 이동 UX 개선

**핵심 파일**:
- `app/board.tsx`

---

## <a id="20260121-2"></a> 2026-01-21 | Supabase Security Advisor 권고 반영

**Commit**: `09c9b30`  
**작업 내용**:
- RLS/뷰/함수 search_path 관련 보안 권고사항 반영
- 스키마와 마이그레이션 동시 정비

**핵심 파일**:
- `supabase/schema.sql`
- `supabase/migrations/20260121132500_enable_rls_and_view_security.sql`
- `supabase/migrations/20260121135000_fix_search_path_and_policies.sql`

---

## <a id="20260120-1"></a> 2026-01-20 | 하단 내비 컴포넌트 도입 및 설정 화면 정리

**Commit**: `fbb88d9`  
**작업 내용**:
- 모바일 공통 하단 내비게이션 컴포넌트 추가
- 설정/공지 화면 UI 정리 및 관련 컨텍스트 업데이트

**핵심 파일**:
- `components/BottomNavigation.tsx`
- `app/settings.tsx`, `app/notice.tsx`
- `hooks/use-bottom-nav-animation.ts`

---

## <a id="20260119-1"></a> 2026-01-19 | 게시판 화면 고도화 + Claude Skills/Subagent 체계 도입

**Commit**: `87276c6`  
**작업 내용**:
- 게시판 화면 개선
- `.claude/skills`, `.claude/agents` 문서/규칙 체계 구축

**핵심 파일**:
- `.claude/AGENTS_AND_SKILLS.md`
- `.claude/skills/*/SKILL.md`
- `.claude/agents/*.md`
- `app/board.tsx`

---

## <a id="20260117-1"></a> 2026-01-17 | 웹 빌드(TypeScript) 오류 수정

**Commit**: `785083f`  
**작업 내용**:
- Vercel 빌드를 막던 타입 오류 정리
- 관리자 웹 페이지 타입 안전성 보강

**핵심 파일**:
- `web/src/app/admin/exams/[id]/page.tsx`
- `web/src/app/dashboard/chat/page.tsx`
- `web/src/app/dashboard/profile/[id]/page.tsx`

---

## <a id="20260117-2"></a> 2026-01-17 | 게시판 기능(모바일/웹 + Edge Functions) 대규모 도입

**Commit**: `2f69ca4`  
**작업 내용**:
- 게시판 CRUD/댓글/반응/첨부 업로드/다운로드 기능 전면 도입
- 모바일/웹 UI 및 Edge Functions 세트 구축
- API 계약/요구사항/ADR/테마 컴포넌트 문서 업데이트

**핵심 파일(대표)**:
- `app/board.tsx`, `app/admin-board*.tsx`
- `supabase/functions/board-*`
- `lib/board-api.ts`, `web/src/lib/board-api.ts`
- `contracts/api-contracts.md`, `docs/guides/BOARD_REQUIREMENTS.md`

---

## <a id="20260113-1"></a> 2026-01-13 | 문서 최신화 및 Manager 읽기 전용 UI 보강

**Commit**: `f1448b6`  
**작업 내용**:
- 본부장(Manager) 계정 읽기 전용 표시/동작 추가 보정
- 대시보드/시험/채팅/공지 생성 화면 UX 문구 및 제어 정리

**핵심 파일**:
- `web/src/app/dashboard/page.tsx`
- `web/src/app/dashboard/exam/*`
- `web/src/app/dashboard/chat/page.tsx`
- `web/src/components/StatusToggle.tsx`

---

## <a id="20260112-1"></a> 2026-01-12 | 공통 문서/컴포넌트/로거/개발도구 기반 구축

**Commit**: `0c95e8e`  
**작업 내용**:
- 프로젝트 문서 체계(`AI.md`, `HANDOVER.md`, `contracts`, `adr`) 정리
- 공통 UI 컴포넌트/로깅/검증/테스트/Git hooks 기반 확장
- 앱/웹/함수 전반 구조 정비

**핵심 파일(대표)**:
- `AI.md`, `HANDOVER.md`, `contracts/*`, `adr/*`
- `components/Button.tsx`, `components/FormInput.tsx`, `components/LoadingSkeleton.tsx`
- `lib/logger.ts`, `lib/validation.ts`
- `package.json`, `.husky/pre-commit`

---

## <a id="20260112-2"></a> 2026-01-12 | 웹 Manager 역할 처리 + 로그/빌드 호환성 + 시험일 미정 지원

**Commits**: `0cc1c4e`, `0689434`, `e4f944e`, `8b910e5`  
**작업 내용**:
- 웹 세션에 `manager` 역할 처리 및 읽기 전용 동작 반영
- logger의 Next.js 빌드 호환성 개선
- 시험 일정의 `TBD(미정)` 처리 지원

**핵심 파일**:
- `web/src/hooks/use-session.tsx`
- `web/src/app/auth/page.tsx`
- `web/src/app/dashboard/exam/schedule/page.tsx`
- `web/src/lib/logger.ts`

---

## <a id="20260112-3"></a> 2026-01-12 | 신원확인 입력 UX 및 명령어 문서 보강

**Commit**: `f0f46bb`  
**작업 내용**:
- 신원확인 입력 중 스크롤/키보드 충돌 완화
- 운영용 명령어 문서 보강

**핵심 파일**:
- `components/KeyboardAwareWrapper.tsx`
- `docs/guides/명령어 모음집.txt`

---

## <a id="20260112-4"></a> 2026-01-12 | 모바일 로그인 로고 반영

**Commit**: `f165d5a`  
**작업 내용**:
- 모바일 로그인 화면에 웹과 동일 브랜딩 로고 반영

**핵심 파일**:
- `app/login.tsx`

---

## <a id="20260112-5"></a> 2026-01-12 | 빌드 의존성 정렬 및 SMS 운영 문서 추가

**Commit**: `a0fbfcf`  
**작업 내용**:
- 빌드 의존성 정리
- SMS 테스트/운영 문서 및 스크립트 추가

**핵심 파일**:
- `package.json`, `package-lock.json`
- `docs/guides/COMMANDS.md`
- `docs/guides/SMS_TESTING.md`
- `test-sms.js`
