import {
  LICENSE_STATUS_NONE,
  mapLegacyCommissionStatusToLicenseStatuses,
  mapLicenseStatusesToCommissionStatus,
  normalizeLicenseStatuses,
  resolveSignupLicenseStatuses,
  toggleLicenseStatus,
} from '../license-statuses';

describe('license status normalization', () => {
  test('deduplicates valid statuses and lets concrete selections clear none', () => {
    expect(normalizeLicenseStatuses(['none', 'life', 'life', 'nonlife', '미지원'])).toEqual([
      'life',
      'nonlife',
    ]);
  });

  test('falls back to exclusive none when no valid concrete status remains', () => {
    expect(normalizeLicenseStatuses([])).toEqual([LICENSE_STATUS_NONE]);
    expect(normalizeLicenseStatuses(['none'])).toEqual([LICENSE_STATUS_NONE]);
    expect(normalizeLicenseStatuses(['없음'])).toEqual([LICENSE_STATUS_NONE]);
    expect(toggleLicenseStatus(['third'], 'third')).toEqual([LICENSE_STATUS_NONE]);
  });

  test('keeps none exclusive during user toggles', () => {
    expect(toggleLicenseStatus(['life', 'nonlife'], 'none')).toEqual([LICENSE_STATUS_NONE]);
    expect(toggleLicenseStatus(['none'], 'third')).toEqual(['third']);
    expect(toggleLicenseStatus(['third'], 'life')).toEqual(['third', 'life']);
  });

  test('maps license selections to the legacy commission status compatibility field', () => {
    expect(mapLicenseStatusesToCommissionStatus(['none'])).toBe('none');
    expect(mapLicenseStatusesToCommissionStatus(['third'])).toBe('none');
    expect(mapLicenseStatusesToCommissionStatus(['life'])).toBe('life_only');
    expect(mapLicenseStatusesToCommissionStatus(['nonlife'])).toBe('nonlife_only');
    expect(mapLicenseStatusesToCommissionStatus(['third', 'life', 'nonlife'])).toBe('both');
  });

  test('derives license statuses from legacy commission status only when the new field is missing', () => {
    expect(resolveSignupLicenseStatuses(undefined, 'life_only')).toEqual(['life']);
    expect(resolveSignupLicenseStatuses(null, 'nonlife_only')).toEqual(['nonlife']);
    expect(resolveSignupLicenseStatuses(['third'], 'both')).toEqual(['third']);
    expect(resolveSignupLicenseStatuses(['제3 보험'], 'both')).toEqual(['third']);
    expect(mapLegacyCommissionStatusToLicenseStatuses('both')).toEqual(['life', 'nonlife']);
  });
});
