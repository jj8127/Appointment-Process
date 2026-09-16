import {
  REFERRAL_ALLOWANCE_MAX_DEPTH,
  REFERRAL_ALLOWANCE_MAX_PEOPLE,
  REFERRAL_ALLOWANCE_POLICY_VERSION,
  type ReferralAllowanceAccessResponse,
  type ReferralAllowanceNode,
  type ReferralAllowanceStatement,
  type ReferralAllowanceStatementResponse,
} from '@/types/referral-allowance';

export type ReferralAllowanceResponse = (ReferralAllowanceAccessResponse | ReferralAllowanceStatementResponse)
  & { statement?: ReferralAllowanceStatement | null };

const RESPONSE_ERROR = '수당 조회 응답을 확인하지 못했습니다. 다시 시도해주세요.';
const isMonth = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const isText = (value: unknown, max?: number, allowEmpty = false): value is string =>
  typeof value === 'string' && (max === undefined || value.length <= max)
  && (allowEmpty || value.trim().length > 0) && !/[\u0000-\u001f\u007f]/.test(value);
const isMoney = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);

function requireValid(condition: unknown): asserts condition {
  if (!condition) throw new Error(RESPONSE_ERROR);
}

function record(value: unknown): Record<string, unknown> {
  requireValid(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validateStatement(value: unknown, availableMonths: string[], month?: string) {
  const statement = record(value);
  requireValid(statement.schemaVersion === 1 && statement.policyVersion === REFERRAL_ALLOWANCE_POLICY_VERSION
    && statement.eligibilityBasis === 'uploaded_snapshot' && statement.status === 'current_month_estimate'
    && statement.previousCarryIncluded === false && typeof statement.usesLaterSnapshot === 'boolean');
  requireValid(isMonth(statement.performanceMonth) && availableMonths.includes(statement.performanceMonth)
    && (month === undefined || statement.performanceMonth === month)
    && isDate(statement.paymentDate) && isDate(statement.genealogyAsOf));
  requireValid(Array.isArray(statement.sourceSnapshotDates) && statement.sourceSnapshotDates.length > 0
    && statement.sourceSnapshotDates.length <= 64 && statement.sourceSnapshotDates.every(isDate));

  const beneficiary = record(statement.beneficiary);
  requireValid(isText(beneficiary.nodeId) && isText(beneficiary.name, 120)
    && typeof beneficiary.eligibleAtBasisDate === 'boolean');
  requireValid(Array.isArray(statement.nodes) && statement.nodes.length > 0
    && statement.nodes.length <= REFERRAL_ALLOWANCE_MAX_PEOPLE);
  const byId = new Map<string, ReferralAllowanceNode>();
  let contributorCount = 0;
  let contributionTotal = BigInt(0);
  for (const value of statement.nodes) {
    const node = record(value);
    requireValid(isText(node.id) && !byId.has(node.id) && (node.parentId === null || isText(node.parentId))
      && isMoney(node.depth) && node.depth >= 0 && node.depth <= REFERRAL_ALLOWANCE_MAX_DEPTH
      && isText(node.name, 120) && isText(node.affiliation, 200, true)
      && typeof node.isBeneficiary === 'boolean' && typeof node.activeAtPerformance === 'boolean'
      && typeof node.eligibleAtBasisDate === 'boolean');
    // Match the existing performance formatter's supported range, including fractional and negative values.
    requireValid(typeof node.finalTargetPerformanceKrw === 'number' && Number.isFinite(node.finalTargetPerformanceKrw)
      && Math.abs(node.finalTargetPerformanceKrw) <= 1e12
      && isMoney(node.fpRoundedAmountKrw) && isMoney(node.contributionKrw));
    byId.set(node.id, node as ReferralAllowanceNode);
    contributionTotal += BigInt(node.contributionKrw);
    if (node.contributionKrw !== 0) contributorCount += 1;
  }

  const root = byId.get(beneficiary.nodeId);
  requireValid(root && root.parentId === null && root.depth === 0 && root.isBeneficiary
    && root.contributionKrw === 0 && root.name === beneficiary.name
    && root.eligibleAtBasisDate === beneficiary.eligibleAtBasisDate);
  for (const node of byId.values()) {
    if (node === root) continue;
    const parent = node.parentId === null ? undefined : byId.get(node.parentId);
    // A unique root and strictly increasing depth ensure every node connects without a cycle.
    requireValid(!node.isBeneficiary && parent && node.depth === parent.depth + 1);
  }

  const summary = record(statement.summary);
  const summaryKeys = ['currentMonthNetKrw', 'newPaymentKrw', 'carryForwardKrw', 'extinguishedKrw', 'excludedByEligibilityKrw'] as const;
  for (const key of summaryKeys) requireValid(isMoney(summary[key]));
  const net = BigInt(summary.currentMonthNetKrw as number);
  const buckets = summaryKeys.slice(1).reduce((total, key) => total + BigInt(summary[key] as number), BigInt(0));
  requireValid(contributionTotal === net && buckets === net);

  const validation = record(statement.validation);
  requireValid(validation.visiblePeopleCount === byId.size && validation.contributorCount === contributorCount
    && validation.maximumDepth === REFERRAL_ALLOWANCE_MAX_DEPTH && validation.conservationDifferenceKrw === 0);

  // Check each addition in display order: cancellation in the final net must not hide an unsafe branch sum.
  const totals = new Map([...byId.values()].map((node) => [node.id, node.contributionKrw]));
  for (const node of [...byId.values()].sort((a, b) => b.depth - a.depth)) {
    if (node.parentId === null) continue;
    const total = totals.get(node.parentId)! + totals.get(node.id)!;
    requireValid(Number.isSafeInteger(total));
    totals.set(node.parentId, total);
  }
}

/** Validate before query data can reach React or a throwing amount formatter; never rewrite published amounts. */
export function parseReferralAllowanceResponse(value: unknown, action: 'access' | 'statement', month?: string): ReferralAllowanceResponse {
  const response = record(value);
  requireValid(response.ok === true && typeof response.enabled === 'boolean');
  if (!response.enabled) return { ok: true, enabled: false };
  requireValid(Array.isArray(response.availableMonths) && response.availableMonths.length <= 120
    && response.availableMonths.every(isMonth) && new Set(response.availableMonths).size === response.availableMonths.length);
  if (action === 'statement') requireValid(response.statement !== undefined);
  if (response.statement !== undefined && response.statement !== null) {
    validateStatement(response.statement, response.availableMonths, month);
  }
  return response as ReferralAllowanceResponse;
}
