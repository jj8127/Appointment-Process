/** Confirmed formula with the user-approved uploaded-snapshot pilot basis. */
export const REFERRAL_ALLOWANCE_POLICY_VERSION = 'recruitment-2026-09-07-snapshot-pilot-v1' as const;
export const REFERRAL_ALLOWANCE_MAX_DEPTH = 10;
/** Operational import limit, not a monetary eligibility rule. */
export const REFERRAL_ALLOWANCE_MAX_PEOPLE = 10000;

export type ReferralAllowancePersonInput = {
  employeeCode: string;
  parentEmployeeCode: string | null;
  name: string;
  affiliation: string;
  activeAtPerformance: boolean;
  activeAtBasisDate: boolean;
  rankAtBasisDate: string;
  /** Approved final target performance; never an unclassified insurer premium. */
  finalTargetPerformanceKrw: number;
};

export type ReferralAllowanceCalculationInput = {
  performanceMonth: string;
  paymentDate: string;
  /** Calendar date YYYY-MM-DD, representing the operator-selected reference date, not a historical-state claim. */
  genealogyAsOf: string;
  /** Actual dates of the uploaded source snapshots; never relabelled as the reference date. */
  sourceSnapshotDates: string[];
  beneficiaryEmployeeCode: string;
  people: ReferralAllowancePersonInput[];
};

/** Public row IDs are local to this statement; employee codes are not returned. */
export type ReferralAllowanceNode = {
  id: string;
  parentId: string | null;
  depth: number;
  name: string;
  affiliation: string;
  isBeneficiary: boolean;
  activeAtPerformance: boolean;
  eligibleAtBasisDate: boolean;
  finalTargetPerformanceKrw: number;
  fpRoundedAmountKrw: number;
  /** Signed amount attributed to the selected beneficiary; context-only nodes have zero. */
  contributionKrw: number;
};

export type ReferralAllowanceStatement = {
  schemaVersion: 1;
  policyVersion: typeof REFERRAL_ALLOWANCE_POLICY_VERSION;
  performanceMonth: string;
  paymentDate: string;
  genealogyAsOf: string;
  sourceSnapshotDates: string[];
  usesLaterSnapshot: boolean;
  eligibilityBasis: 'uploaded_snapshot';
  status: 'current_month_estimate';
  previousCarryIncluded: false;
  beneficiary: { nodeId: string; name: string; eligibleAtBasisDate: boolean };
  nodes: ReferralAllowanceNode[];
  summary: {
    currentMonthNetKrw: number;
    newPaymentKrw: number;
    carryForwardKrw: number;
    extinguishedKrw: number;
    excludedByEligibilityKrw: number;
  };
  validation: {
    visiblePeopleCount: number;
    contributorCount: number;
    maximumDepth: 10;
    conservationDifferenceKrw: 0;
  };
};

export type ReferralAllowanceAccessResponse =
  | { ok: true; enabled: false }
  | { ok: true; enabled: true; availableMonths: string[] };

export type ReferralAllowanceStatementResponse =
  | { ok: true; enabled: false }
  | { ok: true; enabled: true; availableMonths: string[]; statement: ReferralAllowanceStatement | null };
