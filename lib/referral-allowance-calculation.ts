import {
  REFERRAL_ALLOWANCE_MAX_DEPTH,
  REFERRAL_ALLOWANCE_MAX_PEOPLE,
  REFERRAL_ALLOWANCE_POLICY_VERSION,
  type ReferralAllowanceCalculationInput,
  type ReferralAllowanceNode,
  type ReferralAllowancePersonInput,
  type ReferralAllowanceStatement,
} from '../types/referral-allowance';

export type ReferralAllowanceValidationCode =
  | 'INVALID_INPUT' | 'INVALID_MONTH' | 'INVALID_DATE' | 'PAYMENT_MONTH_MISMATCH'
  | 'INVALID_SNAPSHOT_DATES' | 'GENEALOGY_DATE_MISMATCH' | 'PEOPLE_LIMIT' | 'INVALID_PERSON' | 'INVALID_EMPLOYEE_CODE'
  | 'DUPLICATE_EMPLOYEE_CODE' | 'MISSING_PARENT' | 'CYCLE' | 'BENEFICIARY_NOT_FOUND'
  | 'INVALID_MONEY' | 'UNSAFE_MONEY' | 'UNSAFE_TOTAL';

/** Safe to surface in an import preview: never embeds names, employee codes or amounts. */
export class ReferralAllowanceValidationError extends Error {
  readonly code: ReferralAllowanceValidationCode;
  readonly rowIndex?: number;

  constructor(code: ReferralAllowanceValidationCode, rowIndex?: number) {
    super(code);
    this.name = 'ReferralAllowanceValidationError';
    this.code = code;
    this.rowIndex = rowIndex;
  }
}

function fail(code: ReferralAllowanceValidationCode, rowIndex?: number): never {
  throw new ReferralAllowanceValidationError(code, rowIndex);
}
const SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);
const HUNDRED = BigInt(100);
const TEN_THOUSAND = BigInt(10000);
// target hundredths / 10,000,000 = target won * 10% / 10,000 won.
const CONTRIBUTION_DIVISOR = BigInt(10000000);
const abs = (value: bigint) => value < BigInt(0) ? -value : value;

function validCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value);
}

function validText(value: unknown, max: number, allowEmpty = false): value is string {
  return typeof value === 'string' && value.length <= max && (allowEmpty || value.trim().length > 0)
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function validateDate(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('INVALID_DATE');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) fail('INVALID_DATE');
}

/**
 * Preserve up to two supplied fractional won digits, without rounding the target.
 * This is an exact input precision limit, not an additional compensation policy.
 * Targets with more precision need explicit normalization by the approved source.
 */
function targetHundredths(value: unknown, rowIndex: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail('INVALID_MONEY', rowIndex);
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) fail('INVALID_MONEY', rowIndex);
  const magnitude = BigInt(match[2]) * HUNDRED + BigInt((match[3] ?? '').padEnd(2, '0') || '0');
  if (magnitude > SAFE_INTEGER) fail('UNSAFE_MONEY', rowIndex);
  return match[1] ? -magnitude : magnitude;
}

const outputMoney = (value: bigint) => {
  if (abs(value) > SAFE_INTEGER) fail('UNSAFE_TOTAL');
  return Number(value);
};

export function isReferralAllowanceBasisDateEligible(person: Pick<ReferralAllowancePersonInput, 'activeAtBasisDate' | 'rankAtBasisDate'>) {
  return person.activeAtBasisDate && person.rankAtBasisDate === 'FP';
}

/**
 * Computes one beneficiary's current-month estimate from approved normalized inputs.
 * Performs no insurer classification, prior-carry application, publishing or payment.
 */
