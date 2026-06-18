import { getBrandedLoadingSpinnerConfig } from '@/lib/branded-loading-spinner';

describe('getBrandedLoadingSpinnerConfig', () => {
  it('returns native indicator sizing for small spinner', () => {
    expect(getBrandedLoadingSpinnerConfig('sm')).toEqual({
      indicatorSize: 'small',
      wrapperSize: 18,
    });
  });

  it('returns native indicator sizing for medium spinner', () => {
    expect(getBrandedLoadingSpinnerConfig('md')).toEqual({
      indicatorSize: 'small',
      wrapperSize: 24,
    });
  });

  it('returns native indicator sizing for large spinner', () => {
    expect(getBrandedLoadingSpinnerConfig('lg')).toEqual({
      indicatorSize: 'large',
      wrapperSize: 48,
    });
  });
});
