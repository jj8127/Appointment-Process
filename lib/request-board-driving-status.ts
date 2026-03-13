const DRIVING_STATUS_LABEL_MAP = new Map<string, string>([
  ['yes', '예'],
  ['no', '아니요'],
  ['passenger_business', '승용차(영업용)'],
  ['passenger_private', '승용차(자가용)'],
  ['van_business', '승합차(영업용)'],
  ['van_private', '승합차(자가용)'],
  ['truck_business', '화물차(영업용)'],
  ['truck_private', '화물차(자가용)'],
  ['motorcycle_business', '이륜자동차(영업용)'],
  ['motorcycle_private', '이륜자동차(자가용)'],
  ['construction_machine', '건설기계'],
  ['agricultural_machine', '농기계'],
  ['other', '기타'],
]);

export const formatRequestBoardDrivingStatus = (value?: string | null): string =>
  DRIVING_STATUS_LABEL_MAP.get(String(value ?? '').trim().toLowerCase()) ?? '미입력';
