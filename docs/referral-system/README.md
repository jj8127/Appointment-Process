# 추천인 시스템 문서 인덱스

`docs/referral-system`은 가람in 추천인 시스템의 전용 SSOT 폴더입니다.

- 기준일: `2026-03-19`
- 저장소 기준 문서: 루트 `AGENTS.md`
- 도메인 기준 문서: `docs/referral-system/AGENTS.md`

## 읽는 순서

1. `AGENTS.md`
   - 추천인 시스템 작업 규칙, 변경 의무, 테스트/장애 기록 규칙
2. `SPEC.md`
   - 추천코드/초대링크 정책, 상태값, 우선순위, 운영 규칙
3. `ARCHITECTURE.md`
   - 앱/서버/딥링크/스토어 fallback 구조와 책임 경계
4. `TEST_CHECKLIST.md`
   - 실행 순서와 증적 기준
5. `test-cases.json`
   - 케이스 ID와 세부 시나리오 SSOT
6. `INCIDENTS.md`
   - 실제 장애, 원인, 해결, 회귀 케이스 연결

## 파일 설명

- `AGENTS.md`
  - 추천인 시스템 전용 운영 규칙
- `SPEC.md`
  - 현재 합의된 요구사항과 미확정 항목
- `ARCHITECTURE.md`
  - 구현 구조 초안과 저장소 간 책임 분리
- `TEST_CHECKLIST.md`
  - 수동/반자동 검증 절차
- `test-cases.json`
  - 기계가 읽을 수 있는 테스트 케이스 원본
- `TEST_RUN_RESULT.json`
  - 최근 실행 결과 기록
- `INCIDENTS.md`
  - 문제 재현법, 원인, 해결, 회귀 케이스
- `fixtures/README.md`
  - 추천인 테스트용 계정/데이터 운영 규칙
- `queries.sql`
  - 추천인 검증용 SQL 초안

## 유지 원칙

- 추천인 흐름을 건드리면 코드와 함께 이 폴더도 반드시 갱신합니다.
- 신규 버그가 나오면 `INCIDENTS.md`와 `test-cases.json`을 같은 변경에 묶습니다.
- 테스트 케이스 ID는 한 번 발급하면 재사용하거나 의미를 바꾸지 않습니다.
- 구현이 아직 없는 영역은 `TBD`로 숨기지 말고, 현재 가정과 확정 필요 항목을 분리해 적습니다.
