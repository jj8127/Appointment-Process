import { calculateReferralAllowance } from '@/lib/referral-allowance-calculation';
import { buildReferralAllowanceNodeAmounts, formatReferralAllowancePerformanceKrw } from '@/lib/referral-allowance-display';
import { parseReferralAllowanceResponse } from '@/lib/referral-allowance-response';
import { REFERRAL_ALLOWANCE_MAX_PEOPLE, type ReferralAllowancePersonInput, type ReferralAllowanceStatement } from '@/types/referral-allowance';

const person = (employeeCode: string, overrides: Partial<ReferralAllowancePersonInput> = {}): ReferralAllowancePersonInput => ({
  employeeCode, parentEmployeeCode: employeeCode === 'fictional-root' ? null : 'fictional-root',
  name: '가상 구성원', affiliation: '가상 조직', activeAtPerformance: true, activeAtBasisDate: true,
  rankAtBasisDate: 'FP', finalTargetPerformanceKrw: 0, ...overrides,
});
const snapshot = (people = [person('fictional-root'), person('fictional-child', { finalTargetPerformanceKrw: 200000.25 })]) =>
  calculateReferralAllowance({ performanceMonth: '2026-06', paymentDate: '2026-08-01', genealogyAsOf: '2026-07-31',
    sourceSnapshotDates: ['2026-07-29', '2026-08-24'], beneficiaryEmployeeCode: 'fictional-root', people });
const response = (statement: unknown = snapshot()) => ({ ok: true, enabled: true, availableMonths: ['2026-06'], statement });
const expectInvalid = (value: unknown) => expect(() => parseReferralAllowanceResponse(value, 'statement'))
  .toThrow('수당 조회 응답을 확인하지 못했습니다. 다시 시도해주세요.');

