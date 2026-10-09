doc_id: FC-APP-SERVICE-HOME
owner_repo: fc-onboarding-app
owner_area: mobile
audience: developer, operator
last_verified: 2026-10-09
source_of_truth: app/index.tsx + app/services/* + components/ServiceHub.tsx + components/service-home/* + lib/service-home.ts + lib/session-landing.ts + lib/bottom-navigation.ts

# Mobile Playbook: 서비스 선택 홈

## 서비스 홈

기본 `/`는 비회원·FC·운영 담당자가 서비스를 고르는 공개 홈이다. 서비스별 맞춤 PNG는 `assets/images/service-home/`에 있고 `lib/theme.ts`의 기존 가람in 색을 사용한다. 이 홈은 업무용 프로필·게시글·고객·알림 자료를 조회하지 않는다.

기본 시작 화면은 `index`이다. 세션 복구 전에는 브랜드 로딩을 표시하고 복구 뒤 공개 홈을 연다. 저장된 linked designer 세션은 focused 상태에서 알림 네비게이션 결정을 기다린 뒤 `/request-board`로 이동한다. 명시적 `/services`는 모든 역할이 서비스 안내를 둘러보는 경로다.

## 보험·FC 진입

- 비회원: `/login?service=insurance`으로 이동한다. 로그인 성공 뒤 선택한 보험 업무를 기존 gate를 통해 이어간다. 현재 가입은 FC 업무용이며 로그인에서 `FC 회원가입`으로 표시한다.
- FC: `/apply-gate?next=/?mode=insurance`에 해당하는 params로 이동한다. 기존 identity 완료 확인과 오류·재시도 정책을 거친다.
- 관리자·본부장·개발자: `/?mode=insurance`로 기존 역할별 업무 화면을 연다. manager의 readOnly와 developer subtype 계약은 유지한다.
- linked designer: `/request-board`로 이동한다.

일반 FC 로그인 뒤 기본 landing은 `/`이다. 기존 `home-lite`는 본인확인 이전 제한 화면으로 유지하며, 완료 후 홈으로 돌아간다. 공개 홈의 보험 CTA는 기존 apply gate가 실제 identity 완료 여부를 확인하게 한다.

로그인은 단일 문자열 `service=insurance`만 선택 의도로 인정한다. FC 식별자·hydration 대기와 `skipAuto` 수동 로그인 조건, 알림 우선순위를 먼저 유지한다. 다른 값·배열은 일반 landing을 사용한다. 계정 생성·최초 비밀번호 변경까지 선택 의도를 보존하는 동작은 이번 변경에 포함하지 않는다.

## 기존 링크와 알림

`mode=insurance|onboarding|exam` 또는 단일 문자열의 notification receipt 문맥은 `app/index.tsx` 안의 `LegacyInsuranceHome`으로 연결한다. hydration과 로그인 role을 먼저 확인해 공개 branch에서 기존 protected hooks와 count ping을 마운트하지 않는다. 보호된 문맥의 signed-out 상태는 `/login?skipAuto=1`을 사용한다.

알려지지 않은 mode는 서비스 홈이다. query가 역할·권한을 부여하지 않는다. 기존 홈 알림 receipt 처리와 권한 재검증은 그대로 사용한다.

## 서비스 안내와 하단 메뉴

`services/care`, `services/telecom`, `services/car`는 준비 중 상태를 안내한다. 신청·구매·보험금·페이백을 확정하거나 실제 등록하지 않는다. `services/help`는 공개 안내와 현재 FC 가입 범위를 설명한다.

안내의 네 경로는 `generateStaticParams`로 web export에도 생성한다.

`services/activity`는 통합 이용내역이 준비 중임을 표시하고 기존 보험/FC 진행 화면으로 연결한다. `services/account`는 session hydration 뒤 기존 설정 또는 로그인으로 연결한다. 하단 홈·이용내역·내 정보는 중앙 resolver의 명시적인 `service-hub` surface를 사용하며 기존 보호된 역할별 preset을 바꾸지 않는다.

## 검증

회귀 근거는 `lib/__tests__/service-home.test.ts`, `service-home-entry.test.js`, `session-landing.test.ts`, `login-navigation.test.js`, `components/service-home/__tests__/ServiceHomeScreen.test.tsx`와 기존 identity/logout/notification suite다. 로컬 앱 화면과 bundle 증거는 `.codex/harness/service-home-20261009/qa-report.md`에서 관리한다. 실제 계정 로그인·기기 설치·배포 증거와 구분한다.
