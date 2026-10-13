import type {
  ResidentNumberReadResult,
} from '@/lib/resident-number-read-contract';
import { parseResidentNumberReceipt } from '../../../lib/resident-number-response.ts';

type ResidentNumberEdgeFallbackResponse =
  | ({ ok: true } & ResidentNumberReadResult)
  | {
      ok: false;
      message: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function parseResidentNumberEdgeFallbackResponse({
  responseOk,
  data,
  expectedFcIds,
}: {
  responseOk: boolean;
  data: unknown;
  expectedFcIds: string[];
}): ResidentNumberEdgeFallbackResponse {
  if (responseOk) {
    const receipt = parseResidentNumberReceipt(data, expectedFcIds);
    if (receipt) {
      return {
        ok: true,
        residentNumbers: receipt.residentNumbers,
        residentNumberStatuses: receipt.residentNumberStatuses,
      };
    }
  }

  let message = 'Edge Function failed';
  if (isRecord(data)) {
    if (typeof data.message === 'string') message = data.message;
    else if (typeof data.error === 'string') message = data.error;
  }

  return { ok: false, message };
}
