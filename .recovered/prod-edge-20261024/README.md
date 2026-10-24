# 운영 Edge Function 소스 보존 (2026-10-24)

모두온 Supabase 프로젝트(`ubeginyxaotcamuqpmud`)에 배포된 Edge Function 55개의 소스를
`get_edge_function`으로 받아 그대로 남긴 것이다. 줄 끝은 LF로 맞췄다.

- `<slug>/` 아래 경로는 저장소 기준 경로다(예: `fc-notify/supabase/functions/_shared/...`).
  함수마다 배포 당시의 `_shared` 모듈을 함께 담았으므로 같은 파일이 여러 벌 있을 수 있다.
- `MANIFEST.json`: 함수별 version, updated_at, verify_jwt, ezbr_sha256과 기준 커밋
  (`align/prod-baseline-20261024`, 149682a8) 대비 파일별 비교 결과.
- 운영 index.ts가 git 이력에 없는 함수: fc-notify v111, docs-deadline-reminder v15,
  device-token-register v9. 나머지 차이는 저장소의 옛 버전이다.

이 폴더는 실행 코드가 아니다. 정본을 정할 때 비교용으로만 쓴다.
