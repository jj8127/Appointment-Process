doc_id: FC-ADMIN-DASHBOARD-LIFECYCLE
owner_repo: fc-onboarding-app
owner_area: admin-web
audience: operator, developer
last_verified: 2026-04-25
source_of_truth: web/src/app/dashboard/page.tsx + web/src/app/dashboard/profile/[id]/page.tsx + web/src/app/api/admin/fc/route.ts + web/src/lib/shared.ts

# Admin Web Playbook: Dashboard Lifecycle

## 목적

- FC lifecycle 운영의 메인 콘솔

## 진입 경로

- `/dashboard`
- `/dashboard/profile/[id]`
- `/`와 `/auth`는 dashboard 진입 직전 단계이며, 최종 staff 진입 판정은 middleware cookie session과 `use-session` restore가 같은 snapshot을 공유해야 한다.
- `/` root entry는 세션 복원 뒤 로더에 머무르면 안 되며, staff session이면 `/dashboard`, 그 외에는 `/auth`로 즉시 resolve되어야 한다.

## 표시 역할

- `admin`
- `manager` read-only

## 읽는 데이터

- FC 리스트/검색
- step bucket
- profile basic info
- resident number full-view (`/dashboard` 모달 + `/dashboard/profile/[id]`)
- recommender + invitee referral code
- doc/hanwha/appointment status
- commission flags

## 쓰는 데이터

- `updateProfile`
- `updateStatus`
- `updateAllowanceDate`
- `updateDocsRequest`
- `createHanwhaPdfUploadUrl`
- `deleteHanwhaPdf`
- `signDoc`
- `sendReminder`
- `getReferralCode`
- hanwha approve/reject
- appointment confirm/reject

## 상태/분기

- `manager`는 같은 화면을 보더라도 write action이 비활성
- protected dashboard/admin layout은 middleware가 이미 통과시킨 staff session을 restore gap 때문에 다시 `/auth`로 밀어내면 안 된다.
- FC 상세 모달은 `수당 동의 / 서류 관리 / 한화 위촉 / 생명/손해 위촉` 4탭 구조
- FC 상세 모달 헤더는 `/api/admin/resident-numbers` trusted path를 통해 주민등록번호 full-view와 생년월일을 바로 보여준다. 실패 시 masked fallback으로 돌리지 않고 조회 실패를 그대로 표시한다.
- `/dashboard` 모달과 `/dashboard/profile/[id]` resident-number fetch는 같은 trusted web contract를 공유해야 하며, 한쪽만 별도 로직으로 고치고 다른 쪽을 남기는 변경은 회귀로 본다.
- `/dashboard/profile/[id]`는 브라우저 anon Supabase client로 `fc_profiles`를 직접 읽지 않는다. 상세 기본정보와 `fc_documents`는 `/api/admin/fc`의 read-only `getProfile` action을 통해 service-role 서버 경로에서 조회해야 하며, singular-query `406`을 브라우저가 직접 받는 구현은 회귀로 본다.
- FC 상세 모달과 `/dashboard/profile/[id]`는 `추천인` 아래에 invitee의 `가입 시 사용한 추천코드`를 함께 표시한다. confirmed attribution의 historical code가 우선이고, 그것이 없을 때만 inviter 현재 활성 코드 또는 구조화 링크 fallback을 사용하며, 모두 없으면 `-`로 유지한다.
- temp-id, allowance, docs, hanwha, appointment, commission flag가 서로 상태 합성에 영향
- 대시보드 상단 KPI 카드는 별도 summary table이 아니라 `/api/admin/list`로 받은 FC 배열을 client에서 다시 집계한다. `총 인원`은 디자이너를 제외한 `signup_completed` FC 수이며 하단 문구는 `가입 완료 FC 현황`으로 맞춘다.
- `수당동의 승인 대기` 카드는 raw `status === allowance-pending` 전체가 아니라, workflow step 1에 있으면서 `getAllowanceDisplayState` 기준 `entered` 또는 `prescreen` 상태인 FC만 센다. 반려(`rejected`)나 미입력(`missing`)은 `승인 필요`로 보지 않는다.
- `서류검토 대기` 카드는 workflow step 2에 있으면서 `getDocProgress`가 `in-progress`인 FC만 센다. 즉 실제 업로드가 있어 검토가 필요한 건만 포함하고, `docs-requested`(업로드 전)나 `rejected`(재제출 대기)는 제외한다.
- 수당동의 탭은 상단 `상태 흐름`을 `임시사번`보다 먼저 배치해 현재 파생 상태를 먼저 읽게 하고, 현재 카드만 연한 주황색으로 강조한다.
- 하단 `관리자 조작` 영역은 좌측 `동의일(Actual)` + 저장, 우측 `사전 심사 요청 하기` + `미승인 / 승인 완료` 토글로 정리되어 있으며, 총무는 `allowance_date` 유무와 관계없이 trusted path 상태를 바꿀 수 있고 본부장은 같은 정보를 read-only로 본다.
- 생명/손해 위촉 탭은 `확정일(Actual)`을 총무가 직접 저장할 수 있는 `완료일 저장` trusted path와, 기존 `일정 저장`/`승인 완료`/`반려` 조작을 함께 제공한다. 직접 저장은 `/api/admin/fc`의 `updateAppointmentDate`로 처리하고, 저장 후 리스트/상세 상태는 `appointment-completed` 또는 `final-link-sent`로 보정한다.
- 한화 위촉 탭은 `완료일(FC 제출)` 확인, 승인 PDF 업로드/삭제, `FC 미전송 / FC 전송 완료` 조작을 담당하며 별도 `관리자 승인일` 입력 UI는 없습니다.
- 승인 PDF 카드의 `PDF 업로드 완료`와 승인 토글의 `FC 전송 완료`는 같은 의미가 아닙니다. 총무는 PDF를 올린 뒤에도 마지막으로 `FC 전송 완료`를 눌러야 FC 앱에서 파일을 받을 수 있습니다.
- 한화 PDF가 첨부되면 FC 앱 `hanwha-commission` 화면에서 상태가 `검토 중` 또는 `반려`여도 파일 자체는 열람/다운로드할 수 있습니다. 다만 생명/손해 위촉 단계 잠금 해제는 계속 `한화 승인 + PDF 등록` 기준입니다.
- 생명/손해 위촉 탭은 `생명 위촉 완료`, `손해 위촉 완료` 플래그를 독립 토글로 저장할 수 있고, 둘 다 꺼진 상태는 별도 버튼 없이 미완료로 본다.
- 3단계 라벨은 `한화 위촉 URL`, 4단계 라벨은 `생명/손해 위촉`으로 통일합니다.
- FC 삭제는 별도 파괴적 작업

