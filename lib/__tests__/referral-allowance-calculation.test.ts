import { calculateReferralAllowance, ReferralAllowanceValidationError } from '@/lib/referral-allowance-calculation';
import { REFERRAL_ALLOWANCE_MAX_PEOPLE, type ReferralAllowanceCalculationInput, type ReferralAllowancePersonInput } from '@/types/referral-allowance';

const person = (employeeCode: string, overrides: Partial<ReferralAllowancePersonInput> = {}): ReferralAllowancePersonInput => ({
  employeeCode, parentEmployeeCode: employeeCode === 'private-root' ? null : 'private-root',
  name: '가상 구성원', affiliation: '가상 조직', activeAtPerformance: true,
  activeAtBasisDate: true, rankAtBasisDate: 'FP', finalTargetPerformanceKrw: 0, ...overrides,
});
const input = (people: ReferralAllowancePersonInput[], overrides: Partial<ReferralAllowanceCalculationInput> = {}): ReferralAllowanceCalculationInput => ({
  performanceMonth: '2026-06', paymentDate: '2026-08-01', genealogyAsOf: '2026-07-31', sourceSnapshotDates: ['2026-07-29', '2026-08-24'],
  beneficiaryEmployeeCode: 'private-root', people, ...overrides,
});
const expectFailure = (value: ReferralAllowanceCalculationInput, code: string) => {
  try { calculateReferralAllowance(value); throw new Error('Expected validation to fail'); }
  catch (error) {
    expect(error).toBeInstanceOf(ReferralAllowanceValidationError);
    expect((error as ReferralAllowanceValidationError).code).toBe(code);
    expect((error as Error).message).toBe(code);
  }
};

