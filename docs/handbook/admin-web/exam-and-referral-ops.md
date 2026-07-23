doc_id: FC-ADMIN-EXAM-REFERRAL
owner_repo: fc-onboarding-app
owner_area: admin-web
audience: operator, developer
last_verified: 2026-07-22
source_of_truth: web/src/app/dashboard/exam/* + web/src/app/admin/exams/* + web/src/app/dashboard/referrals/page.tsx + web/src/app/dashboard/referrals/graph/page.tsx + web/src/app/api/admin/referrals/route.ts

# Admin Web Playbook: Exam And Referral Ops

## 2026-07-06 Exam Applicants API Auth Contract

- `/api/admin/exam-applicants` is a privileged admin web API and must use the signed server-session helper before reading or mutating applicant data.
- Caller-supplied role or resident identity values are ignored for authorization; admin/manager capabilities come only from the verified session.

## 포함 화면

- `/dashboard/exam/schedule`
- `/dashboard/exam/applicants`
- `/admin/exams/*`
- `/dashboard/referrals`
- `/dashboard/referrals/graph`

## 시험 운영

- 라운드 생성/수정/삭제
- 라운드 생성/수정은 `save_exam_round_atomic` service-role RPC가 운영 DB에 먼저 적용된 뒤에만 활성화한다. PostgREST `PGRST202`는 입력 오류가 아니라 RPC rollout 누락으로 분류하며, 다중 쿼리 fallback으로 우회하지 않는다.
- 신청자 조회/삭제
- legacy admin 시험 화면과 최신 dashboard 시험 화면이 공존
- `/dashboard/exam/applicants` 는 상단 소속 quick filter를 제공
- 소속 quick filter는 현재 신청자 데이터와 별개로 `2본부 박성훈`, `6본부 김정수`, `9본부 김주용`, `10본부 한태균`을 항상 노출한다. 기존 복합 소속값은 짧은 운영 표기로 정규화해 같은 필터로 매칭하고, 본부 번호는 숫자로 정렬한다.
- `/dashboard/exam/applicants` 는 소속 quick filter 아래에 `시험 종류`와 `시험 회차` 상단 필터를 제공한다. 적용 순서는 `소속 quick filter -> 시험 종류 -> 시험 회차 -> 테이블 헤더 필터`다.
- 시험 종류/회차 필터 옵션은 `/api/admin/exam-applicants` 응답의 `round_id`, `round_label`, `exam_date`, `exam_type`, `is_third_exam`를 client helper에서 중복 제거해 만든다. 회차 메뉴는 날짜·회차·과목을 분리해 표시하고 선택 상태를 체크 아이콘과 주황 배경으로 구분한다.
- 총 신청자/접수 완료/미접수 통계 카드는 버튼이며 접수 상태 필터를 적용한다. 통계 숫자는 소속·시험·헤더 필터까지 적용하되 접수 상태 자체는 제외한 모집단에서 계산해, 접수 카드 선택 후에도 완료/미접수 비교 수치가 흔들리지 않는다. CSV 다운로드는 최종 `filteredRows`를 따른다.
- 신청자 row는 접수 완료를 옅은 주황, 미접수를 옅은 회색으로 구분하고 상태 변경 직후 같은 색 계약을 따른다. hover 라벨은 마우스를 따라가되 커서보다 위쪽에 반투명 배경으로 표시하며 소속과 이름만 노출한다.
- 신청자 row 클릭 또는 키보드 Enter/Space는 `/dashboard/exam/applicants/[id]` 상세로 이동한다. 상세는 신청자·시험·접수 상태를 한 화면에 표시하고 admin에게 `시험 접수하기`를 제공한다. manager는 상세를 읽을 수 있지만 접수/삭제 등 쓰기 액션은 계속 비활성이다.
- 신청자 상세의 `이전 신청자`/`다음 신청자`는 목록과 같은 `created_at DESC, id DESC` 순서를 사용한다. 첫 신청자의 이전 버튼과 마지막 신청자의 다음 버튼은 비활성화하며, 이동 중 개인 식별값을 URL label이나 로그에 추가하지 않는다.
- 상세 API의 `registrationId` 조회는 선택 row 하나를 찾은 뒤 동일 신청자의 과거 이력을 함께 읽어 `신규신청/재신청`을 계산하고, enrichment 직전에 선택 row로 다시 좁힌다. 선택 row만 먼저 분류해 재신청 이력을 잃지 않는다.
- 신청자 목록 컬럼/CSV 순서와 badge wrapping은 `web/src/lib/exam-applicant-list-display.ts`의 shared contract를 따른다. `시험 신청일`은 `exam_registrations.created_at`에서 날짜만 표시하며 테이블과 CSV에 함께 포함한다. `/admin/exams/[id]`는 특정 `roundId`를 서버 API로 조회하므로 별도의 상단 회차 필터를 추가하지 않는다.
- resident number/full view는 운영 역할(admin/manager/developer) 기준으로 읽을 수 있고, `manager`는 모든 쓰기 액션이 비활성
- `/api/admin/exam-applicants` 는 `exam_registrations.resident_id` 와 `fc_profiles.phone` 를 raw/digits/hyphenated 후보로 매칭한 뒤 `fc_identity_secure` 에서 full resident number를 읽는다.
- `/dashboard/exam/applicants` 에서 주민등록번호 열이 일괄 `주민번호 조회 실패` 로 보이면 우선 `exam_registrations.resident_id` 와 `fc_profiles.phone` 포맷 drift, 그다음 `fc_identity_secure` 누락을 확인한다.
- 2026-05-30 기준 `/api/admin/exam-applicants` enrichment는 `web/src/lib/exam-applicant-resident-number-enrichment.ts`가 row defaults, phone candidate matching, `fcIds` de-dupe, full resident-number merge, `주민번호 조회 실패` fallback literal을 고정한다.

## 추천인 운영

- backfill
- rotate code
- disable code
- manager는 read-only
- `/dashboard/referrals/graph`는 구조화 추천 관계를 읽기 전용으로 탐색한다.
- 그래프 edge는 `fc_profiles.recommender_fc_id` 기반 current-state를 기준으로 그리고, graph 안에서 mutation CTA를 열지 않는다.
- 그래프 노드는 `life_commission_completed`/`appointment_date_life`와 `nonlife_commission_completed`/`appointment_date_nonlife`가 모두 완료 evidence일 때 초록색으로 표시한다. 초록은 추천코드 상태를 바꾸지 않는 별도 위촉 완료 강조색이다.
- 그래프 범례는 색상 기준으로 읽는다: 초록=생명·손해 위촉 모두 완료, 주황=추천코드 사용 중, 노랑 표시=본부장 강조 또는 예전 기록 확인 테두리, 회색=추천코드 없음/중지.
- Obsidian Graph View를 참고하되 추천인 tree 가독성에 맞춘 hybrid layout 계약을 유지한다. runtime은 d3 `charge`와 기존 `link`에 link tension, branch bend, sibling angular separation, node/cluster separation, weak cluster gravity, drag rope constraint를 보조 force로 더한다.
- 초기 seed는 component 크기순 중앙 배치, hub child star/pinwheel, 제한된 isolated golden-angle 분포를 제공한다. isolated node 기본 노출과 toggle은 UI 필터 계약이며, runtime에서 강제 outer ring force를 쓰지 않는다.
- node drag는 pointer 대상 노드만 임시 `fx/fy`로 고정하되 incident edge가 길게 늘어지지 않도록 연결 노드가 rope constraint로 따라온다. release는 `fx/fy` hard pin 해제와 simulation reheat를 수행하고, release velocity나 decaying drop tether를 주입하지 않는다.
- 물리 slider는 `Center force`, `Repel force`, `Link force`, `Link distance` 네 항목이며 범위와 기본값은 Obsidian 의미를 따른다.
- 기본 이름 label은 숨기지 않고, 추천코드 detail은 선택/검색 상태에서만 확장한다.

## 연관 문서

- [../data/referral-schema-and-admin-rpcs.md](../data/referral-schema-and-admin-rpcs.md)
- [../backend/admin-operations-api.md](../backend/admin-operations-api.md)
