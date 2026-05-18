import { getBrandedLoadingSpinnerConfig } from '@/lib/branded-loading-spinner';

describe('getBrandedLoadingSpinnerConfig', () => {
  it('returns compact dimensions for small spinner', () => {
    expect(getBrandedLoadingSpinnerConfig('sm')).toEqual({
      arrowHeadPath: 'M18 4L20 4L20 10',
      arcPath: 'M20 12A8 8 0 1 1 17.66 6.34',
      iconSize: 12,
      haloSize: 18,
      badgeSize: 24,
      strokeWidth: 1,
      viewBox: '0 0 24 24',
    });
  });

  it('returns default dimensions for medium spinner', () => {
    expect(getBrandedLoadingSpinnerConfig('md')).toEqual({
      arrowHeadPath: 'M18 4L20 4L20 10',
      arcPath: 'M20 12A8 8 0 1 1 17.66 6.34',
      iconSize: 16,
      haloSize: 24,
      badgeSize: 32,
      strokeWidth: 1.2,
      viewBox: '0 0 24 24',
    });
  });

  it('returns prominent dimensions for large spinner', () => {
    expect(getBrandedLoadingSpinnerConfig('lg')).toEqual({
      arrowHeadPath: 'M18 4L20 4L20 10',
      arcPath: 'M20 12A8 8 0 1 1 17.66 6.34',
      iconSize: 22,
      haloSize: 36,
      badgeSize: 48,
      strokeWidth: 1.4,
      viewBox: '0 0 24 24',
    });
  });
});