export function calculateReferralAllowance(input: ReferralAllowanceCalculationInput): ReferralAllowanceStatement {
  if (!input || typeof input !== 'object') fail('INVALID_INPUT');
  if (typeof input.performanceMonth !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.performanceMonth)) fail('INVALID_MONTH');
  validateDate(input.paymentDate);
  validateDate(input.genealogyAsOf);
  const monthIndex = (value: string) => Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7)) - 1;
  if (monthIndex(input.paymentDate) !== monthIndex(input.performanceMonth) + 2) fail('PAYMENT_MONTH_MISMATCH');
  if (input.genealogyAsOf > input.paymentDate) fail('GENEALOGY_DATE_MISMATCH');
  if (!Array.isArray(input.sourceSnapshotDates) || input.sourceSnapshotDates.length === 0 || input.sourceSnapshotDates.length > 64) fail('INVALID_SNAPSHOT_DATES');
  for (const date of input.sourceSnapshotDates) validateDate(date);
  const sourceSnapshotDates = [...new Set(input.sourceSnapshotDates)].sort();
  if (!Array.isArray(input.people) || input.people.length === 0 || input.people.length > REFERRAL_ALLOWANCE_MAX_PEOPLE) fail('PEOPLE_LIMIT');
  if (!validCode(input.beneficiaryEmployeeCode)) fail('INVALID_EMPLOYEE_CODE');

  const byCode = new Map<string, ReferralAllowancePersonInput>();
  const contributions = new Map<string, bigint>();
  const rowIndexes = new Map<string, number>();
  for (let rowIndex = 0; rowIndex < input.people.length; rowIndex += 1) {
    const person = input.people[rowIndex];
    if (!person || typeof person !== 'object') fail('INVALID_PERSON', rowIndex);
    if (!validCode(person.employeeCode) || (person.parentEmployeeCode !== null && !validCode(person.parentEmployeeCode))) fail('INVALID_EMPLOYEE_CODE', rowIndex);
    if (byCode.has(person.employeeCode)) fail('DUPLICATE_EMPLOYEE_CODE', rowIndex);
    if (!validText(person.name, 120) || !validText(person.affiliation, 200, true)
      || !validText(person.rankAtBasisDate, 64) || person.rankAtBasisDate !== person.rankAtBasisDate.trim()
      || typeof person.activeAtPerformance !== 'boolean' || typeof person.activeAtBasisDate !== 'boolean') fail('INVALID_PERSON', rowIndex);
    const amount = targetHundredths(person.finalTargetPerformanceKrw, rowIndex);
    contributions.set(person.employeeCode, (amount / CONTRIBUTION_DIVISOR) * TEN_THOUSAND);
    byCode.set(person.employeeCode, person);
    rowIndexes.set(person.employeeCode, rowIndex);
  }
  const beneficiary = byCode.get(input.beneficiaryEmployeeCode);
  if (!beneficiary) fail('BENEFICIARY_NOT_FOUND');
  const children = new Map<string, string[]>();
  for (const person of input.people) {
    if (person.parentEmployeeCode === null) continue;
    if (!byCode.has(person.parentEmployeeCode)) fail('MISSING_PARENT', rowIndexes.get(person.employeeCode));
    const siblings = children.get(person.parentEmployeeCode) ?? [];
    siblings.push(person.employeeCode);
    children.set(person.parentEmployeeCode, siblings);
  }
  for (const siblings of children.values()) siblings.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);

  // Iterative whole-input validation avoids recursion overflow and hides no invalid branch.
  const completed = new Set<string>();
  for (const person of input.people) {
    const path = new Set<string>();
    let current: string | null = person.employeeCode;
    while (current !== null && !completed.has(current)) {
      if (path.has(current)) fail('CYCLE', rowIndexes.get(current));
      path.add(current);
      current = byCode.get(current)!.parentEmployeeCode;
    }
    for (const code of path) completed.add(code);
  }

  const nodes: ReferralAllowanceNode[] = [];
  const queue: { employeeCode: string; parentId: string | null; depth: number }[] = [
    { employeeCode: beneficiary.employeeCode, parentId: null, depth: 0 },
  ];
  let currentMonthNet = BigInt(0);
  let contributorCount = 0;
  for (let index = 0; index < queue.length; index += 1) {
    const item = queue[index];
    const person = byCode.get(item.employeeCode)!;
    const id = `node-${index}`;
    const rounded = contributions.get(person.employeeCode)!;
    const applied = item.depth > 0 && person.activeAtPerformance ? rounded : BigInt(0);
    currentMonthNet += applied;
    if (applied !== BigInt(0)) contributorCount += 1;
    nodes.push({ id, parentId: item.parentId, depth: item.depth, name: person.name, affiliation: person.affiliation,
      isBeneficiary: item.depth === 0, activeAtPerformance: person.activeAtPerformance,
      eligibleAtBasisDate: isReferralAllowanceBasisDateEligible(person),
      finalTargetPerformanceKrw: person.finalTargetPerformanceKrw,
      fpRoundedAmountKrw: outputMoney(rounded), contributionKrw: outputMoney(applied) });
    if (item.depth < REFERRAL_ALLOWANCE_MAX_DEPTH) {
      for (const child of children.get(item.employeeCode) ?? []) queue.push({ employeeCode: child, parentId: id, depth: item.depth + 1 });
    }
  }
  const eligibleAtBasisDate = isReferralAllowanceBasisDateEligible(beneficiary);
  const eligibleAmount = eligibleAtBasisDate ? currentMonthNet : BigInt(0);
  const newPayment = eligibleAmount > BigInt(0) ? eligibleAmount : BigInt(0);
  const carry = eligibleAmount <= BigInt(-100000) ? eligibleAmount : BigInt(0);
  const extinguished = eligibleAmount < BigInt(0) && eligibleAmount > BigInt(-100000) ? eligibleAmount : BigInt(0);
  const excluded = eligibleAtBasisDate ? BigInt(0) : currentMonthNet;
  if (currentMonthNet !== newPayment + carry + extinguished + excluded) fail('UNSAFE_TOTAL');

  return {
    schemaVersion: 1, policyVersion: REFERRAL_ALLOWANCE_POLICY_VERSION,
    performanceMonth: input.performanceMonth, paymentDate: input.paymentDate, genealogyAsOf: input.genealogyAsOf,
    sourceSnapshotDates, usesLaterSnapshot: sourceSnapshotDates.some((date) => date > input.genealogyAsOf),
    eligibilityBasis: 'uploaded_snapshot', status: 'current_month_estimate', previousCarryIncluded: false,
    beneficiary: { nodeId: 'node-0', name: beneficiary.name, eligibleAtBasisDate }, nodes,
    summary: { currentMonthNetKrw: outputMoney(currentMonthNet), newPaymentKrw: outputMoney(newPayment),
      carryForwardKrw: outputMoney(carry), extinguishedKrw: outputMoney(extinguished), excludedByEligibilityKrw: outputMoney(excluded) },
    validation: { visiblePeopleCount: nodes.length, contributorCount, maximumDepth: 10, conservationDifferenceKrw: 0 },
  };
}
