# Product Spec

## Task Summary
- 관리자 웹 `/dashboard/referrals/graph`의 추천인 그래프를 live 운영자가 읽기 쉬운 cluster-oriented force layout으로 유지한다.
- 기존 `react-force-graph-2d` + `d3-force`, 밝은 관리자 웹 테마, API/DB/response shape는 유지한다.
- 사용자-facing 설정은 `Center force`, `Repel force`, `Link force`, `Link distance` 네 항목만 노출하되, 추천인 tree 가독성을 위해 runtime helper force를 명시적으로 관리한다.

## User Outcomes
- 큰 connected cluster는 중앙에 가깝고, 작은 cluster와 isolated node는 주변부에 자연스럽게 분포한다.
- 같은 추천인 cluster의 노드들은 서로 가까운 읽기 단위로 보이고, 다른 cluster와 edge/label이 섞여 혼동되지 않는다.
- 부모의 direct children은 부모 주변에서 star/pinwheel 형태로 퍼지고, 자식을 가진 child는 자기 subtree를 펼칠 edge 공간을 받는다.
- 노드를 드래그할 때 incident edge가 한없이 늘어나지 않고 연결 노드가 함께 따라오며, 잡고 있는 동안 강한 진동이나 중심 snap-back이 없어야 한다.
- 이름 label, 검색, 필터, 드로어, 화면 맞춤, 배치 초기화, isolated toggle은 유지된다.

## Implementation Shape
- `web/src/lib/referral-graph-layout.ts`
  - component 크기순으로 초기 위치를 배치하고 큰 component를 중앙에 가깝게 둔다.
  - hub direct child는 부모 주변 star/pinwheel seed를 받는다.
  - isolated node는 과도하게 큰 outer ring을 만들지 않는 제한된 golden-angle seed를 받는다.
- `web/src/lib/referral-graph-physics.ts`
  - public slider 값을 d3 charge/link 계수와 helper force 값으로 매핑한다.
  - dynamic link distance, link tension, branch bend, sibling angular separation, node separation, visual cluster separation, component separation, cluster/component envelope, weak cluster gravity, drag rope constraint를 제공한다.
  - 금지된 힘: 고정 반경 `radial-containment`, 강제 `isolated-ring`, release velocity injection, drop tether.
- `web/src/components/referrals/ReferralGraphCanvas.tsx`
  - 기존 internal link force를 설정하고, helper force들을 명시적으로 등록한다.
  - `d3AlphaMin={0}`, `cooldownTicks={Infinity}`, `cooldownTime={Infinity}`로 simulation force가 계속 적용되게 한다.
  - drag 중 pointer 대상 노드만 `fx/fy`로 고정하고, drag rope constraint가 incident edge stretch를 제한한다.
- `web/src/app/dashboard/referrals/graph/page.tsx`
  - slider 범위와 persisted storage key `referral-graph-physics-settings-v14`를 관리한다.

## Key Constraints
- API/DB/schema 변경 없음.
- `GraphApiResponse`, `GraphNode`, `GraphEdge` shape 변경 없음.
- 이름 label 상시 표시와 기존 강조 presentation rule 유지.
- docs/QA는 실패한 검증을 pass로 기록하지 않는다.

## Verification Targets
- Unit/helper:
  - `node --experimental-strip-types --test web/src/lib/referral-graph-physics.test.ts`
  - `node --experimental-strip-types --test web/src/lib/referral-graph-simulation.test.ts`
- Lint:
  - `cd web && npm run lint -- src/components/referrals/ReferralGraphCanvas.tsx src/app/dashboard/referrals/graph/page.tsx src/lib/referral-graph-physics.ts src/lib/referral-graph-layout.ts src/lib/referral-graph-simulation.test.ts src/types/referral-graph.ts src/types/d3-force.d.ts`
- Browser QA on `/dashboard/referrals/graph`:
  - no Next overlay, no console/page error, nonblank canvas
  - cluster separation, no oversized isolated outer circle, stable drag without long edge stretch
