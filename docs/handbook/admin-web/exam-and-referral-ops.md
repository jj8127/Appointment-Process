doc_id: FC-ADMIN-EXAM-REFERRAL
owner_repo: fc-onboarding-app
owner_area: admin-web
audience: operator, developer
last_verified: 2026-04-25
source_of_truth: web/src/app/dashboard/exam/* + web/src/app/admin/exams/* + web/src/app/dashboard/referrals/page.tsx + web/src/app/dashboard/referrals/graph/page.tsx + web/src/app/api/admin/referrals/route.ts

# Admin Web Playbook: Exam And Referral Ops

## 포함 화면

- `/dashboard/exam/schedule`
- `/dashboard/exam/applicants`
- `/admin/exams/*`
- `/dashboard/referrals`
- `/dashboard/referrals/graph`

## 시험 운영

- 라운드 생성/수정/삭제
- 신청자 조회/삭제
- legacy admin 시험 화면과 최신 dashboard 시험 화면이 공존
- `/dashboard/exam/applicants` 는 상단 소속 quick filter를 제공
- resident number/full view는 운영 역할(admin/manager/developer) 기준으로 읽을 수 있고, `manager`는 모든 쓰기 액션이 비활성
- `/api/admin/exam-applicants` 는 `exam_registrations.resident_id` 와 `fc_profiles.phone` 를 raw/digits/hyphenated 후보로 매칭한 뒤 `fc_identity_secure` 에서 full resident number를 읽는다.
- `/dashboard/exam/applicants` 에서 주민등록번호 열이 일괄 `주민번호 조회 실패` 로 보이면 우선 `exam_registrations.resident_id` 와 `fc_profiles.phone` 포맷 drift, 그다음 `fc_identity_secure` 누락을 확인한다.

## 추천인 운영

- backfill
- rotate code
- disable code
- manager는 read-only
- `/dashboard/referrals/graph`는 구조화 추천 관계를 읽기 전용으로 탐색한다.
- 그래프 edge는 `fc_profiles.recommender_fc_id` 기반 current-state를 기준으로 그리고, graph 안에서 mutation CTA를 열지 않는다.
- Obsidian Graph View를 참고하되 추천인 tree 가독성에 맞춘 hybrid layout 계약을 유지한다. runtime은 d3 `charge`와 기존 `link`에 link tension, branch bend, sibling angular separation, node/cluster separation, weak cluster gravity, drag rope constraint를 보조 force로 더한다.
- 초기 seed는 component 크기순 중앙 배치, hub child star/pinwheel, 제한된 isolated golden-angle 분포를 제공한다. isolated node 기본 노출과 toggle은 UI 필터 계약이며, runtime에서 강제 outer ring force를 쓰지 않는다.
- node drag는 pointer 대상 노드만 임시 `fx/fy`로 고정하되 incident edge가 길게 늘어지지 않도록 연결 노드가 rope constraint로 따라온다. release는 `fx/fy` hard pin 해제와 simulation reheat를 수행하고, release velocity나 decaying drop tether를 주입하지 않는다.
- 물리 slider는 `Center force`, `Repel force`, `Link force`, `Link distance` 네 항목이며 범위와 기본값은 Obsidian 의미를 따른다.
- 기본 이름 label은 숨기지 않고, 추천코드 detail은 선택/검색 상태에서만 확장한다.

## 연관 문서

- [../data/referral-schema-and-admin-rpcs.md](E:/hanhwa/fc-onboarding-app/docs/handbook/data/referral-schema-and-admin-rpcs.md)
- [../backend/admin-operations-api.md](E:/hanhwa/fc-onboarding-app/docs/handbook/backend/admin-operations-api.md)
