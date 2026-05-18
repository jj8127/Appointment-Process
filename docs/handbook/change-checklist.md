doc_id: FC-HANDBOOK-CHANGE-CHECKLIST
owner_repo: fc-onboarding-app
owner_area: handbook
audience: developer
last_verified: 2026-04-06
source_of_truth: .github/pull_request_template.md + scripts/ci/check-governance.mjs

# 변경 체크리스트

## handbook 변경이 필수인 경우

- 사용자 화면, 버튼, 탭, 모달, 알림 클릭 결과가 바뀔 때
- 상태 문자열, 상태 전이, enable/disable 조건이 바뀔 때
- `admin`/`manager`/`developer`/`fc`/`designer` 권한 경계가 바뀔 때
- request_board 브리지, 세션, 비밀번호 sync, push, unread 합산 규칙이 바뀔 때
- migration, bucket, RPC, secret, 운영 스크립트 전제조건이 바뀔 때

## 기본 원칙

- handbook는 모든 코드 변경에 매번 갱신하지 않습니다.
- 평소 구현 세션에서는 코드와 작업로그를 우선하고, handbook는 정기 동기화 세션에서 업데이트합니다.
- 다만 handbook를 실제로 수정하는 세션에서는 owning 문서 규칙을 엄격히 지켜야 합니다.

## 최소 변경 세트

- handbook 관련 owning doc
- `docs/handbook/path-owner-map.json`에서 매핑된 owning handbook 문서
- `.claude/WORK_LOG.md`
- `.claude/WORK_DETAIL.md`
- 회귀/드리프트/반복 실수 fix라면 `.claude/MISTAKES.md`
- 필요 시 `README.md`, `docs/README.md`
- 필요 시 `AGENTS.md` 또는 관련 domain AGENTS

## 검증 기준

- 화면 변경이면 `button-action-matrix.md` 또는 해당 playbook도 같이 수정
- 상태 변경이면 `workflow-state-matrix.md`와 owning contract 문서 수정
- 브리지/secret 변경이면 shared contract + security docs 수정
- handbook-sensitive 코드 경로는 `path-owner-map.json` 검사를 통과해야 함
- 회귀 fix면 broad 로그와 별도로 `MISTAKES.md`에 root cause + permanent guardrail 기록
- 정기 handbook sync 세션에서는 `node scripts/ci/check-governance.mjs --require-handbook-sync`를 사용
