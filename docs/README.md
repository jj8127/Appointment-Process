# 문서 디렉토리

`fc-onboarding-app/docs`는 운영, 배포, 테스트, 보조 가이드를 모아둔 인덱스입니다.

- 기준일: `2026-07-08`
- 문서 SSOT: `docs/handbook/INDEX.md`
- cross-repo 문서 운영 계약: `docs/handbook/shared/documentation-contract.md`

## 디렉토리 구조

### `handbook/`

- `INDEX.md`
  - handbook 진입점
- `shared/`
  - 역할/브리지/보안/문서 운영 공통 계약
- `mobile/`
  - Expo 앱 화면 플레이북
- `admin-web/`
  - 관리자 웹 플레이북
- `backend/`
  - Edge Function/API/cron 런북
- `data/`
  - schema/storage/presence/referral 문서

### `deployment/`

- `DEPLOYMENT.md`
  - Expo/EAS 배포 절차
  - 릴리즈 체크포인트
  - 운영 반영 순서

### `guides/`

- `COMMANDS.md`
  - 자주 쓰는 운영 명령어
- `BOARD_REQUIREMENTS.md`
  - 게시판 관련 요구사항/정책
- `SMS_TESTING.md`
  - 문자/OTP 테스트 메모
- `명령어 모음집.txt`
  - 로컬 작업용 명령 모음
- `흐름도.txt`
  - 업무 흐름 메모

### `referral-system/`

- `AGENTS.md`
  - 추천인 시스템 전용 운영 규칙과 변경 의무
- `SPEC.md`
  - 추천코드/초대링크 정책, login-time code guarantee, 상태, 우선순위, 코드 운영 규칙
- `ARCHITECTURE.md`
  - login auto-issue, 링크, 앱, 서버, 스토어 fallback 구조와 관리자 코드 운영 경계
- `TEST_CHECKLIST.md`
  - 추천인 전용 실행 체크리스트와 login/self-service/runtime 회귀 기준
- `test-cases.json`
  - 추천인 테스트 케이스 SSOT
- `TEST_RUN_RESULT.json`
  - 추천인 테스트 실행 결과
- `INCIDENTS.md`
  - 추천인 장애, 재현법, 회귀 케이스
- `fixtures/README.md`
  - 테스트 계정/기기/초기화 규칙
- `queries.sql`
  - DB 정합성 확인용 SQL 초안

### `testing/`

- `INTEGRATED_TEST_CHECKLIST.md`
  - 통합 점검 시나리오
- `integrated-test-cases.json`
  - 통합 테스트 케이스 데이터
- `INTEGRATED_TEST_RUN_RESULT.json`
  - 최근 실행 결과 기록

### `archive/`

- `2026-07-doc-cleanup/`
  - 오래된 AI 보조 문서, 완료된 계획 문서, 과거 테스트 evidence를 보존합니다.
  - 현재 운영 규칙의 기준 문서는 아닙니다.

## 함께 봐야 하는 루트 문서

- `README.md`
  - 프로젝트 개요/구성/명령
- `AGENTS.md`
  - 빠른 시작, 작업 라우팅, 금지사항, 현재 큰 리스크
- `.claude/PROJECT_GUIDE.md`
  - 정책/컨텍스트 상세
- `.claude/WORK_LOG.md`, `.claude/WORK_DETAIL.md`
  - 최근 작업 이력
- `docs/handbook/shared/documentation-contract.md`
  - 문서 우선순위, 최소 갱신 세트, legacy 처리, 애매한 규칙 확인 기준

## 문서 유지 원칙

- 한 규칙은 한 문서에만 공식 원본으로 둡니다.
- 기능 동작이 바뀌면 `path-owner-map.json`과 `contract-test-map.json` 기준으로 필요한 최소 문서만 갱신합니다.
- handbook가 존재하는 영역은 handbook를 우선 SSOT로 갱신합니다.
- 운영 절차가 바뀌면 `guides/` 또는 `deployment/` 문서를 우선 수정합니다.
- 추천인 시스템이 바뀌면 `referral-system/` 하위 문서를 함께 맞춥니다.
- 테스트 체크리스트가 바뀌면 `testing/` 하위 파일을 함께 맞춥니다.
- 구조 설명이 바뀌면 이 인덱스와 루트 `README.md`를 같이 갱신합니다.
- 공식 SSOT 변경, legacy 문서 이동/삭제, CI 강제 규칙 추가처럼 운영 판단이 필요한 경우 사용자 확인 후 적용합니다.