describe('allowance response boundary before rendering', () => {
  it('accepts access, disabled and published-month empty responses', () => {
    expect(parseReferralAllowanceResponse({ ok: true, enabled: false }, 'statement')).toEqual({ ok: true, enabled: false });
    expect(parseReferralAllowanceResponse({ ok: true, enabled: true, availableMonths: [] }, 'access').enabled).toBe(true);
    expect(parseReferralAllowanceResponse(response(null), 'statement').statement).toBeNull();
  });

  it.each([null, undefined, [], false, { enabled: true }, { ok: false, enabled: false }, { ok: true, enabled: 'yes' }])
  ('rejects an invalid response envelope (%#)', (value) => expectInvalid(value));

  it.each([undefined, {}, ['2026-13'], [202606], ['2026-06', '2026-06'], Array(121).fill('2026-06')].map((availableMonths) => ({ availableMonths })))
  ('rejects invalid, duplicate or unbounded available months (%#)', ({ availableMonths }) => {
    expectInvalid({ ...response(), availableMonths });
  });

  it('requires the requested statement field and month to agree', () => {
    expectInvalid({ ok: true, enabled: true, availableMonths: [] });
    expect(() => parseReferralAllowanceResponse(response(), 'statement', '2026-05')).toThrow();
    expectInvalid({ ...response(), availableMonths: ['2026-05'] });
  });

  it.each(['nodes', 'beneficiary', 'summary', 'validation', 'sourceSnapshotDates'])
  ('stops a missing %s before the page accesses it', (field) => {
    const value = { ...snapshot(), [field]: undefined };
    expectInvalid(response(value));
  });

  it.each(['schemaVersion', 'policyVersion', 'paymentDate', 'genealogyAsOf', 'usesLaterSnapshot', 'status', 'eligibilityBasis', 'previousCarryIncluded'])
  ('rejects an invalid statement %s', (field) => expectInvalid(response({ ...snapshot(), [field]: {} })));

  it.each([[], ['2026-02-30'], [{}], Array(65).fill('2026-07-31')].map((sourceSnapshotDates) => ({ sourceSnapshotDates })))
  ('requires bounded, real calendar snapshot dates (%#)', ({ sourceSnapshotDates }) => {
    expectInvalid(response({ ...snapshot(), sourceSnapshotDates }));
  });

  it('rejects object names and missing node fields that React or graph rendering cannot use', () => {
    const value = snapshot();
    expectInvalid(response({ ...value, beneficiary: { ...value.beneficiary, name: {} } }));
    for (const field of ['id', 'parentId', 'depth', 'name', 'affiliation', 'isBeneficiary', 'activeAtPerformance', 'eligibleAtBasisDate']) {
      expectInvalid(response({ ...value, nodes: [value.nodes[0], { ...value.nodes[1], [field]: undefined }] }));
    }
  });

  it.each([NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 1.5, '10000'])
  ('rejects unsafe or nonintegral signed allowance values (%#)', (amount) => {
    const value = snapshot();
    for (const field of ['contributionKrw', 'fpRoundedAmountKrw']) {
      expectInvalid(response({ ...value, nodes: [value.nodes[0], { ...value.nodes[1], [field]: amount }] }));
    }
    expectInvalid(response({ ...value, summary: { ...value.summary, newPaymentKrw: amount } }));
  });

  it('stops unsupported performance before opening an FP detail throws', () => {
    const value = snapshot();
    const badNode = { ...value.nodes[1], finalTargetPerformanceKrw: 1e12 + 1 };
    expect(() => formatReferralAllowancePerformanceKrw(badNode.finalTargetPerformanceKrw)).toThrow();
    expectInvalid(response({ ...value, nodes: [value.nodes[0], badNode] }));
    expectInvalid(response({ ...value, nodes: [value.nodes[0], { ...badNode, finalTargetPerformanceKrw: NaN }] }));
  });

  it.each([
    (value: ReferralAllowanceStatement) => { value.nodes[1].id = value.nodes[0].id; },
    (value: ReferralAllowanceStatement) => { value.nodes[1].parentId = 'missing'; },
    (value: ReferralAllowanceStatement) => { value.nodes[1].parentId = value.nodes[1].id; },
    (value: ReferralAllowanceStatement) => { value.nodes[1].parentId = null; },
    (value: ReferralAllowanceStatement) => { value.nodes[1].depth = 0; },
    (value: ReferralAllowanceStatement) => { value.nodes[1].depth = 11; },
    (value: ReferralAllowanceStatement) => { value.nodes[1].isBeneficiary = true; },
    (value: ReferralAllowanceStatement) => { value.nodes[0].isBeneficiary = false; },
    (value: ReferralAllowanceStatement) => { value.beneficiary.nodeId = 'missing'; },
    (value: ReferralAllowanceStatement) => { value.validation.visiblePeopleCount = 3; },
    (value: ReferralAllowanceStatement) => { value.validation.contributorCount = 2; },
  ])('rejects inconsistent or cyclic graph topology and counts (%#)', (damage) => {
    const value = snapshot();
    damage(value);
    expectInvalid(response(value));
  });

  it('rejects missing or oversized graphs', () => {
    expectInvalid(response({ ...snapshot(), nodes: [] }));
    expectInvalid(response({ ...snapshot(), nodes: Array(REFERRAL_ALLOWANCE_MAX_PEOPLE + 1).fill(snapshot().nodes[0]) }));
  });

  it('checks signed conservation without recalculating the published compensation policy', () => {
    const value = snapshot();
    expectInvalid(response({ ...value, summary: { ...value.summary, currentMonthNetKrw: 0 } }));
    expectInvalid(response({ ...value, summary: { ...value.summary, extinguishedKrw: -1 } }));
  });

  it('rejects an overflowing branch even when positive and negative branches cancel in the final net', () => {
    const value = snapshot([person('fictional-root'), person('fictional-a'), person('fictional-b'), person('fictional-c')]);
    const amounts = [0, Number.MAX_SAFE_INTEGER, 1, -1];
    value.nodes.forEach((node, index) => { node.contributionKrw = amounts[index]; });
    value.summary.currentMonthNetKrw = Number.MAX_SAFE_INTEGER;
    value.summary.newPaymentKrw = Number.MAX_SAFE_INTEGER;
    value.validation.contributorCount = 3;
    // The guard also checks intermediate root additions, not just safely signed individual rows.
    expectInvalid(response(value));

    value.nodes[2].parentId = value.nodes[1].id;
    value.nodes[2].depth = 2;
    expect(() => buildReferralAllowanceNodeAmounts(value)).toThrow();
    expectInvalid(response(value));
  });

  it.each([0, 0.29, 100000.25, -900000, -1000000, 1e12, -1e12])
  ('accepts genuine calculator snapshots with signed target %s without changing data', (finalTargetPerformanceKrw) => {
    const value = response(snapshot([person('fictional-root'), person('fictional-child', { finalTargetPerformanceKrw })]));
    const before = JSON.stringify(value);
    expect(parseReferralAllowanceResponse(value, 'statement', '2026-06')).toBe(value);
    expect(JSON.stringify(value)).toBe(before);
    expect(() => buildReferralAllowanceNodeAmounts(value.statement as ReferralAllowanceStatement)).not.toThrow();
  });

  it('accepts a one-person graph, inactive context, ineligible beneficiary and later snapshot flags', () => {
    const examples = [
      snapshot([person('fictional-root')]),
      snapshot([person('fictional-root'), person('fictional-child', { activeAtPerformance: false, finalTargetPerformanceKrw: 200000 })]),
      snapshot([person('fictional-root', { activeAtBasisDate: false }), person('fictional-child', { finalTargetPerformanceKrw: -200000 })]),
    ];
    for (const value of examples) {
      expect(value.usesLaterSnapshot).toBe(true);
      expect(parseReferralAllowanceResponse(response(value), 'statement').statement).toBe(value);
    }
  });

  it('accepts the existing 10,000-person and ten-level operational limits', () => {
    const wide = Array.from({ length: REFERRAL_ALLOWANCE_MAX_PEOPLE }, (_, index) => person(index === 0 ? 'fictional-root' : `fictional-${index}`));
    expect(parseReferralAllowanceResponse(response(snapshot(wide)), 'statement').statement?.nodes).toHaveLength(REFERRAL_ALLOWANCE_MAX_PEOPLE);
    const deep = [person('fictional-root')];
    for (let depth = 1; depth <= 10; depth += 1) deep.push(person(`fictional-${depth}`, {
      parentEmployeeCode: depth === 1 ? 'fictional-root' : `fictional-${depth - 1}`,
    }));
    expect(parseReferralAllowanceResponse(response(snapshot(deep)), 'statement').statement?.nodes).toHaveLength(11);
  });

  it('never includes payload text in validation errors', () => {
    const value = snapshot();
    value.beneficiary.name = 'fictional-sensitive-marker';
    try {
      parseReferralAllowanceResponse(response(value), 'statement');
      throw new Error('Expected invalid response');
    } catch (error) {
      expect((error as Error).message).toBe('수당 조회 응답을 확인하지 못했습니다. 다시 시도해주세요.');
    }
  });
});
