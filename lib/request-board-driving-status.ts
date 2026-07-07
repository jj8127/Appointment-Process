export const REQUEST_BOARD_DRIVING_STATUS_OPTIONS = [
  { value: 'none', label: '안함' },
  { value: 'passenger_business', label: '승용차(영업용)' },
  { value: 'passenger_private', label: '승용차(자가용)' },
  { value: 'van_business', label: '승합차(영업용)' },
  { value: 'van_private', label: '승합차(자가용)' },
  { value: 'truck_business', label: '화물차(영업용)' },
  { value: 'truck_private', label: '화물차(자가용)' },
  { value: 'motorcycle_business', label: '이륜자동차(영업용)' },
  { value: 'motorcycle_private', label: '이륜자동차(자가용)' },
  { value: 'construction_machine', label: '건설기계' },
  { value: 'agricultural_machine', label: '농기계' },
  { value: 'other', label: '기타' },
] as const;

const DRIVING_STATUS_LABEL_MAP = new Map<string, string>(
  [
    ...REQUEST_BOARD_DRIVING_STATUS_OPTIONS.map((option) => [option.value, option.label] as const),
    ['yes', '예'] as const,
    ['no', '아니요'] as const,
  ],
);

export const formatRequestBoardDrivingStatus = (value?: string | null): string =>
  DRIVING_STATUS_LABEL_MAP.get(String(value ?? '').trim().toLowerCase()) ?? '미입력';
