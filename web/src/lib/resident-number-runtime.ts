export type DirectDecryptMode = 'auto' | 'disabled' | 'report-only';
export type DirectFallbackReason =
  | 'missing_identity_key'
  | 'mode_disabled'
  | 'report_only'
  | 'direct_failed';

export type DirectDecryptModeResolution = {
  directMode: DirectDecryptMode;
  invalidConfiguredValue: string | null;
};

export function resolveResidentNumberDirectDecryptMode(rawMode: unknown): DirectDecryptModeResolution {
  const normalizedMode = String(rawMode ?? '').trim().toLowerCase();

  if (!normalizedMode || normalizedMode === 'auto' || normalizedMode === 'enabled') {
    return { directMode: 'auto', invalidConfiguredValue: null };
  }

  if (normalizedMode === 'disabled' || normalizedMode === 'off') {
    return { directMode: 'disabled', invalidConfiguredValue: null };
  }

  if (normalizedMode === 'report' || normalizedMode === 'report-only') {
    return { directMode: 'report-only', invalidConfiguredValue: null };
  }

  return {
    directMode: 'auto',
    invalidConfiguredValue: rawMode == null ? null : String(rawMode),
  };
}
