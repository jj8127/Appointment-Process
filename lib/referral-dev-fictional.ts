/**
 * 개발용 앱에서만 쓰는 가상 추천 조직·수당 데이터(실제 사람·금액 아님).
 * `__DEV__`이고 EXPO_PUBLIC_REFERRAL_FICTIONAL=1 로 Metro를 띄웠을 때만 켜진다. 정식 빌드에서는 항상 꺼진다.
 */
import { REFERRAL_ALLOWANCE_MAX_DEPTH, REFERRAL_ALLOWANCE_POLICY_VERSION } from '@/types/referral-allowance';
import type { ReferralAllowanceNode } from '@/types/referral-allowance';
import type { ReferralGraphResponse } from '@/types/referral-graph';

declare const __DEV__: boolean | undefined;

export const REFERRAL_FICTIONAL_DATA = typeof __DEV__ !== 'undefined' && __DEV__
  && process.env.EXPO_PUBLIC_REFERRAL_FICTIONAL === '1';

const MONTHS = ['2026-06', '2026-07', '2026-08'] as const;
const FAMILY = ['가상김', '가상이', '가상박', '가상최', '가상정', '가상강', '가상조', '가상윤', '가상장', '가상임'];
const GIVEN = ['하늘', '바다', '구름', '별빛', '나무', '바람', '노을', '새벽', '들판', '여울', '가람', '보라'];

type Person = { id: string; parentId: string | null; depth: number; name: string };

function rng(seed: number) {
  return () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
}

/** 나(뿌리) 아래 5단계까지 약 150명 */
function fictionalPeople(): Person[] {
  const next = rng(20261018);
  const people: Person[] = [{ id: 'fic-0', parentId: null, depth: 0, name: '가상 나' }];
  const grow = (parent: Person) => {
    if (parent.depth >= 5 || people.length >= 150) return;
    const count = parent.depth === 0 ? 8 : Math.floor(next() * (parent.depth <= 2 ? 5 : 3));
    for (let i = 0; i < count && people.length < 150; i += 1) {
      const n = people.length;
      const child = { id: `fic-${n}`, parentId: parent.id, depth: parent.depth + 1,
        name: `${FAMILY[n % FAMILY.length]}${GIVEN[Math.floor(n / FAMILY.length) % GIVEN.length]}` };
      people.push(child);
      grow(child);
    }
  };
  grow(people[0]);
  return people;
}

export function fictionalReferralGraph(): ReferralGraphResponse {
  const people = fictionalPeople();
  const children = new Map<string, Person[]>();
  for (const p of people) if (p.parentId) children.set(p.parentId, [...(children.get(p.parentId) ?? []), p]);
  const descendants = (id: string): number => (children.get(id) ?? []).reduce((sum, c) => sum + 1 + descendants(c.id), 0);
  return {
    ok: true,
    mode: 'graph',
    nodes: people.map((p, i) => ({
      id: p.id, name: p.name, affiliation: '가상 지점', activeCode: i % 4 === 0 ? null : `FIC${String(i).padStart(4, '0')}`,
      nodeStatus: i % 4 === 0 ? 'missing_code' : 'has_active_code', signupCompleted: i % 3 !== 0, allCommissionsCompleted: i % 3 === 2,
      directInviteeCount: children.get(p.id)?.length ?? 0, totalDescendantCount: descendants(p.id), isViewer: p.parentId === null,
    })),
    edges: people.filter((p) => p.parentId).map((p) => ({ id: `${p.parentId}__${p.id}`, source: p.parentId!, target: p.id })),
    permissions: { canMutate: false, scope: 'downline', rootFcId: 'fic-0' },
    truncated: false,
  };
}

function fictionalStatement(month: string) {
  const people = fictionalPeople();
  const next = rng(Number(month.replace('-', '')));
  const nodes: ReferralAllowanceNode[] = people.map((p) => {
    // 실적: 대부분 양수, 일부 환수(음수). 수당 = 10%를 만원 단위로 절사
    const performance = p.depth === 0 ? 0 : Math.round((next() < 0.08 ? -1 : 1) * (200000 + next() * 4800000));
    const rounded = Math.trunc(performance / 10 / 10000) * 10000;
    return { id: p.id, parentId: p.parentId, depth: p.depth, name: p.name, affiliation: '가상 지점', isBeneficiary: p.depth === 0,
      activeAtPerformance: true, eligibleAtBasisDate: true, finalTargetPerformanceKrw: performance,
      fpRoundedAmountKrw: rounded, contributionKrw: p.depth === 0 ? 0 : rounded };
  });
  const net = nodes.reduce((sum, n) => sum + n.contributionKrw, 0);
  return {
    schemaVersion: 1, policyVersion: REFERRAL_ALLOWANCE_POLICY_VERSION, performanceMonth: month,
    paymentDate: `${month}-25`, genealogyAsOf: `${month}-01`, sourceSnapshotDates: [`${month}-01`], usesLaterSnapshot: false,
    eligibilityBasis: 'uploaded_snapshot', status: 'current_month_estimate', previousCarryIncluded: false,
    beneficiary: { nodeId: 'fic-0', name: '가상 나', eligibleAtBasisDate: true }, nodes,
    summary: { currentMonthNetKrw: net, newPaymentKrw: net, carryForwardKrw: 0, extinguishedKrw: 0, excludedByEligibilityKrw: 0 },
    validation: { visiblePeopleCount: nodes.length, contributorCount: nodes.filter((n) => n.contributionKrw !== 0).length,
      maximumDepth: REFERRAL_ALLOWANCE_MAX_DEPTH, conservationDifferenceKrw: 0 },
  };
}

/** get-my-referral-allowance 응답 모양 그대로(검증기를 그대로 통과해야 한다) */
export function fictionalAllowanceResponse(action: 'access' | 'statement', month?: string) {
  const availableMonths = [...MONTHS].reverse();
  if (action === 'access') return { ok: true, enabled: true, availableMonths };
  return { ok: true, enabled: true, availableMonths, statement: fictionalStatement(month ?? availableMonths[0]) };
}
