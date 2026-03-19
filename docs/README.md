# 문서 디렉토리

`fc-onboarding-app/docs`는 운영, 배포, 테스트, 보조 가이드를 모아둔 인덱스입니다.

- 기준일: `2026-03-19`
- 문서 SSOT: 루트 `AGENTS.md`

## 디렉토리 구조

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
  - 추천코드/초대링크 정책, 상태, 우선순위
- `ARCHITECTURE.md`
  - 링크, 앱, 서버, 스토어 fallback 구조
- `TEST_CHECKLIST.md`
  - 추천인 전용 실행 체크리스트
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

### `superclaude/`

- `SUPERCLAUDE.md`
- `agent_skill.md`

보조 AI 문서이며, 현재 운영 규칙의 기준 문서는 아닙니다.

## 함께 봐야 하는 루트 문서

- `README.md`
  - 프로젝트 개요/구성/명령
- `AGENTS.md`
  - 운영 규칙, 로드맵, 검증 기준
- `.claude/PROJECT_GUIDE.md`
  - 정책/컨텍스트 상세
- `.claude/WORK_LOG.md`, `.claude/WORK_DETAIL.md`
  - 최근 작업 이력

## 문서 유지 원칙

- 기능 동작이 바뀌면 코드와 함께 관련 문서도 갱신합니다.
- 운영 절차가 바뀌면 `guides/` 또는 `deployment/` 문서를 우선 수정합니다.
- 추천인 시스템이 바뀌면 `referral-system/` 하위 문서를 함께 맞춥니다.
- 테스트 체크리스트가 바뀌면 `testing/` 하위 파일을 함께 맞춥니다.
- 구조 설명이 바뀌면 이 인덱스와 루트 `README.md`를 같이 갱신합니다.
