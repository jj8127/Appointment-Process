doc_id: FC-ADMIN-DASHBOARD-LIFECYCLE
owner_repo: fc-onboarding-app
owner_area: admin-web
audience: operator, developer
last_verified: 2026-04-02
source_of_truth: web/src/app/dashboard/page.tsx + web/src/app/dashboard/profile/[id]/page.tsx + web/src/app/api/admin/fc/route.ts + web/src/lib/shared.ts

# Admin Web Playbook: Dashboard Lifecycle

## 목적

- FC lifecycle 운영의 메인 콘솔

## 진입 경로

- `/dashboard`
- `/dashboard/profile/[id]`

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
- FC 상세 모달은 `수당 동의 / 서류 관리 / 한화 위촉 / 생명/손해 위촉` 4탭 구조
- FC 상세 모달 헤더는 `/api/admin/resident-numbers` trusted path를 통해 주민등록번호 full-view와 생년월일을 바로 보여준다. 실패 시 masked fallback으로 돌리지 않고 조회 실패를 그대로 표시한다.
- `/dashboard` 모달과 `/dashboard/profile/[id]` resident-number fetch는 같은 trusted web contract를 공유해야 하며, 한쪽만 별도 로직으로 고치고 다른 쪽을 남기는 변경은 회귀로 본다.
- `/dashboard/profile/[id]`는 브라우저 anon Supabase client로 `fc_profiles`를 직접 읽지 않는다. 상세 기본정보와 `fc_documents`는 `/api/admin/fc`의 read-only `getProfile` action을 통해 service-role 서버 경로에서 조회해야 하며, singular-query `406`을 브라우저가 직접 받는 구현은 회귀로 본다.
- FC 상세 모달과 `/dashboard/profile/[id]`는 `추천인` 아래에 invitee의 `가입 시 사용한 추천코드`를 함께 표시한다. confirmed attribution의 historical code가 우선이고, 그것이 없을 때만 inviter 현재 활성 코드 또는 구조화 링크 fallback을 사용하며, 모두 없으면 `-`로 유지한다.
- temp-id, allowance, docs, hanwha, appointment, commission flag가 서로 상태 합성에 영향
- 수당동의 탭은 상단 `상태 흐름`을 `임시사번`보다 먼저 배치해 현재 파생 상태를 먼저 읽게 하고, 현재 카드만 연한 주황색으로 강조한다.
- 하단 `관리자 조작` 영역은 좌측 `동의일(Actual)` + 저장, 우측 `사전 심사 요청 하기` + `미승인 / 승인 완료` 토글로 정리되어 있으며, 총무는 `allowance_date` 유무와 관계없이 trusted path 상태를 바꿀 수 있고 본부장은 같은 정보를 read-only로 본다.
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
  - graph는 node drag, 빈 공간 pan, fit/reset, 기본 node label 표시를 지원해야 한다.

## 연관 문서

- [../workflow-state-matrix.md](E:/hanhwa/fc-onboarding-app/docs/handbook/workflow-state-matrix.md)
- [../backend/admin-operations-api.md](E:/hanhwa/fc-onboarding-app/docs/handbook/backend/admin-operations-api.md)