## 사용자 액션

- 상태 변경
- 메모/기본정보 수정
- 요청 서류 설정
- 서류 승인/반려
- 한화 PDF 업로드/삭제
- 한화 승인/반려
- 생명/손해 완료 플래그 저장
- 생명/손해 위촉 완료일 직접 저장
- 위촉 일정/확정/반려
- resident number 조회

## 실패/예외

- schema drift 시 탭별 저장 실패 가능
- readOnly enforcement 누락은 즉시 회귀 취급

## 관련 운영 화면

- `/dashboard/referrals`
  - 추천코드 마스터 운영, 비활성 코드 이력, 레거시 추천인 검토 큐를 다룬다.
- `/dashboard/referrals/graph`
  - 구조화 추천 관계를 읽기 전용 graph로 탐색하는 화면이다.
  - visible edge는 `recommender_fc_id`를 기본 소스로 만들고, `confirmed attribution`은 같은 edge의 상태를 보강하는 보조 신호로만 겹친다.
  - manager는 진입/조회만 가능하고 mutation CTA는 노출하지 않는다.
  - graph는 Obsidian Graph View의 읽기 경험을 참고하되, 추천인 tree 가독성을 위해 hybrid force-directed 계약을 사용한다. 사용자에게 노출되는 조절값은 `Center force`, `Repel force`, `Link force`, `Link distance` 네 항목이며 localStorage key는 `referral-graph-physics-settings-v14`다.
  - layout seed는 connected component를 크기순으로 중앙에 가깝게 배치하고, hub direct child는 부모를 둘러싼 star/pinwheel 형태로 시작한다. isolated node는 과도하게 큰 outer ring을 만들지 않는 제한된 golden-angle 분포로 시작한다.
  - runtime은 d3 `charge`와 기존 `link` force를 기반으로 `link-tension`, `branch-bend`, `sibling-angular`, `node-separation`, `visual-cluster-separation`, `component-separation`, `cluster-envelope`, `component-envelope`, `cluster-gravity`, `drag-spring` 보조 force를 사용한다. 고정 반경 `radial-containment`, 강제 `isolated-ring`, release velocity, drop tether는 금지한다.
  - `cluster-gravity`는 전체를 원 안에 가두는 힘이 아니라 멀어진 cluster를 약하게 되돌리는 보정이다. 현재 중심 보정은 `deadZoneRadius=340`, singleton `520`, `strength=0.01` 수준이며, 사용자가 cluster를 바깥으로 끌어 보는 동작을 막으면 회귀다.
  - node drag 중에는 pointer 대상 노드만 임시 `fx/fy`로 고정하고, incident edge가 한없이 늘어나지 않도록 drag rope constraint가 연결 노드를 따라오게 한다. release는 `fx/fy` 해제와 simulation reheat를 수행하고 drop tether나 별도 관성 주입은 사용하지 않는다. 일반 상태에서는 이름만 보이고, 선택/검색 상태에서만 추천코드까지 확장한다.
  - `배치 초기화`는 hard-pin 해제가 아니라 runtime position을 지우고 component/star/orphan seed layout으로 다시 시작하는 동작이다.
  - 사용자 노출 copy는 기술 용어보다 쉬운 한국어를 우선한다. 범례/설명/버튼은 `추천인 연결`, `예전 기록 확인`, `화면 맞춤`, `본부장` 같은 운영자 친화 문구를 유지한다.
  - 본부장과 `김형수` 강조 노드는 노란색 fill + 주황색 테두리 + 큰 반지름을 사용한다. 이 강조는 presentation rule이며 edge source를 바꾸지 않는다.

## 2026-04-23 dashboard 운영 메모

- `/dashboard` root는 웹 푸시 설정이 없는 preview-safe 배포에서 등록 실패를 generic error로 숨기지 않고, “이 배포에는 웹 알림 설정이 없습니다” 상태를 보여준다.
- request-board 메신저 이동은 `NEXT_PUBLIC_REQUEST_BOARD_URL`이 설정된 경우에만 열고, 값이 없거나 잘못된 배포에서 production URL로 fallback하지 않는다.
- `/api/admin/fc`와 `/dashboard`는 resident-number full-view contract를 계속 trusted server path 기준으로 유지한다. direct decrypt가 빠진 런타임에서는 edge fallback/degraded 상태를 로그로 남기되, 권한 있는 사용자의 full-view 자체를 마스킹 정책으로 바꾸지 않는다.

## 연관 문서

- [../workflow-state-matrix.md](E:/hanhwa/fc-onboarding-app/docs/handbook/workflow-state-matrix.md)
- [../backend/admin-operations-api.md](E:/hanhwa/fc-onboarding-app/docs/handbook/backend/admin-operations-api.md)
