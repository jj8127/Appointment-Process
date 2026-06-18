export type BrandedLoadingSpinnerSize = 'sm' | 'md' | 'lg';

type BrandedLoadingSpinnerConfig = {
  indicatorSize: 'small' | 'large';
  wrapperSize: number;
};

const SPINNER_CONFIG: Record<BrandedLoadingSpinnerSize, BrandedLoadingSpinnerConfig> = {
  sm: {
    indicatorSize: 'small',
    wrapperSize: 18,
  },
  md: {
    indicatorSize: 'small',
    wrapperSize: 24,
  },
  lg: {
    indicatorSize: 'large',
    wrapperSize: 48,
  },
};

export function getBrandedLoadingSpinnerConfig(
  size: BrandedLoadingSpinnerSize = 'md',
) {
  return SPINNER_CONFIG[size];
}
