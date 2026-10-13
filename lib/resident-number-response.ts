export type ResidentNumberEntry = {
  status: 'success' | 'error';
  value: string | null;
};

export type ResidentNumberReceiptStatus = 'ready' | 'missing' | 'unavailable';

export type ResidentNumberReceipt = {
  residentNumbers: Record<string, string | null>;
  residentNumberStatuses: Record<string, ResidentNumberReceiptStatus>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const isFullResidentNumber = (value: unknown): value is string => (
  typeof value === 'string' && /^\d{6}-\d{7}$/.test(value)
);

export function parseResidentNumberReceipt(
  value: unknown,
  requestedFcIds: string[],
): ResidentNumberReceipt | null {
  const expectedIds = requestedFcIds.map((fcId) => fcId.trim());
  const expectedIdSet = new Set(expectedIds);
  if (
    expectedIds.length === 0
    || expectedIds.some((fcId) => !fcId)
    || expectedIdSet.size !== expectedIds.length
    || !isRecord(value)
    || value.ok !== true
    || !isRecord(value.residentNumbers)
    || !isRecord(value.residentNumberStatuses)
  ) {
    return null;
  }

  const numberKeys = Object.keys(value.residentNumbers);
  const statusKeys = Object.keys(value.residentNumberStatuses);
  if (
    numberKeys.length !== expectedIds.length
    || statusKeys.length !== expectedIds.length
    || numberKeys.some((fcId) => !expectedIdSet.has(fcId))
    || statusKeys.some((fcId) => !expectedIdSet.has(fcId))
  ) {
    return null;
  }

  const residentNumbers: Record<string, string | null> = {};
  const residentNumberStatuses: Record<string, ResidentNumberReceiptStatus> = {};
  for (const fcId of expectedIds) {
    const residentNumber = value.residentNumbers[fcId];
    const status = value.residentNumberStatuses[fcId];
    if (status === 'ready' && isFullResidentNumber(residentNumber)) {
      residentNumbers[fcId] = residentNumber;
      residentNumberStatuses[fcId] = status;
      continue;
    }
    if ((status === 'missing' || status === 'unavailable') && residentNumber === null) {
      residentNumbers[fcId] = null;
      residentNumberStatuses[fcId] = status;
      continue;
    }
    return null;
  }

  return { residentNumbers, residentNumberStatuses };
}

export function parseResidentNumberEntries(
  value: unknown,
  requestedFcIds: string[],
): Record<string, ResidentNumberEntry> {
  const receipt = parseResidentNumberReceipt(value, requestedFcIds);
  if (!receipt) throw new Error('resident_number_response_contract_invalid');

  const entries: Record<string, ResidentNumberEntry> = {};
  for (const fcId of Object.keys(receipt.residentNumbers)) {
    const status = receipt.residentNumberStatuses[fcId];
    entries[fcId] = status === 'unavailable'
      ? { status: 'error', value: null }
      : { status: 'success', value: receipt.residentNumbers[fcId] };
  }
  return entries;
}

export function buildUnavailableResidentNumberEntries(
  requestedFcIds: readonly string[],
): Record<string, ResidentNumberEntry> {
  return Object.fromEntries(
    requestedFcIds.map((fcId) => [fcId, { status: 'error' as const, value: null }]),
  );
}
