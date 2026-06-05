import {
  REQUEST_BOARD_DRIVING_STATUS_OPTIONS,
  formatRequestBoardDrivingStatus,
} from '@/lib/request-board-driving-status';

describe('request board driving status', () => {
  it('exposes selectable driving status options for customer registration', () => {
    expect(REQUEST_BOARD_DRIVING_STATUS_OPTIONS).toEqual(
      expect.arrayContaining([
        { value: 'none', label: '안함' },
        { value: 'passenger_private', label: '승용차(자가용)' },
        { value: 'construction_machine', label: '건설기계' },
      ]),
    );
  });

  it('formats known driving status codes', () => {
    expect(formatRequestBoardDrivingStatus('none')).toBe('안함');
    expect(formatRequestBoardDrivingStatus('passenger_private')).toBe('승용차(자가용)');
    expect(formatRequestBoardDrivingStatus('unknown')).toBe('미입력');
  });
});
