export type HanwhaPdfAction = 'createHanwhaPdfUploadUrl' | 'deleteHanwhaPdf';

export type HanwhaPdfPayloadValidation =
  | {
      ok: true;
      fcId: string;
      fileName?: string;
    }
  | {
      ok: false;
      error: string;
    };

const trimString = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

export function validateHanwhaPdfPayload(
  action: HanwhaPdfAction,
  payload: unknown,
): HanwhaPdfPayloadValidation {
  const raw = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const fcId = trimString(raw.fcId);
  const fileName = trimString(raw.fileName);

  if (!fcId) {
    return { ok: false, error: 'fcId is required' };
  }

  if (action === 'createHanwhaPdfUploadUrl' && !fileName) {
    return { ok: false, error: 'fcId and fileName are required' };
  }

  return fileName ? { ok: true, fcId, fileName } : { ok: true, fcId };
}
