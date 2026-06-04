import type { CommissionCompletionStatus, LicenseStatus } from '../types/fc';

export const LICENSE_STATUS_OPTIONS = ['third', 'life', 'nonlife', 'none'] as const;
export const LICENSE_STATUS_NONE: LicenseStatus = 'none';
export const LICENSE_STATUS_LABELS: Record<LicenseStatus, string> = {
  third: '제3 보험',
  life: '생명 보험',
  nonlife: '손해 보험',
  none: '없음',
};

const LICENSE_STATUS_LABEL_TO_VALUE: Record<string, LicenseStatus> = {
  '제3 보험': 'third',
  '생명 보험': 'life',
  '손해 보험': 'nonlife',
  없음: 'none',
};

const CONCRETE_LICENSE_STATUS_OPTIONS = LICENSE_STATUS_OPTIONS.filter(
  (status): status is Exclude<LicenseStatus, typeof LICENSE_STATUS_NONE> => status !== LICENSE_STATUS_NONE,
);

export function isLicenseStatus(input: unknown): input is LicenseStatus {
  return LICENSE_STATUS_OPTIONS.includes(input as LicenseStatus);
}

function normalizeInput(input: unknown): unknown[] {
  if (Array.isArray(input)) return input;
  if (typeof input === 'string') return [input];
  return [];
}

export function normalizeLicenseStatuses(input: unknown): LicenseStatus[] {
  const rawValues = normalizeInput(input);
  const selected = new Set(
    rawValues
      .map((value) => {
        if (isLicenseStatus(value)) return value;
        if (typeof value === 'string') return LICENSE_STATUS_LABEL_TO_VALUE[value.trim()];
        return undefined;
      })
      .filter(isLicenseStatus),
  );
  const concreteStatuses = CONCRETE_LICENSE_STATUS_OPTIONS.filter((status) => selected.has(status));
  return concreteStatuses.length > 0 ? concreteStatuses : [LICENSE_STATUS_NONE];
}

export function toggleLicenseStatus(current: unknown, next: LicenseStatus): LicenseStatus[] {
  if (next === LICENSE_STATUS_NONE) return [LICENSE_STATUS_NONE];

  const currentStatuses = normalizeLicenseStatuses(current).filter(
    (status) => status !== LICENSE_STATUS_NONE,
  );
  const currentSet = new Set(currentStatuses);
  if (currentSet.has(next)) {
    currentSet.delete(next);
  } else {
    currentSet.add(next);
  }
  return normalizeLicenseStatuses([...currentSet]);
}

export function mapLicenseStatusesToCommissionStatus(input: unknown): CommissionCompletionStatus {
  const statuses = normalizeLicenseStatuses(input);
  const hasLife = statuses.includes('life');
  const hasNonlife = statuses.includes('nonlife');
  if (hasLife && hasNonlife) return 'both';
  if (hasLife) return 'life_only';
  if (hasNonlife) return 'nonlife_only';
  return 'none';
}

export function normalizeLegacyCommissionStatus(input?: string | null): CommissionCompletionStatus {
  if (input === 'life_only' || input === 'nonlife_only' || input === 'both') return input;
  return 'none';
}

export function mapLegacyCommissionStatusToLicenseStatuses(input?: string | null): LicenseStatus[] {
  switch (normalizeLegacyCommissionStatus(input)) {
    case 'life_only':
      return ['life'];
    case 'nonlife_only':
      return ['nonlife'];
    case 'both':
      return ['life', 'nonlife'];
    case 'none':
    default:
      return [LICENSE_STATUS_NONE];
  }
}

export function resolveSignupLicenseStatuses(
  licenseStatuses: unknown,
  legacyCommissionStatus?: string | null,
): LicenseStatus[] {
  if (licenseStatuses === undefined || licenseStatuses === null) {
    return mapLegacyCommissionStatusToLicenseStatuses(legacyCommissionStatus);
  }
  return normalizeLicenseStatuses(licenseStatuses);
}
