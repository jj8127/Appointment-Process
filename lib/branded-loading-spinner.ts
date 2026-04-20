export type BrandedLoadingSpinnerSize = 'sm' | 'md' | 'lg';

type BrandedLoadingSpinnerConfig = {
  iconSize: number;
  haloSize: number;
  badgeSize: number;
  strokeWidth: number;
  viewBox: string;
  arcPath: string;
  arrowHeadPath: string;
};

const SHARED_VECTOR_SHAPE = {
  viewBox: '0 0 24 24',
  arcPath: 'M20 12A8 8 0 1 1 17.66 6.34',
  arrowHeadPath: 'M18 4L20 4L20 10',
} as const;

const SPINNER_CONFIG: Record<BrandedLoadingSpinnerSize, BrandedLoadingSpinnerConfig> = {
  sm: {
    ...SHARED_VECTOR_SHAPE,
    iconSize: 12,
    haloSize: 18,
    badgeSize: 24,
    strokeWidth: 1,
  },
  md: {
    ...SHARED_VECTOR_SHAPE,
    iconSize: 16,
    haloSize: 24,
    badgeSize: 32,
    strokeWidth: 1.2,
  },
  lg: {
    ...SHARED_VECTOR_SHAPE,
    iconSize: 22,
    haloSize: 36,
    badgeSize: 48,
    strokeWidth: 1.4,
  },
};

export function getBrandedLoadingSpinnerConfig(
  size: BrandedLoadingSpinnerSize = 'md',
) {
  return SPINNER_CONFIG[size];
}