describe('monthly recruitment allowance with the approved uploaded-snapshot pilot basis', () => {
  it('truncates each contributor before adding, excludes self and exposes no employee codes', () => {
    const result = calculateReferralAllowance(input([
      person('private-root', { finalTargetPerformanceKrw: 5000000 }),
      person('private-a', { finalTargetPerformanceKrw: 187000 }),
      person('private-b', { finalTargetPerformanceKrw: 191000 }),
    ]));
    expect(result.summary).toEqual({ currentMonthNetKrw: 20000, newPaymentKrw: 20000,
      carryForwardKrw: 0, extinguishedKrw: 0, excludedByEligibilityKrw: 0 });
    expect(result.nodes[0].contributionKrw).toBe(0);
    expect(result.previousCarryIncluded).toBe(false);
    expect(result.status).toBe('current_month_estimate');
    expect(result.eligibilityBasis).toBe('uploaded_snapshot');
    expect(result.policyVersion).toBe('recruitment-2026-09-07-snapshot-pilot-v1');
    expect(JSON.stringify(result)).not.toMatch(/private-root|private-a|private-b|employeeCode/);
  });

  it.each([
    [99999.99, 0], [100000, 10000], [100000.25, 10000],
    [-99999.99, 0], [-100000.25, -10000], [-187000, -10000], [0.29, 0],
  ])('preserves supplied target precision and truncates %s won toward zero to %s', (amount, expected) => {
    const result = calculateReferralAllowance(input([person('private-root'), person('private-a', { finalTargetPerformanceKrw: amount })]));
    expect(result.nodes[1].fpRoundedAmountKrw).toBe(expected);
    expect(result.summary.currentMonthNetKrw).toBe(expected);
  });

  it.each([
    [-900000, -90000, 0, -90000],
    [-1000000, -100000, -100000, 0],
    [-1100000, -110000, -110000, 0],
    [0, 0, 0, 0],
  ])('applies the negative threshold to the beneficiary net for target %s', (amount, net, carry, extinguished) => {
    const result = calculateReferralAllowance(input([person('private-root'), person('private-a', { finalTargetPerformanceKrw: amount })]));
    expect(result.summary).toEqual({ currentMonthNetKrw: net, newPaymentKrw: 0,
      carryForwardKrw: carry, extinguishedKrw: extinguished, excludedByEligibilityKrw: 0 });
  });

  it('nets signed contributions before extinguishing small negatives', () => {
    const result = calculateReferralAllowance(input([person('private-root'),
      person('private-a', { finalTargetPerformanceKrw: -1500000 }),
      person('private-b', { finalTargetPerformanceKrw: 600000 }),
    ]));
    expect(result.summary.currentMonthNetKrw).toBe(-90000);
    expect(result.summary.extinguishedKrw).toBe(-90000);
    expect(result.summary.carryForwardKrw).toBe(0);
  });

  it('uses exactly ten edges, preserves intermediate context and does not compound the rate', () => {
    const people = [person('private-root')];
    for (let depth = 1; depth <= 12; depth += 1) {
      people.push(person(`private-${depth}`, { parentEmployeeCode: depth === 1 ? 'private-root' : `private-${depth - 1}`,
        finalTargetPerformanceKrw: 100000, activeAtBasisDate: depth !== 3, rankAtBasisDate: depth === 4 ? 'ADMIN' : 'FP' }));
    }
    const result = calculateReferralAllowance(input(people));
    expect(result.nodes).toHaveLength(11);
    expect(result.nodes.map((node) => node.depth)).toEqual(Array.from({ length: 11 }, (_, index) => index));
    expect(result.nodes.slice(1).every((node) => node.contributionKrw === 10000)).toBe(true);
    expect(result.summary.currentMonthNetKrw).toBe(100000);
    expect(result.nodes[3].eligibleAtBasisDate).toBe(false);
    expect(result.nodes[4].eligibleAtBasisDate).toBe(false);
  });

  it('keeps inactive performance rows as context without attributing their own amount', () => {
    const result = calculateReferralAllowance(input([person('private-root'),
      person('private-a', { activeAtPerformance: false, finalTargetPerformanceKrw: 500000 }),
      person('private-b', { parentEmployeeCode: 'private-a', finalTargetPerformanceKrw: 200000 }),
    ]));
    expect(result.nodes[1]).toMatchObject({ fpRoundedAmountKrw: 50000, contributionKrw: 0 });
    expect(result.nodes[2]).toMatchObject({ depth: 2, contributionKrw: 20000, parentId: result.nodes[1].id });
    expect(result.validation.contributorCount).toBe(1);
  });

  it.each([{ activeAtBasisDate: false }, { rankAtBasisDate: 'MANAGER' }])('records an ineligible beneficiary amount in the exclusion bucket', (overrides) => {
    const result = calculateReferralAllowance(input([person('private-root', overrides), person('private-a', { finalTargetPerformanceKrw: 200000 })]));
    expect(result.beneficiary.eligibleAtBasisDate).toBe(false);
    expect(result.summary).toEqual({ currentMonthNetKrw: 20000, newPaymentKrw: 0,
      carryForwardKrw: 0, extinguishedKrw: 0, excludedByEligibilityKrw: 20000 });
  });

  it('keeps only the selected subtree and derives deterministic opaque IDs without mutating inputs', () => {
    const people = [person('private-root'), person('private-a'), person('private-b', { parentEmployeeCode: 'private-a' }),
      person('private-unrelated', { finalTargetPerformanceKrw: 999000 }),
    ];
    const original = JSON.stringify(people);
    const first = calculateReferralAllowance(input(people, { beneficiaryEmployeeCode: 'private-a' }));
    const second = calculateReferralAllowance(input([...people].reverse(), { beneficiaryEmployeeCode: 'private-a' }));
    expect(first).toEqual(second);
    expect(first.nodes).toHaveLength(2);
    expect(first.nodes[0].parentId).toBeNull();
    expect(JSON.stringify(people)).toBe(original);
  });

  it('conserves every signed contribution and summary bucket in synthetic branching trees', () => {
    const people = [person('private-root')];
    for (let index = 1; index < 200; index += 1) people.push(person(`private-${index}`, {
      parentEmployeeCode: index < 4 ? 'private-root' : `private-${Math.floor((index - 1) / 3)}`,
      finalTargetPerformanceKrw: (index % 7 - 3) * 187000 + .25, activeAtPerformance: index % 5 !== 0,
    }));
    const result = calculateReferralAllowance(input(people));
    const total = result.nodes.reduce((sum, node) => sum + node.contributionKrw, 0);
    const s = result.summary;
    expect(total).toBe(s.currentMonthNetKrw);
    expect(s.currentMonthNetKrw).toBe(s.newPaymentKrw + s.carryForwardKrw + s.extinguishedKrw + s.excludedByEligibilityKrw);
    expect(result.validation.conservationDifferenceKrw).toBe(0);
  });

  it('rejects duplicate, missing, self and cyclic parent relationships including unrelated branches', () => {
    expectFailure(input([person('private-root'), person('private-root')]), 'DUPLICATE_EMPLOYEE_CODE');
    expectFailure(input([person('private-root'), person('private-a', { parentEmployeeCode: 'missing' })]), 'MISSING_PARENT');
    expectFailure(input([person('private-root', { parentEmployeeCode: 'private-root' })]), 'CYCLE');
    expectFailure(input([person('private-root'), person('private-a', { parentEmployeeCode: 'private-b' }),
      person('private-b', { parentEmployeeCode: 'private-a' })]), 'CYCLE');
  });

  it('rejects missing flags, unsafe keys, absent beneficiary and an oversized import', () => {
    expectFailure(input([person('private-root', { activeAtBasisDate: undefined as unknown as boolean })]), 'INVALID_PERSON');
    expectFailure(input([person('private-root', { parentEmployeeCode: undefined as unknown as null })]), 'INVALID_EMPLOYEE_CODE');
    expectFailure(input([person('private-root')], { beneficiaryEmployeeCode: ' missing ' }), 'INVALID_EMPLOYEE_CODE');
    expectFailure(input([person('private-root')], { beneficiaryEmployeeCode: 'missing' }), 'BENEFICIARY_NOT_FOUND');
    expectFailure(input(Array(REFERRAL_ALLOWANCE_MAX_PEOPLE + 1).fill(person('private-root'))), 'PEOPLE_LIMIT');
  });

  it('validates calendar dates, the M+2 schedule and the operator reference date', () => {
    expectFailure(input([person('private-root')], { performanceMonth: '2026-13' }), 'INVALID_MONTH');
    expectFailure(input([person('private-root')], { paymentDate: '2026-02-30' }), 'INVALID_DATE');
    expectFailure(input([person('private-root')], { paymentDate: '2026-07-26' }), 'PAYMENT_MONTH_MISMATCH');
    expectFailure(input([person('private-root')], { genealogyAsOf: '2026-08-02' }), 'GENEALOGY_DATE_MISMATCH');
    expectFailure(input([person('private-root')], { genealogyAsOf: '2026-06-30T00:00:00Z' }), 'INVALID_DATE');
    expect(calculateReferralAllowance(input([person('private-root')], {
      performanceMonth: '2025-12', paymentDate: '2026-02-28', genealogyAsOf: '2026-01-31', sourceSnapshotDates: ['2026-01-31'],
    })).performanceMonth).toBe('2025-12');
  });

  it.each([['2024-02', '2024-02-29', '2024-04-01'], ['2026-02', '2026-02-28', '2026-04-01']])('accepts valid reference-date calendars for %s', (performanceMonth, genealogyAsOf, paymentDate) => {
    expect(calculateReferralAllowance(input([person('private-root')], { performanceMonth, genealogyAsOf, paymentDate })).genealogyAsOf).toBe(genealogyAsOf);
    expect(calculateReferralAllowance(input([person('private-root')], { performanceMonth, genealogyAsOf: `${performanceMonth}-27`, paymentDate })).genealogyAsOf).toBe(`${performanceMonth}-27`);
  });

  it('preserves actual source dates independently of the reference date and flags later snapshots', () => {
    const sourceSnapshotDates = ['2026-08-24', '2026-07-29', '2026-08-24'];
    const result = calculateReferralAllowance(input([person('private-root')], { sourceSnapshotDates }));
    expect(result.sourceSnapshotDates).toEqual(['2026-07-29', '2026-08-24']);
    expect(result.genealogyAsOf).toBe('2026-07-31');
    expect(result.usesLaterSnapshot).toBe(true);
    expect(sourceSnapshotDates).toEqual(['2026-08-24', '2026-07-29', '2026-08-24']);
    expect(calculateReferralAllowance(input([person('private-root')], { sourceSnapshotDates: ['2026-07-29', '2026-07-31'] })).usesLaterSnapshot).toBe(false);
    expectFailure(input([person('private-root')], { sourceSnapshotDates: [] }), 'INVALID_SNAPSHOT_DATES');
    expectFailure(input([person('private-root')], { sourceSnapshotDates: undefined as unknown as string[] }), 'INVALID_SNAPSHOT_DATES');
    expectFailure(input([person('private-root')], { sourceSnapshotDates: Array(65).fill('2026-07-31') }), 'INVALID_SNAPSHOT_DATES');
    expectFailure(input([person('private-root')], { sourceSnapshotDates: ['2026-02-30'] }), 'INVALID_DATE');
  });

  it.each([NaN, Infinity, -Infinity, .001, '100000' as unknown as number])('rejects nonfinite, string or unsupported precision targets', (amount) => {
    expectFailure(input([person('private-root', { finalTargetPerformanceKrw: amount })]), 'INVALID_MONEY');
  });

  it('rejects monetary precision overflow and an unsafe aggregate without exposing input data', () => {
    expectFailure(input([person('private-root', { finalTargetPerformanceKrw: Number.MAX_SAFE_INTEGER })]), 'UNSAFE_MONEY');
    const people = [person('private-root')];
    for (let index = 0; index < 1001; index += 1) people.push(person(`private-${index}`, { finalTargetPerformanceKrw: 90000000000000 }));
    expectFailure(input(people), 'UNSAFE_TOTAL');
  });
});
