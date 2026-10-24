import {
  REFERRAL_ALLOWANCE_MAX_DEPTH,
  REFERRAL_ALLOWANCE_MAX_PEOPLE,
  REFERRAL_ALLOWANCE_POLICY_VERSION,
  type ReferralAllowanceAccessResponse,
  type ReferralAllowanceNode,
  type ReferralAllowanceStatement,
  type ReferralAllowanceStatementResponse,
} from '../types/referral-allowance.ts';
import { parseCalendarDate } from './calendar-date.ts';

export type ReferralAllowanceResponse = (ReferralAllowanceAccessResponse | ReferralAllowanceStatementResponse)
  & { statement?: ReferralAllowanceStatement | null };

export type ReferralAllowanceAdminPilotReceipt = {
  managerAccountId: string | null;
  beneficiaryFcId: string;
  employeeCode: string;
  enabled: boolean;
  revision: number;
};

export type ReferralAllowanceAdminImportReceipt = {
  id: string;
  status: 'draft' | 'published' | 'superseded';
  revision: number;
  sourceSha256: string;
  policyVersion: typeof REFERRAL_ALLOWANCE_POLICY_VERSION;
  performanceMonth: string;
  pilotRevision: number;
};

export type ReferralAllowanceAdminMutationReceipt = {
  ok: true;
  pilot?: ReferralAllowanceAdminPilotReceipt;
  import?: ReferralAllowanceAdminImportReceipt;
};

export type ReferralAllowanceAdminMutationExpectation =
  | {
      action: 'configure';
      managerAccountId: string | null;
      beneficiaryFcId: string;
      employeeCode: string;
      enabled: boolean;
      expectedRevision: number;
    }
  | {
      action: 'upload';
      beneficiaryFcId: string;
      performanceMonth: string;
      expectedPilotRevision: number;
    }
  | {
      action: 'publish';
      importId: string;
      sourceSha256: string;
      expectedRevision: number;
      expectedPilotRevision: number;
    };

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

const SUMMARY_KEYS = [
  'currentMonthNetKrw',
  'newPaymentKrw',
  'carryForwardKrw',
  'extinguishedKrw',
  'excludedByEligibilityKrw',
] as const;

export function parseReferralAllowanceSummary(value: unknown): ReferralAllowanceStatement['summary'] {
  const summary = record(value);
  for (const key of SUMMARY_KEYS) requireValid(isMoney(summary[key]));
  return summary as ReferralAllowanceStatement['summary'];
}

function validateStatement(value: unknown, availableMonths: string[], month?: string) {
  const statement = record(value);
  requireValid(statement.schemaVersion === 1 && statement.policyVersion === REFERRAL_ALLOWANCE_POLICY_VERSION
    && statement.eligibilityBasis === 'uploaded_snapshot' && statement.status === 'current_month_estimate'
    && statement.previousCarryIncluded === false && typeof statement.usesLaterSnapshot === 'boolean');
  const genealogyAsOfValue = statement.genealogyAsOf;
  const paymentDate = typeof statement.paymentDate === 'string' ? parseCalendarDate(statement.paymentDate) : null;
  const genealogyAsOf = typeof genealogyAsOfValue === 'string' ? parseCalendarDate(genealogyAsOfValue) : null;
  requireValid(isMonth(statement.performanceMonth) && availableMonths.includes(statement.performanceMonth)
    && (month === undefined || statement.performanceMonth === month)
    && paymentDate !== null && genealogyAsOf !== null && typeof genealogyAsOfValue === 'string');
  const performanceMonth = parseCalendarDate(`${statement.performanceMonth}-01`)!;
  requireValid(
    paymentDate.getFullYear() * 12 + paymentDate.getMonth()
      === performanceMonth.getFullYear() * 12 + performanceMonth.getMonth() + 2
    && genealogyAsOf.getTime() <= paymentDate.getTime(),
  );
  requireValid(Array.isArray(statement.sourceSnapshotDates) && statement.sourceSnapshotDates.length > 0
    && statement.sourceSnapshotDates.length <= 64
    && statement.sourceSnapshotDates.every((date) => typeof date === 'string' && parseCalendarDate(date) !== null));
  const sourceSnapshotDates = statement.sourceSnapshotDates as string[];
  requireValid(sourceSnapshotDates.every((date, index) => index === 0 || sourceSnapshotDates[index - 1] < date)
    && statement.usesLaterSnapshot === sourceSnapshotDates.some((date) => date > genealogyAsOfValue));

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

  const summary = parseReferralAllowanceSummary(statement.summary);
  const net = BigInt(summary.currentMonthNetKrw as number);
  const buckets = SUMMARY_KEYS.slice(1).reduce((total, key) => total + BigInt(summary[key] as number), BigInt(0));
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

/** Validate one administrator import snapshot with the same contract used by the FC response parser. */
export function parseReferralAllowanceStatement(value: unknown): ReferralAllowanceStatement {
  const statement = record(value);
  requireValid(isMonth(statement.performanceMonth));
  validateStatement(value, [statement.performanceMonth], statement.performanceMonth);
  return statement as ReferralAllowanceStatement;
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

/** Bind an administrator mutation receipt to the exact request before the UI reports success. */
export function parseReferralAllowanceAdminMutationReceipt(
  value: unknown,
  expected: ReferralAllowanceAdminMutationExpectation,
): ReferralAllowanceAdminMutationReceipt {
  const response = record(value);
  requireValid(response.ok === true);

  if (expected.action === 'configure') {
    const pilot = record(response.pilot);
    requireValid(pilot.managerAccountId === expected.managerAccountId
      && pilot.beneficiaryFcId === expected.beneficiaryFcId
      && pilot.employeeCode === expected.employeeCode
      && pilot.enabled === expected.enabled
      && Number.isSafeInteger(expected.expectedRevision)
      && pilot.revision === expected.expectedRevision + 1);
    return response as ReferralAllowanceAdminMutationReceipt;
  }

  const imported = record(response.import);
  requireValid(isText(imported.id)
    && (imported.status === 'draft' || imported.status === 'published' || imported.status === 'superseded')
    && Number.isSafeInteger(imported.revision) && Number(imported.revision) >= 0
    && typeof imported.sourceSha256 === 'string' && /^[a-f0-9]{64}$/.test(imported.sourceSha256)
    && imported.policyVersion === REFERRAL_ALLOWANCE_POLICY_VERSION
    && isMonth(imported.performanceMonth)
    && Number.isSafeInteger(imported.pilotRevision) && Number(imported.pilotRevision) >= 0);

  if (expected.action === 'upload') {
    requireValid(imported.performanceMonth === expected.performanceMonth
      && imported.pilotRevision === expected.expectedPilotRevision);
  } else {
    requireValid(imported.id === expected.importId
      && imported.status === 'published'
      && imported.revision === expected.expectedRevision
      && imported.sourceSha256 === expected.sourceSha256
      && imported.pilotRevision === expected.expectedPilotRevision);
  }

  return response as ReferralAllowanceAdminMutationReceipt;
}
