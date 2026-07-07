import {
  REQUEST_BOARD_DRIVING_STATUS_OPTIONS,
  formatRequestBoardDrivingStatus,
} from '@/lib/request-board-driving-status';

describe('request board driving status', () => {
  it('exposes selectable driving status options for customer registration', () => {
    expect(REQUEST_BOARD_DRIVING_STATUS_OPTIONS).toEqual([
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
    ]);
    expect(REQUEST_BOARD_DRIVING_STATUS_OPTIONS).not.toEqual(
      expect.arrayContaining([
        { value: 'yes', label: '예' },
        { value: 'no', label: '아니요' },
      ]),
    );
  });

  it('formats known driving status codes', () => {
    expect(formatRequestBoardDrivingStatus('none')).toBe('안함');
    expect(formatRequestBoardDrivingStatus('yes')).toBe('예');
    expect(formatRequestBoardDrivingStatus('no')).toBe('아니요');
    expect(formatRequestBoardDrivingStatus('passenger_private')).toBe('승용차(자가용)');
    expect(formatRequestBoardDrivingStatus('unknown')).toBe('미입력');
  });
});
